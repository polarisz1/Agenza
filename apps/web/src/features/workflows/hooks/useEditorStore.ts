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
  createNodeData,
  deserializeGraph,
  uid,
  type EditorNode,
  type NodeType,
  type WorkflowStatus,
} from '../types';

interface Snapshot {
  nodes: EditorNode[];
  edges: Edge[];
}

export type SaveState = 'idle' | 'saving' | 'error';

interface LoadPayload {
  id: string;
  name: string;
  status: WorkflowStatus;
  graph: unknown;
  viewport?: Viewport | null;
}

interface EditorState {
  workflowId: string | null;
  name: string;
  status: WorkflowStatus;
  nodes: EditorNode[];
  edges: Edge[];
  viewport: Viewport | null;
  selectedId: string | null;
  dirty: boolean;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  loaded: boolean;
  /** 每次内容变更 +1，用于自动保存防抖 */
  rev: number;
  /** 撤销/重做/加载后 +1，用于属性面板同步草稿 */
  historyVersion: number;
  past: Snapshot[];
  future: Snapshot[];

  load(payload: LoadPayload): void;
  setName(name: string): void;
  setViewport(viewport: Viewport): void;
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
  status: 'draft',
  nodes: [],
  edges: [],
  viewport: null,
  selectedId: null,
  dirty: false,
  saveState: 'idle',
  saveError: null,
  lastSavedAt: null,
  loaded: false,
  rev: 0,
  historyVersion: 0,
  past: [],
  future: [],

  load: ({ id, name, status, graph, viewport }) => {
    const { nodes, edges } = deserializeGraph(graph);
    set({
      workflowId: id,
      name,
      status,
      nodes,
      edges,
      viewport: viewport ?? null,
      selectedId: null,
      dirty: false,
      saveState: 'idle',
      saveError: null,
      lastSavedAt: Date.now(),
      loaded: true,
      rev: 0,
      historyVersion: get().historyVersion + 1,
      past: [],
      future: [],
    });
  },

  setName: (name) => {
    if (name === get().name) return;
    set({ name, dirty: true, rev: get().rev + 1 });
  },

  setViewport: (viewport) => set({ viewport }),

  select: (id) => {
    if (id === get().selectedId) return;
    set({
      selectedId: id,
      nodes: get().nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
    });
  },

  onNodesChange: (changes) => {
    const structural = changes.some(
      (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    if (structural) get().beginHistory();

    const nodes = applyNodeChanges(changes, get().nodes);
    const meaningful = changes.some(
      (c) => c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace',
    );
    const selectedId = nodes.some((n) => n.id === get().selectedId) ? get().selectedId : null;
    set(
      meaningful
        ? { nodes, selectedId, dirty: true, rev: get().rev + 1 }
        : { nodes, selectedId },
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
    if (!source || !target || source === target) return;
    if (get().edges.some((e) => e.source === source && e.target === target)) return;
    get().beginHistory();
    set({
      edges: addEdge({ ...connection, id: `e_${source}_${target}` }, get().edges),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  addNode: (type, position) => {
    get().beginHistory();
    const seq = get().nodes.filter((n) => n.data.type === type).length + 1;
    const id = uid(type);
    const node: EditorNode = {
      id,
      type,
      position,
      selected: true,
      data: createNodeData(type, seq),
    };
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      selectedId: id,
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
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label } } : n,
      ),
      dirty: true,
      rev: get().rev + 1,
    });
  },

  beginHistory: () => {
    const { nodes, edges, past } = get();
    const snapshot: Snapshot = { nodes: clone(nodes), edges: clone(edges) };
    set({
      past: [...past, snapshot].slice(-MAX_HISTORY),
      future: [],
    });
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    if (!past.length) return;
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ nodes: clone(nodes), edges: clone(edges) }, ...future].slice(0, MAX_HISTORY),
      nodes: previous.nodes,
      edges: previous.edges,
      selectedId: previous.nodes.some((n) => n.id === get().selectedId) ? get().selectedId : null,
      dirty: true,
      rev: get().rev + 1,
      historyVersion: get().historyVersion + 1,
    });
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      past: [...past, { nodes: clone(nodes), edges: clone(edges) }].slice(-MAX_HISTORY),
      future: future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      selectedId: next.nodes.some((n) => n.id === get().selectedId) ? get().selectedId : null,
      dirty: true,
      rev: get().rev + 1,
      historyVersion: get().historyVersion + 1,
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

  markSaveError: (message) =>
    set({ saveState: 'error', saveError: message || '保存失败' }),
}));
