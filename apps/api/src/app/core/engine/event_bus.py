"""In-process async event bus → SSE.

每个 run 维护：
- 订阅者队列列表（每个 SSE 连接一个）
- 事件历史（用于 Last-Event-ID 断线重连补齐）
- 递增序号（作为 SSE 的 id 字段）
"""
from __future__ import annotations

import asyncio
import time
from collections import deque

_HISTORY_LIMIT = 500
_QUEUE_LIMIT = 1000
_MAX_TRACKED_RUNS = 200


class EventBus:
    """Pub/sub for run events. All subscribers are per-connection SSE streams."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = {}  # run_id → queues
        self._history: dict[str, deque[dict]] = {}  # run_id → 事件历史
        self._seq: dict[str, int] = {}  # run_id → 最后序号

    def subscribe(
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
        return queue, backlog

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        lst = self._queues.get(run_id)
        if lst and queue in lst:
            lst.remove(queue)
            if not lst:
                self._queues.pop(run_id, None)

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

        for queue in list(self._queues.get(run_id, ())):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # 客户端消费过慢：丢弃最旧事件后重试
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

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
