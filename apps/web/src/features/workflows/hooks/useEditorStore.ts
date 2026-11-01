import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';

import {
  connectionIssue,
  createNodeData,
  deserializeGraph,
  nextLabel,
  uid,
  type EditorNode,
  type NodeType,
  type WorkflowStatus,
} from '../types';

interface Snapshot {
  nodes: EditorNode[];
  edges: Edge[];
  viewport: Viewport | null;
  /** 撤销/重做要把"当时选中了谁"一起还原（评审 G20）。 */
  selectedId: string | null;
}

export type SaveState = 'idle' | 'saving' | 'error';

interface LoadPayload {
  id: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  graph: unknown;
  viewport?: Viewport | null;
}

interface EditorState {
  workflowId: string | null;
  name: string;
  description: string;
  status: WorkflowStatus;
  nodes: EditorNode[];
  edges: Edge[];
  viewport: Viewport | null;
  selectedId: string | null;
  dirty: boolean;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  /** 每次内容变更 +1，用于自动保存防抖 */
  rev: number;
  /** 撤销/重做/加载后 +1，用于属性面板同步草稿 */
  historyVersion: number;
  /**
   * 当前"编辑会话"锚定的节点：同一节点连续编辑只压一次撤销栈，
   * 换节点后再改才压新的（F9：不再靠 focus 事件压栈导致"撤销按了没反应"）。
   */
  historyAnchor: string | null;
  past: Snapshot[];
  future: Snapshot[];

  load(payload: LoadPayload): void;
  setName(name: string): void;
  setDescription(description: string): void;
  setViewport(viewport: Viewport, markDirty?: boolean): void;
  select(id: string | null): void;
  onNodesChange(changes: NodeChange<EditorNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  addNode(type: NodeType, position: { x: number; y: number }): void;
  updateNodeConfig(nodeId: string, patch: Record<string, unknown>): void;
  updateLabel(nodeId: string, label: string): void;
  beginHistory(): void;
  undo(): void;
  redo(): void;
  autoLayout(): void;
  markSaving(): void;
  markSaved(revAtStart: number, status: WorkflowStatus): void;
  markSaveError(message?: string): void;
}

const MAX_HISTORY = 50;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  workflowId: null,
  name: '未命名工作流',
  description: '',
  status: 'draft',
  nodes: [],
  edges: [],
  viewport: null,
  selectedId: null,
  dirty: false,
  saveState: 'idle',
  saveError: null,
  lastSavedAt: null,
  rev: 0,
  historyVersion: 0,
  historyAnchor: null,
  past: [],
  future: [],

  load: ({ id, name, description, status, graph, viewport }) => {
    const { nodes, edges } = deserializeGraph(graph);
    set({
      workflowId: id,
      name,
      description: description ?? '',
      status,
      nodes,
      edges,
      viewport: viewport ?? null,
      selectedId: null,
      dirty: false,
      saveState: 'idle',
      saveError: null,
      lastSavedAt: Date.now(),
      rev: 0,
      historyVersion: get().historyVersion + 1,
      historyAnchor: null,
      past: [],
      future: [],
    });
  },

  setName: (name) => {
    if (name === get().name) return;
    set({ name, dirty: true, rev: get().rev + 1 });
  },

  setDescription: (description) => {
    if (description === get().description) return;
    set({ description, dirty: true, rev: get().rev + 1 });
  },

  /**
   * 更新视口。`markDirty` 只在用户真的平移/缩放时传 true
   * （程序化 fitView 传 false，否则打开工作流就立刻变"未保存"）。
   */
  setViewport: (viewport, markDirty = false) => {
    if (markDirty) {
      set({ viewport, dirty: true, rev: get().rev + 1 });
      return;
    }
    set({ viewport });
  },

  select: (id) => {
    if (id === get().selectedId) return;
    set({
      selectedId: id,
      // 换选中的节点 = 结束上一次"编辑会话"，下次改参数会压新的撤销点
      historyAnchor: null,
      nodes: get().nodes.map((n) =>
        n.selected === (n.id === id) ? n : { ...n, selected: n.id === id },
      ),
    });
  },

