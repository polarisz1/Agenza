import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildSseUrl } from '@/shared/lib/http';
import { useEventSource } from '@/shared/hooks/useEventSource';

export type LiveStatus = 'idle' | 'running' | 'success' | 'failed' | 'cancelled';

export interface RunNodeState {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'cancelled';
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string | null;
  error?: string | null;
}

export interface RunLogEntry {
  id: number;
  event: string;
  data: any;
  at: number;
}

const STREAM_EVENTS = ['run.started', 'node.started', 'node.finished', 'run.finished'];

const MAX_LOGS = 300;

/**
 * 订阅单次运行的 SSE 事件，产出实时节点状态与日志。
 * runId 变化时自动切换订阅。
 */
export function useRunStream(runId: string | null) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [nodes, setNodes] = useState<Record<string, RunNodeState>>({});
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleEvent = useCallback((name: string, data: any) => {
    const at = Date.now();
    setLogs((prev) => {
      const next = [...prev, { id: at + prev.length, event: name, data, at }];
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });

    if (name === 'run.started') {
      setStatus('running');
      setStartedAt(at);
      return;
    }

    if (name === 'node.started') {
      setNodes((prev) => ({
        ...prev,
        [data.node_id]: {
          nodeId: data.node_id,
          nodeName: data.node_name || data.node_id,
          nodeType: data.node_type,
          status: 'running',
        },
      }));
      return;
    }

    if (name === 'node.finished') {
      setNodes((prev) => ({
        ...prev,
        [data.node_id]: {
          nodeId: data.node_id,
          nodeName: data.node_name || data.node_id,
          nodeType: data.node_type,
          status: data.status,
          durationMs: data.duration_ms,
          tokensIn: data.tokens_in,
          tokensOut: data.tokens_out,
          model: data.model,
          error: data.error,
        },
      }));
      return;
    }

    if (name === 'run.finished') {
      setStatus(data.status ?? 'failed');
      setDurationMs(data.duration_ms ?? null);
      setTotalTokens(data.total_tokens ?? 0);
      setError(data.error ?? null);
    }
  }, []);

  const url = useMemo(() => (runId ? buildSseUrl(`/api/runs/${runId}/events`) : null), [runId]);

  useEventSource({
    url,
    events: STREAM_EVENTS,
    onEvent: handleEvent,
  });

  const reset = useCallback(() => {
    setStatus('idle');
    setNodes({});
    setLogs([]);
    setStartedAt(null);
    setDurationMs(null);
    setTotalTokens(0);
    setError(null);
  }, []);

  // 切换到另一次运行时清空上一次的实时状态
  useEffect(() => {
    reset();
  }, [runId, reset]);

  return { status, nodes, logs, startedAt, durationMs, totalTokens, error, reset };
}
