import { useCallback, useEffect } from 'react';

import { updateWorkflow } from '../api';
import { serializeGraph } from '../types';
import { useEditorStore } from './useEditorStore';

const AUTO_SAVE_DELAY = 2000;

/**
 * 自动保存：内容变更后 2s 无新输入 → PUT /api/workflows/{id}。
 * 保存失败保留 dirty，由工具栏“保存失败 · 重试”手动触发。
 */
export function useAutoSave(workflowId: string | null, delay = AUTO_SAVE_DELAY) {
  const dirty = useEditorStore((s) => s.dirty);
  const rev = useEditorStore((s) => s.rev);
  const saveState = useEditorStore((s) => s.saveState);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const state = useEditorStore.getState();
    if (!state.workflowId) return false;
    if (state.saveState === 'saving') return false;

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

  useEffect(() => {
    if (!workflowId || !dirty) return;
    // 保存失败后不自动重试，避免无限请求；由用户点“重试”
    if (saveState === 'saving' || saveState === 'error') return;

    const timer = window.setTimeout(() => {
      void saveNow();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [workflowId, dirty, rev, saveState, delay, saveNow]);

  return { saveNow };
}
