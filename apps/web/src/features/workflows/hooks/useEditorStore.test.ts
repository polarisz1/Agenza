import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from './useEditorStore';

/**
 * 图快照一致性（评审 F1）：视口要参与"未保存"判定与撤销栈。
 *
 * 这里的用例是纯 store 逻辑，不需要浏览器——React 只是它的消费者。
 */

function reset() {
  useEditorStore.setState({
    workflowId: 'wf_test',
    name: '测试',
    description: '',
    status: 'draft',
    nodes: [
      {
        id: 'n1',
        type: 'llm',
        position: { x: 0, y: 0 },
        data: { type: 'llm', label: 'LLM1', config: { prompt: 'a' } },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
    selectedIds: [],
    dirty: false,
    saveState: 'idle',
    saveError: null,
    lastSavedAt: null,
    rev: 0,
    historyVersion: 0,
    past: [],
    future: [],
  });
}

describe('editor store · viewport', () => {
  beforeEach(reset);

  it('程序化移动（markDirty=false）不把图标记为未保存', () => {
    useEditorStore.getState().setViewport({ x: 10, y: 10, zoom: 1 });

    const state = useEditorStore.getState();
    expect(state.viewport).toEqual({ x: 10, y: 10, zoom: 1 });
    expect(state.dirty).toBe(false);
    expect(state.rev).toBe(0);
  });

  it('用户平移/缩放会置 dirty 并推进 rev（自动保存据此触发）', () => {
    useEditorStore.getState().setViewport({ x: 5, y: 5, zoom: 1.5 }, true);

    const state = useEditorStore.getState();
    expect(state.dirty).toBe(true);
    expect(state.rev).toBe(1);
  });

  it('撤销会还原当时保存的视口', () => {
    const store = useEditorStore.getState();
    store.beginHistory(); // 记录当前视口（0,0,1）
    store.setViewport({ x: 100, y: 200, zoom: 2 }, true);

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('重做会把视口恢复到撤销前', () => {
    const store = useEditorStore.getState();
    store.beginHistory();
    store.setViewport({ x: 100, y: 200, zoom: 2 }, true);
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();

    expect(useEditorStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 2 });
  });
});

describe('editor store · 节点编辑', () => {
  beforeEach(reset);

  it('更新配置会置 dirty 并推进 rev', () => {
    useEditorStore.getState().updateNodeConfig('n1', { prompt: 'b' });

    const state = useEditorStore.getState();
    expect(state.nodes[0].data.config.prompt).toBe('b');
    expect(state.dirty).toBe(true);
    expect(state.rev).toBe(1);
  });

  it('内容没变时不产生多余变更（避免无谓保存）', () => {
    useEditorStore.getState().updateNodeConfig('n1', { prompt: 'a' });

    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it('markSaved 用 rev 判定保存期间是否又有编辑', () => {
    useEditorStore.getState().updateNodeConfig('n1', { prompt: 'b' }); // rev=1
    useEditorStore.getState().markSaving();
    useEditorStore.getState().markSaved(1, 'draft');

    expect(useEditorStore.getState().dirty).toBe(false);

    useEditorStore.getState().updateNodeConfig('n1', { prompt: 'c' }); // rev=2
    useEditorStore.getState().markSaving();
    useEditorStore.getState().markSaved(1, 'draft');

    expect(useEditorStore.getState().dirty).toBe(true);
  });
});

describe('editor store · 工作流描述（G28）', () => {
  beforeEach(reset);

  it('修改描述会置 dirty 并推进 rev（自动保存据此触发）', () => {
    useEditorStore.getState().setDescription('抓网页并摘要');

    const state = useEditorStore.getState();
    expect(state.description).toBe('抓网页并摘要');
    expect(state.dirty).toBe(true);
    expect(state.rev).toBe(1);
  });

  it('描述没变时不产生无谓保存', () => {
    useEditorStore.getState().setDescription('');

    expect(useEditorStore.getState().dirty).toBe(false);
  });
});
