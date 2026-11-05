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
  selectedIds: string[];
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
  /** 多选（F2）：selectedId 只在恰好选中一个时非空，供属性面板使用 */
  selectedIds: string[];
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
  setStatus(status: WorkflowStatus): void;
  setViewport(viewport: Viewport, markDirty?: boolean): void;
  select(id: string | null): void;
  /** 多选：由画布 onSelectionChange 调用（F2） */
  setSelection(ids: string[]): void;
  deleteSelected(): void;
  copySelection(): void;
  pasteClipboard(): void;
  duplicateSelection(): void;
  toggleSelectedEnabled(): void;
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

interface ClipboardPayload {
  nodes: EditorNode[];
  edges: Edge[];
}

/** 内存剪贴板（不写系统剪贴板：图结构不是纯文本，跨应用粘贴无意义） */
let clipboard: ClipboardPayload | null = null;

function uniqueLabel(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** 为一组节点/内部连线生成副本：新 id、唯一名称、偏移位置（F2）。 */
function buildCopies(
  allNodes: EditorNode[],
  _allEdges: Edge[],
  sourceNodes: EditorNode[],
  sourceEdges: Edge[],
  offset: number,
): { copies: EditorNode[]; copiesEdges: Edge[] } {
  const idMap = new Map<string, string>();
  const labels = allNodes.map((node) => node.data.label);

  const copies = sourceNodes.map((node) => {
    const id = uid(node.data.type === 'unknown' ? 'unknown' : node.data.type);
    const label =
      node.data.type === 'unknown'
        ? uniqueLabel(`${node.data.label} 副本`, labels)
        : nextLabel(node.data.type, labels);
    labels.push(label);
    idMap.set(node.id, id);
    return {
      ...node,
      id,
      selected: true,
      position: { x: node.position.x + offset, y: node.position.y + offset },
      data: { ...node.data, label, config: clone(node.data.config) },
    } satisfies EditorNode;
  });

  const copiesEdges = sourceEdges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({
      ...edge,
      id: `e_${idMap.get(edge.source)}_${idMap.get(edge.target)}_${edge.sourceHandle ?? 'out'}`,
      source: idMap.get(edge.source) as string,
      target: idMap.get(edge.target) as string,
    }));

  return { copies, copiesEdges };
}

/** 仅供测试：清空内存剪贴板，避免用例之间互相污染。 */
export function clearEditorClipboardForTests(): void {
  clipboard = null;
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
  selectedIds: [],
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
      selectedIds: [],
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

  setStatus: (status) => set({ status }),

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
    if (id === get().selectedId && get().selectedIds.length === (id ? 1 : 0)) return;
    set({
      selectedId: id,
      selectedIds: id ? [id] : [],
      // 换选中的节点 = 结束上一次"编辑会话"，下次改参数会压新的撤销点
      historyAnchor: null,
      nodes: get().nodes.map((n) =>
        n.selected === (n.id === id) ? n : { ...n, selected: n.id === id },
      ),
    });
  },

  setSelection: (ids) => {
    const unique = [...new Set(ids)].filter((id) => get().nodes.some((node) => node.id === id));
    const primary = unique.length === 1 ? unique[0] : null;
    if (primary === get().selectedId && unique.join(',') === get().selectedIds.join(',')) return;
    const selectedSet = new Set(unique);
    set({
      selectedIds: unique,
      selectedId: primary,
      historyAnchor: null,
      nodes: get().nodes.map((node) =>
        node.selected === selectedSet.has(node.id)
          ? node
          : { ...node, selected: selectedSet.has(node.id) },
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
    const existing = new Set(nodes.map((node) => node.id));
    const currentId = get().selectedId;
    const selectedIds = get().selectedIds.filter((id) => existing.has(id));
    const selectedId =
      currentId && existing.has(currentId)
        ? currentId
        : selectedIds.length === 1
          ? selectedIds[0]
          : null;
    set(
      meaningful
        ? { nodes, selectedId, selectedIds, dirty: true, rev: get().rev + 1 }
        : { nodes, selectedId, selectedIds },
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

  deleteSelected: () => {
    const ids = new Set(get().selectedIds);
    if (!ids.size) return;
    get().beginHistory();
    set({
      nodes: get().nodes.filter((node) => !ids.has(node.id)),
      edges: get().edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
      selectedId: null,
      selectedIds: [],
      dirty: true,
      rev: get().rev + 1,
    });
  },

  copySelection: () => {
    const ids = new Set(get().selectedIds);
    if (!ids.size) return;
    clipboard = {
      nodes: clone(get().nodes.filter((node) => ids.has(node.id))),
      edges: clone(get().edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))),
    };
  },

  pasteClipboard: () => {
    if (!clipboard?.nodes.length) return;
    get().beginHistory();
    const { copies, copiesEdges } = buildCopies(
      get().nodes,
      get().edges,
      clipboard.nodes,
      clipboard.edges,
      24,
    );
    set({
      // 粘贴后只保留新节点为选中态，方便继续拖动/删除
      nodes: [
        ...get().nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
        ...copies,
      ],
      edges: [...get().edges, ...copiesEdges],
      selectedId: copies.length === 1 ? copies[0].id : null,
      selectedIds: copies.map((node) => node.id),
      historyAnchor: null,
      dirty: true,
      rev: get().rev + 1,
    });
  },

  duplicateSelection: () => {
    if (!get().selectedIds.length) return;
    get().copySelection();
    get().pasteClipboard();
  },

  toggleSelectedEnabled: () => {
    const ids = new Set(get().selectedIds);
    if (!ids.size) return;
    const selected = get().nodes.filter((node) => ids.has(node.id));
    const enabled = !selected.every((node) => node.data.config.enabled !== false);
    get().beginHistory();
    set({
      nodes: get().nodes.map((node) =>
        ids.has(node.id)
          ? { ...node, data: { ...node.data, config: { ...node.data.config, enabled } } }
          : node,
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
      selectedIds: [id],
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
    const { nodes, edges, viewport, selectedId, selectedIds, past } = get();
    const snapshot: Snapshot = {
      nodes: clone(nodes),
      edges: clone(edges),
      viewport: viewport ? { ...viewport } : null,
      selectedId,
      selectedIds: [...selectedIds],
    };
    set({
      past: [...past, snapshot].slice(-MAX_HISTORY),
      future: [],
    });
  },

  undo: () => {
    const { past, future, nodes, edges, viewport, selectedId, selectedIds } = get();
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
          selectedIds: [...selectedIds],
        },
        ...future,
      ].slice(0, MAX_HISTORY),
      nodes: previous.nodes,
      edges: previous.edges,
      viewport: previous.viewport ?? viewport,
      // 选中态跟着快照走：以前只按 id 是否还存在推断，恢复出来的高亮
      // 可能指向另一个节点，与右侧面板不一致（评审 G20）
      selectedId: previous.selectedId,
      selectedIds: previous.selectedIds ?? [],
      dirty: true,
      rev: get().rev + 1,
      historyVersion: get().historyVersion + 1,
      historyAnchor: null,
    });
  },

  redo: () => {
    const { past, future, nodes, edges, viewport, selectedId, selectedIds } = get();
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
          selectedIds: [...selectedIds],
        },
      ].slice(-MAX_HISTORY),
      future: future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      viewport: next.viewport ?? viewport,
      selectedId: next.selectedId,
      selectedIds: next.selectedIds ?? [],
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
