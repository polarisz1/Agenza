import { useCallback, useEffect, useRef } from 'react';

import { updateWorkflow } from '../api';
import { serializeGraph } from '../types';
import { useEditorStore } from './useEditorStore';

const AUTO_SAVE_DELAY = 2000;

/**
 * 自动保存：内容变更后 2s 无新输入 → PUT /api/workflows/{id}。
 * 保存失败保留 dirty，由工具栏"保存失败 · 重试"手动触发。
 *
 * `enabled` 来自设置页的「自动保存」开关；关闭后只有手动保存（Ctrl+S / 按钮）生效。
 * `saveNow` 可被校验/运行/调试/返回列表复用：并发调用会**共享同一个进行中的请求**，
 * 而不是第二个调用直接返回 false（后者会被上层误判成"保存失败"）。
 */
export function useAutoSave(workflowId: string | null, delay = AUTO_SAVE_DELAY, enabled = true) {
  const dirty = useEditorStore((s) => s.dirty);
  const rev = useEditorStore((s) => s.rev);
  const saveState = useEditorStore((s) => s.saveState);
  const inflightRef = useRef<Promise<boolean> | null>(null);

  const doSave = useCallback(async (): Promise<boolean> => {
    const state = useEditorStore.getState();
    if (!state.workflowId) return false;

    const revAtStart = state.rev;
    const graph = serializeGraph(state.nodes, state.edges);
    const viewport = state.viewport ?? undefined;

    state.markSaving();
    try {
      const saved = await updateWorkflow(state.workflowId, {
        name: state.name,
        graph,
        viewport: viewport as Record<string, unknown> | undefined,
      });
      useEditorStore.getState().markSaved(revAtStart, saved.status);
      return true;
    } catch (err: any) {
      useEditorStore.getState().markSaveError(err?.message);
      return false;
    }
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    // 已有保存在飞：等同一次结果，不要另起请求
    if (inflightRef.current) return inflightRef.current;
    const task = doSave();
    inflightRef.current = task;
    try {
      return await task;
    } finally {
      inflightRef.current = null;
    }
  }, [doSave]);

  useEffect(() => {
    if (!enabled || !workflowId || !dirty) return;
    // 保存失败后不自动重试，避免无限请求；由用户点“重试”
    if (saveState === 'saving' || saveState === 'error') return;

    const timer = window.setTimeout(() => {
      void saveNow();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, workflowId, dirty, rev, saveState, delay, saveNow]);

  return { saveNow };
}
