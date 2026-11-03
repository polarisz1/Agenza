"""Event bus → SSE.

桌面模式（无 Redis）：纯内存 asyncio.Queue，单进程内广播。
SaaS 模式（CELERY_BROKER_URL 为 redis://）：Redis Pub/Sub 跨进程广播，
API 进程的 SSE 连接能收到 Celery worker 发出的事件。

接口保持一致：
- subscribe(run_id, last_event_id) → (queue, backlog)
- unsubscribe(run_id, queue)
- publish(run_id, event)
- has_history(run_id)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque

from app.core.config import settings

_HISTORY_LIMIT = 500
_QUEUE_LIMIT = 1000
_MAX_TRACKED_RUNS = 200
_REDIS_CHANNEL_PREFIX = "af:run:"


def _redis_url() -> str | None:
    """从 CELERY_BROKER_URL 推断 Redis 地址。

    只接受 redis:// / rediss:// 前缀；其他 broker（如 RabbitMQ）
    不支持 Pub/Sub 复用，此时 EventBus 降级为内存模式。
    """
    url = getattr(settings, "CELERY_BROKER_URL", "") or ""
    if url.startswith("redis://") or url.startswith("rediss://"):
        return url
    return None


class EventBus:
    """Pub/sub for run events. All subscribers are per-connection SSE streams."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = {}  # run_id → queues
        self._history: dict[str, deque[dict]] = {}  # run_id → 事件历史
        self._seq: dict[str, int] = {}  # run_id → 最后序号
        self._redis = None
        self._listener_tasks: dict[str, asyncio.Task] = {}
        redis_url = _redis_url()
        if redis_url:
            try:
                import redis.asyncio as aioredis

                self._redis = aioredis.from_url(redis_url)
            except Exception:
                # redis 包未安装或连接失败：降级内存模式，不影响启动
                self._redis = None

    @property
    def use_redis(self) -> bool:
        return self._redis is not None

    async def subscribe(
        self, run_id: str, last_event_id: int | None = None
    ) -> tuple[asyncio.Queue, list[dict]]:
        """订阅 run 事件，返回 (队列, 需要补发的历史事件)。"""
        queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_LIMIT)
        self._queues.setdefault(run_id, []).append(queue)
        backlog = [
            event
            for event in self._history.get(run_id, ())
            if last_event_id is None or event.get("seq", 0) > last_event_id
        ]
        # Redis 模式：为该 channel 启动一个监听器，把 Redis 消息转发到本地队列
        if self.use_redis and run_id not in self._listener_tasks:
            self._listener_tasks[run_id] = asyncio.create_task(self._listen(run_id))
        return queue, backlog

    def has_history(self, run_id: str) -> bool:
        """本进程是否见过这次运行的事件（后端重启后为 False）。"""
        return bool(self._history.get(run_id))

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        lst = self._queues.get(run_id)
        if lst and queue in lst:
            lst.remove(queue)
            if not lst:
                self._queues.pop(run_id, None)
                # 没有订阅者了，停掉 Redis 监听器节省资源
                task = self._listener_tasks.pop(run_id, None)
                if task is not None:
                    task.cancel()

    async def _listen(self, run_id: str) -> None:
        """监听 Redis channel，把消息转发到本地所有订阅队列。"""
        assert self._redis is not None
        pubsub = self._redis.pubsub()
        channel = f"{_REDIS_CHANNEL_PREFIX}{run_id}"
        try:
            await pubsub.subscribe(channel)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    event = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError):
                    continue
                for q in list(self._queues.get(run_id, ())):
                    try:
                        q.put_nowait(event)
                    except asyncio.QueueFull:
                        with contextlib.suppress(asyncio.QueueEmpty):
                            q.get_nowait()
                        with contextlib.suppress(asyncio.QueueFull):
                            q.put_nowait(event)
        except asyncio.CancelledError:
            pass
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()

    async def publish(self, run_id: str, event: dict) -> None:
        seq = self._seq.get(run_id, 0) + 1
        self._seq[run_id] = seq

        payload = {**event, "seq": seq, "ts": time.time()}

        history = self._history.get(run_id)
        if history is None:
            history = deque(maxlen=_HISTORY_LIMIT)
            self._history[run_id] = history
            self._prune()
        history.append(payload)

        if self.use_redis:
            # 跨进程广播：worker 发出的事件能到达 API 进程的 SSE 连接。
            # Redis 发布失败不阻塞执行：本进程订阅者仍能收到（下面直接入队）。
            with contextlib.suppress(Exception):
                await self._redis.publish(
                    f"{_REDIS_CHANNEL_PREFIX}{run_id}",
                    json.dumps(payload, ensure_ascii=False, default=str),
                )
            # 本进程订阅者直接入队，避免等待 Redis 回环的延迟
            for queue in list(self._queues.get(run_id, ())):
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    with contextlib.suppress(asyncio.QueueEmpty):
                        queue.get_nowait()
                    with contextlib.suppress(asyncio.QueueFull):
                        queue.put_nowait(payload)
        else:
            # 桌面模式：纯内存广播
            for queue in list(self._queues.get(run_id, ())):
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    with contextlib.suppress(asyncio.QueueEmpty):
                        queue.get_nowait()
                    with contextlib.suppress(asyncio.QueueFull):
                        queue.put_nowait(payload)

    def _prune(self) -> None:
        """控制内存占用：只保留最近 N 个 run 的事件历史。"""
        while len(self._history) > _MAX_TRACKED_RUNS:
            oldest = next(iter(self._history))
            self._history.pop(oldest, None)
            self._seq.pop(oldest, None)
            self._queues.pop(oldest, None)


_bus = EventBus()


def get_event_bus() -> EventBus:
    return _bus
