import { useEffect, useRef } from 'react';

export interface UseEventSourceOptions {
  /** SSE 地址；为 null 时不建立连接 */
  url: string | null;
  /** 需要监听的命名事件 */
  events: string[];
  enabled?: boolean;
  /** 收到事件回调：事件名 / 解析后的数据 / SSE id */
  onEvent: (name: string, data: any, id?: string) => void;
  /** 收到这些事件后视为流结束，不再重连 */
  doneEvents?: string[];
  /** 是否在异常断线后自动重连（默认 true） */
  reconnect?: boolean;
  /** 最大重连间隔（毫秒） */
  maxDelayMs?: number;
}

/**
 * 跨 feature 通用 SSE hook。
 *
 * - 记录最近一次事件 id，断线重连时通过 `last_event_id` 查询参数补齐
 * - 指数退避重连（1s → 2s → ... → maxDelayMs）
 * - 收到 doneEvents 中的事件后主动关闭，避免对已结束的运行反复重连
 */
export function useEventSource({
  url,
  events,
  enabled = true,
  onEvent,
  doneEvents = ['run.finished'],
  reconnect = true,
  maxDelayMs = 15000,
}: UseEventSourceOptions) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const lastIdRef = useRef<string | null>(null);

  // events 数组每次渲染都是新引用，用字符串固化依赖
  const eventKey = events.join(',');
  const doneKey = doneEvents.join(',');

  useEffect(() => {
    if (!enabled || !url) return;

    const names = eventKey.split(',').filter(Boolean);
    const stops = doneKey.split(',').filter(Boolean);

    let source: EventSource | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;

      const target = lastIdRef.current
        ? `${url}${url.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastIdRef.current)}`
        : url;

      source = new EventSource(target);

      const finish = () => {
        closed = true;
        source?.close();
        source = null;
      };

      for (const name of names) {
        source.addEventListener(name, (event) => {
          const message = event as MessageEvent;
          if (message.lastEventId) lastIdRef.current = message.lastEventId;
          attempt = 0;

          let payload: any = message.data;
          try {
            payload = JSON.parse(message.data);
          } catch {
            // 非 JSON 负载保持原样
          }

          handlerRef.current(name, payload, message.lastEventId || undefined);
          if (stops.includes(name)) finish();
        });
      }

      source.onopen = () => {
        attempt = 0;
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (closed || !reconnect) return;

        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), maxDelayMs);
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [url, enabled, reconnect, maxDelayMs, eventKey, doneKey]);
}