  onNodesChange: (changes) => {
    const structural = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    if (structural) get().beginHistory();

    const nodes = applyNodeChanges(changes, get().nodes);
    const meaningful = changes.some(
      (c) =>
        c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    const selectedId = nodes.some((n) => n.id === get().selectedId) ? get().selectedId : null;
    set(
      meaningful ? { nodes, selectedId, dirty: true, rev: get().rev + 1 } : { nodes, selectedId },
    );
  },

  onEdgesChange: (changes) => {
    const structural = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    if (structural) get().beginHistory();
    const edges = applyEdgeChanges(changes, get().edges);
    if (structural) {
      set({ edges, dirty: true, rev: get().rev + 1 });
    } else {
      set({ edges });
    }
  },

  onConnect: (connection) => {
    const { source, target } = connection;
    if (!source || !target) return;

    // 类型矩阵 + 入度 + 无环：全部在画布层拦住（评审 G21），不再等后端 422
    if (connectionIssue(get().nodes, get().edges, connection)) return;

    const branch =
      connection.sourceHandle === 'true'
        ? 'true'
        : connection.sourceHandle === 'false'
          ? 'false'
          : undefined;
    const duplicate = get().edges.some(
      (e) => e.source === source && e.target === target && e.sourceHandle === branch,
    );
    if (duplicate) return;

    get().beginHistory();
    set({
      edges: addEdge(
        {
          ...connection,
          id: `e_${source}_${target}_${branch ?? 'out'}`,
          label: branch === 'true' ? '真' : branch === 'false' ? '假' : undefined,
        },
        get().edges,
      ),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  addNode: (type, position) => {
    get().beginHistory();
    const id = uid(type);
    // 名称按"已有同类节点里的最大编号 +1"，删掉节点后重建也不会重名（F8）
    const label = nextLabel(
      type,
      get()
        .nodes.filter((n) => n.data.type === type)
        .map((n) => n.data.label),
    );
    const node: EditorNode = {
      id,
      type,
      position,
      selected: true,
      data: { ...createNodeData(type, 1), label },
    };
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      selectedId: id,
      historyAnchor: null,
      dirty: true,
      rev: get().rev + 1,
    });
  },

  updateNodeConfig: (nodeId, patch) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const current = node.data.config || {};
    const next = { ...current, ...patch };
    if (JSON.stringify(current) === JSON.stringify(next)) return;

    // 真的改了才压撤销点，且同一节点连续编辑只压一次（F9）
    if (get().historyAnchor !== nodeId) {
      get().beginHistory();
      set({ historyAnchor: nodeId });
    }
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, config: next } } : n,
      ),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  updateLabel: (nodeId, label) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || node.data.label === label) return;

    if (get().historyAnchor !== nodeId) {
      get().beginHistory();
      set({ historyAnchor: nodeId });
    }
    set({
      nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  beginHistory: () => {
    const { nodes, edges, viewport, selectedId, past } = get();
    const snapshot: Snapshot = {
      nodes: clone(nodes),
      edges: clone(edges),
      viewport: viewport ? { ...viewport } : null,
      selectedId,
    };
    set({
      past: [...past, snapshot].slice(-MAX_HISTORY),
      future: [],
    });
  },

  undo: () => {
    const { past, future, nodes, edges, viewport, selectedId } = get();
    if (!past.length) return;
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [
        {
          nodes: clone(nodes),
          edges: clone(edges),
          viewport: viewport ? { ...viewport } : null,
          selectedId,
        },
        ...future,
      ].slice(0, MAX_HISTORY),
      nodes: previous.nodes,
      edges: previous.edges,
      viewport: previous.viewport ?? viewport,
      // 选中态跟着快照走：以前只按 id 是否还存在推断，恢复出来的高亮
      // 可能指向另一个节点，与右侧面板不一致（评审 G20）
      selectedId: previous.selectedId,
      dirty: true,
      rev: get().rev + 1,
      historyVersion: get().historyVersion + 1,
      historyAnchor: null,
    });
  },

  redo: () => {
    const { past, future, nodes, edges, viewport, selectedId } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      past: [
        ...past,
        {
          nodes: clone(nodes),
          edges: clone(edges),
          viewport: viewport ? { ...viewport } : null,
          selectedId,
        },
      ].slice(-MAX_HISTORY),
      future: future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      viewport: next.viewport ?? viewport,
      selectedId: next.selectedId,
      dirty: true,
      rev: get().rev + 1,
      historyVersion: get().historyVersion + 1,
      historyAnchor: null,
    });
  },

  autoLayout: () => {
    const { nodes, edges } = get();
    if (!nodes.length) return;
    get().beginHistory();

    const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
    const children = new Map<string, string[]>();
    for (const e of edges) {
      if (!indeg.has(e.target) || !indeg.has(e.source)) continue;
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
    }

    let layer = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
    const layers: string[][] = [];
    const placed = new Set<string>();

    while (layer.length) {
      layers.push(layer);
      const next: string[] = [];
      for (const id of layer) {
        placed.add(id);
        for (const child of children.get(id) ?? []) {
          indeg.set(child, (indeg.get(child) ?? 1) - 1);
          if (indeg.get(child) === 0) next.push(child);
        }
      }
      layer = next;
    }

    const leftovers = nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
    if (leftovers.length) layers.push(leftovers);

    const positions = new Map<string, { x: number; y: number }>();
    layers.forEach((ids, layerIndex) => {
      ids.forEach((id, rowIndex) => {
        positions.set(id, { x: 60 + layerIndex * 280, y: 60 + rowIndex * 140 });
      });
    });

    set({
      nodes: nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  markSaving: () => set({ saveState: 'saving', saveError: null }),

  markSaved: (revAtStart, status) =>
    set((state) => ({
      saveState: 'idle',
      saveError: null,
      status,
      lastSavedAt: Date.now(),
      // 保存期间又有编辑：保持 dirty，等下一轮自动保存
      dirty: state.rev !== revAtStart,
    })),

  markSaveError: (message) => set({ saveState: 'error', saveError: message || '保存失败' }),
}));
