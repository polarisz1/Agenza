import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App } from 'antd';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DownloadSimple,
  FloppyDisk,
  GitBranch,
  Play,
  UploadSimple,
  WebhooksLogo,
} from '@phosphor-icons/react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useRunStream } from '@/features/runs/hooks/useRunStream';
import { useAuthStore } from '@/features/auth/hooks/useAuthStore';

import {
  cancelWorkflowRun,
  createWorkflow,
  getEditorPreferences,
  getLatestRunNodeOutputs,
  getWorkflow,
  publishWorkflow,
  runWorkflow,
  testNode,
  unpublishWorkflow,
  validateWorkflow,
  type NodeTestResult,
  type WorkflowResponse,
} from '../api';
import {
  NODE_DRAG_MIME,
  NODE_META,
  connectionIssue,
  extractWorkflowInputs,
  type EditorNode,
  type NodeType,
  type RuntimeStatus,
  type ValidateIssue,
} from '../types';
import { flushDraft } from '../hooks/draftBridge';
import { useAutoSave } from '../hooks/useAutoSave';
import { useEditorStore } from '../hooks/useEditorStore';
import { useVariables } from '../hooks/useVariables';
import { nodeTypes } from './nodes';
import CommandPalette from './CommandPalette';
import NodeLibrary from './NodeLibrary';
import TriggerDrawer from './TriggerDrawer';
import VersionDrawer from './VersionDrawer';
import PropertyPanel from './PropertyPanel';
import RunDrawer from './RunDrawer';
import RunInputsModal from './RunInputsModal';
import './WorkflowEditor.css';

export default function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

function EditorInner() {
  const { id, wsId } = useParams<{ id: string; wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const flow = useReactFlow();
  // AntD 静态 message 不继承主题/语言上下文；走 App.useApp() 拿到上下文里的实例（评审 G26）
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);

  const workflowId = useEditorStore((s) => s.workflowId);
  const name = useEditorStore((s) => s.name);
  const description = useEditorStore((s) => s.description);
  const status = useEditorStore((s) => s.status);
  const publishedVersionId = useEditorStore((s) => s.publishedVersionId);
  const hasUnpublishedChanges = useEditorStore((s) => s.hasUnpublishedChanges);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const viewport = useEditorStore((s) => s.viewport);
  const selectedId = useEditorStore((s) => s.selectedId);
  const dirty = useEditorStore((s) => s.dirty);
  const saveState = useEditorStore((s) => s.saveState);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const pastCount = useEditorStore((s) => s.past.length);
  const futureCount = useEditorStore((s) => s.future.length);

  const setName = useEditorStore((s) => s.setName);
  const setViewport = useEditorStore((s) => s.setViewport);
  const select = useEditorStore((s) => s.select);
  const setSelection = useEditorStore((s) => s.setSelection);
  const copySelection = useEditorStore((s) => s.copySelection);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const duplicateSelection = useEditorStore((s) => s.duplicateSelection);
  const toggleSelectedEnabled = useEditorStore((s) => s.toggleSelectedEnabled);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const onConnect = useEditorStore((s) => s.onConnect);
  const addNode = useEditorStore((s) => s.addNode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const autoLayout = useEditorStore((s) => s.autoLayout);
  const beginHistory = useEditorStore((s) => s.beginHistory);
  const loadWorkflow = useEditorStore((s) => s.load);

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  // 设置页的「自动保存」开关决定是否防抖落库；读不到就按开启处理（保持旧行为）
  useEffect(() => {
    let cancelled = false;
    getEditorPreferences()
      .then((prefs) => {
        if (!cancelled) setAutoSaveEnabled(prefs.autoSave);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { saveNow } = useAutoSave(workflowId, undefined, autoSaveEnabled);

  const [runId, setRunId] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidateIssue[]>([]);
  const [latestOutputs, setLatestOutputs] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  // F2：命令面板 / 节点搜索 / 右键菜单
  const [palette, setPalette] = useState<'command' | 'node' | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    kind: 'node' | 'pane' | 'edge';
    nodeId?: string;
    edgeId?: string;
  } | null>(null);

  const creatingRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const run = useRunStream(runId);
  const variables = useVariables(nodes, edges, selectedId, latestOutputs);

  const refreshOutputs = useCallback(async (wfId: string) => {
    try {
      setLatestOutputs(await getLatestRunNodeOutputs(wfId));
    } catch {
      // 没有历史运行或接口失败时，变量列表退回静态推断
    }
  }, []);

  // 加载 / 新建工作流
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      if (id === 'new') {
        if (creatingRef.current) return;
        creatingRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
        setLoading(true);
        setCreating(true);
        try {
          const created = await createWorkflow({
            name: '未命名工作流',
            description: '',
            graph: { version: 1, inputs: [], nodes: [], edges: [] },
          });
          creatingRef.current = false;
          // StrictMode 下首个 effect 会被清理，这里不依赖 cancelled 标记，确保只创建一次并跳转
          navigate(`${wsPrefix}/workflows/${created.id}`, { replace: true });
        } catch (err: any) {
          creatingRef.current = false;
          message.error(err?.message || '创建工作流失败');
          if (!cancelled) setLoading(false);
        } finally {
          setCreating(false);
        }
        return;
      }

      setLoading(true);
      try {
        const wf: WorkflowResponse = await getWorkflow(id);
        if (cancelled) return;
        loadWorkflow({
          id: wf.id,
          name: wf.name,
          description: wf.description ?? '',
          status: wf.status,
          graph: wf.graph,
          viewport: (wf.viewport ?? null) as Viewport | null,
          publishedVersionId: wf.published_version_id ?? null,
          publishedAt: wf.published_at ?? null,
          hasUnpublishedChanges: wf.has_unpublished_changes ?? false,
        });
        setIssues([]);
        setRunId(null);
        void refreshOutputs(wf.id);
        requestAnimationFrame(() => flow.fitView({ padding: 0.25 }));
      } catch (err: any) {
        message.error(err?.message || '加载工作流失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 运行结束后刷新“最近输出”，供变量推断与属性面板使用
  useEffect(() => {
    if ((run.status === 'success' || run.status === 'failed') && workflowId) {
      void refreshOutputs(workflowId);
    }
  }, [run.status, workflowId, refreshOutputs]);

  // 快捷键：Ctrl+S 保存；Ctrl+Z / Ctrl+Shift+Z 撤销重做（输入框内不拦截撤销）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (editing) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setPalette('command');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        setPalette('node');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        event.preventDefault();
        copySelection();
      } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
        event.preventDefault();
        pasteClipboard();
      } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault();
        duplicateSelection();
      } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        setSelection(useEditorStore.getState().nodes.map((node) => node.id));
      } else if (event.key === 'Escape') {
        setSelection([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow, undo, redo, copySelection, pasteClipboard, duplicateSelection, setSelection]);

  // 有未保存修改时，关闭页面前提醒
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const issueIds = useMemo(() => new Set(issues.map((i) => i.node_id).filter(Boolean)), [issues]);

  // 把运行态 / 校验态叠加到节点数据上；未变化节点保持原引用，避免全量重渲染
  const runtimeNodes = useMemo<EditorNode[]>(() => {
    const running = run.status === 'running';
    return nodes.map((node) => {
      const live = run.nodes[node.id];
      let nextStatus: RuntimeStatus | undefined;
      if (live) nextStatus = live.status;
      else if (running) nextStatus = 'queued';

      const hasIssue = issueIds.has(node.id);
      const runtimeDurationMs = live?.durationMs;
      const runtimeTokens = live ? (live.tokensIn ?? 0) + (live.tokensOut ?? 0) : undefined;
      const runtimeError = live?.error ?? undefined;
      if (
        node.data.runtimeStatus === nextStatus &&
        node.data.hasIssue === hasIssue &&
        node.data.runtimeDurationMs === runtimeDurationMs &&
        node.data.runtimeTokens === runtimeTokens &&
        node.data.runtimeError === runtimeError
      ) {
        return node;
      }
      return {
        ...node,
        data: {
          ...node.data,
          runtimeStatus: nextStatus,
          hasIssue,
          runtimeDurationMs,
          runtimeTokens,
          runtimeError,
        },
      };
    });
  }, [nodes, run.nodes, run.status, issueIds]);

  // 记录最近一次连线被拒的原因，供 onConnectEnd 提示（F2/T5.2.5）
  const lastConnectionIssue = useRef<string | null>(null);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      // 类型矩阵 / 入度 / 环，统一由 connectionIssue 判断（评审 G21）
      const issue = connectionIssue(nodes, edges, connection);
      lastConnectionIssue.current = issue;
      return issue === null;
    },
    [nodes, edges],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: EditorNode[] }) => {
      setSelection(selected.map((node) => node.id));
    },
    [setSelection],
  );

  const addNodeAtCenter = (type: NodeType) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const base = rect
      ? flow.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 3,
        })
      : { x: 220, y: 140 };
    // 按 3 列网格错开新节点，避免连续添加时完全重叠
    const index = nodes.length % 9;
    addNode(type, {
      x: base.x - 95 + (index % 3) * 220,
      y: base.y - 40 + Math.floor(index / 3) * 110,
    });
  };

  const handleAutoLayout = () => {
    autoLayout();
    requestAnimationFrame(() => flow.fitView({ padding: 0.25, duration: 300 }));
  };

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(NODE_DRAG_MIME) as NodeType;
      if (!type || !(type in NODE_META)) return;
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, { x: point.x - 95, y: point.y - 24 });
    },
    [addNode, flow],
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      if (!nodeId) return;
      select(nodeId);
      flow.fitView({ nodes: [{ id: nodeId }], padding: 0.8, duration: 300, maxZoom: 1.1 });
    },
    [select, flow],
  );

  // 从运行详情"在编辑器中打开"跳转过来时，定位到出错节点（F1）
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus || loading || focusedRef.current === focus) return;
    if (!useEditorStore.getState().nodes.some((node) => node.id === focus)) return;
    focusedRef.current = focus;
    focusNode(focus);
  }, [searchParams, loading, focusNode]);

  const runValidation = useCallback(async (): Promise<ValidateIssue[]> => {
    const wfId = useEditorStore.getState().workflowId;
    if (!wfId) return [];
    setValidating(true);
    try {
      flushDraft();
      const saved = await saveNow();
      if (!saved) {
        message.error('保存失败，无法校验');
        return [];
      }
      const result = await validateWorkflow(wfId);
      const list = result.issues ?? [];
      setIssues(list);
      return list;
    } catch (err: any) {
      message.error(err?.message || '校验失败');
      return [];
    } finally {
      setValidating(false);
    }
  }, [saveNow, message]);

  const handleValidate = async () => {
    const list = await runValidation();
    // 哪些问题算"阻断"由后端定义（issue.blocking），前端不再自建一套
    const blocking = list.filter((i) => i.blocking);
    if (blocking.length) {
      message.error(`校验未通过：${blocking[0].message}`);
      focusNode(blocking[0].node_id);
    } else if (list.length) {
      message.warning(`校验通过，但有 ${list.length} 条提示`);
    } else {
      message.success('校验通过');
    }
  };

  const startRun = async (values: Record<string, unknown>) => {
    const wfId = useEditorStore.getState().workflowId;
    if (!wfId) return;
    setStarting(true);
    try {
      flushDraft();
      const saved = await saveNow();
      if (!saved) {
        message.error('保存失败，未发起运行');
        return;
      }
      const started = await runWorkflow(wfId, values);
      setRunId(started.id);
      setInputsOpen(false);
      setDrawerCollapsed(false);
    } catch (err: any) {
      message.error(err?.message || '发起运行失败');
    } finally {
      setStarting(false);
    }
  };

  const handleRun = async () => {
    const state = useEditorStore.getState();
    if (!state.workflowId) return;
    if (state.nodes.length === 0) {
      message.warning('画布为空：请先从左侧拖入节点');
      return;
    }

    const list = await runValidation();
    const blocking = list.filter((i) => i.blocking);
    if (blocking.length) {
      message.error('校验未通过，已定位到问题节点');
      focusNode(blocking[0].node_id);
      return;
    }
    if (list.length) message.warning(`有 ${list.length} 条校验提示，继续运行`);

    const fields = extractWorkflowInputs(state.nodes);
    if (fields.length > 0) {
      setInputsOpen(true);
      return;
    }
    await startRun({});
  };

  const handleCancelRun = async () => {
    if (!runId) return;
    try {
      await cancelWorkflowRun(runId);
    } catch (err: any) {
      message.error(err?.message || '取消失败');
    }
  };

  const handleClearRun = () => {
    setRunId(null);
    run.reset();
  };

  const handleDebug = useCallback(
    async (nodeId: string): Promise<NodeTestResult> => {
      const wfId = useEditorStore.getState().workflowId;
      if (!wfId) throw new Error('工作流尚未保存');
      flushDraft();
      const saved = await saveNow();
      if (!saved) throw new Error('保存失败，无法调试');
      return testNode(wfId, nodeId);
    },
    [saveNow],
  );

  const handlePublish = async () => {
    if (!workflowId) return;
    setPublishing(true);
    try {
      flushDraft();
      const saved = await saveNow();
      if (!saved) throw new Error('保存失败，无法发布');
      const published = await publishWorkflow(workflowId);
      useEditorStore.getState().setPublishState({
        publishedVersionId: published.published_version_id ?? null,
        publishedAt: published.published_at ?? null,
        hasUnpublishedChanges: published.has_unpublished_changes ?? false,
      });
      message.success('工作流已发布');
    } catch (err: any) {
      message.error(err?.message || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!workflowId) return;
    setPublishing(true);
    try {
      const result = await unpublishWorkflow(workflowId);
      useEditorStore.getState().setPublishState({
        publishedVersionId: result.published_version_id ?? null,
        publishedAt: result.published_at ?? null,
        hasUnpublishedChanges: result.has_unpublished_changes ?? false,
      });
      message.success('已取消发布');
    } catch (err: any) {
      message.error(err?.message || '取消发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = () => {
    const payload = { version: 1, name, description, nodes, edges };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name || 'workflow'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const nameOf = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.data.label || nodeId;

  const inputFields = useMemo(() => extractWorkflowInputs(nodes), [nodes]);

  const handleBack = useCallback(async () => {
    // 返回前先把防抖窗口里的编辑提交并保存，否则这 2s 内的改动会丢（F4）
    flushDraft();
    if (useEditorStore.getState().dirty) {
      const saved = await saveNow();
      if (!saved) {
        // 保存失败还跳走 = 直接丢用户改动；留在页面上让他重试/导出
        message.error('保存失败，已取消返回：请重试保存后再离开');
        return;
      }
    }
    navigate(`${wsPrefix}/workflows`);
  }, [navigate, saveNow, message, wsPrefix]);

  const debugFromMenu = useCallback(
    async (nodeId: string) => {
      setCtxMenu(null);
      try {
        const result = await handleDebug(nodeId);
        if (result.status === 'success') message.success('调试成功');
        else message.error(result.error || '调试失败');
      } catch (err: any) {
        message.error(err?.message || '调试失败');
      }
    },
    [handleDebug, message],
  );

  // 右键菜单：点空白/滚动/Esc 关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const handleVersionRestored = useCallback(
    (workflow: WorkflowResponse) => {
      loadWorkflow({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? '',
        status: workflow.status,
        graph: workflow.graph,
        viewport: (workflow.viewport ?? null) as Viewport | null,
        publishedVersionId: workflow.published_version_id ?? null,
        publishedAt: workflow.published_at ?? null,
        hasUnpublishedChanges: workflow.has_unpublished_changes ?? false,
      });
      setVersionsOpen(false);
      setIssues([]);
    },
    [loadWorkflow],
  );

  const handleVersionPublished = useCallback((workflow: WorkflowResponse) => {
    useEditorStore.getState().setPublishState({
      publishedVersionId: workflow.published_version_id ?? null,
      publishedAt: workflow.published_at ?? null,
      hasUnpublishedChanges: workflow.has_unpublished_changes ?? false,
    });
  }, []);

  // 命令面板的条目随当前工作流状态变化，直接构造（只在面板打开时使用）
  const commands = [
    { id: 'run', label: '运行工作流', hint: '▶ 运行', run: () => void handleRun() },
    { id: 'save', label: '保存', hint: 'Ctrl+S', run: () => void saveNow() },
    { id: 'layout', label: '自动布局', run: handleAutoLayout },
    {
      id: 'fit',
      label: '适应视图',
      run: () => flow.fitView({ padding: 0.25, duration: 300 }),
    },
    { id: 'undo', label: '撤销', hint: 'Ctrl+Z', run: undo },
    { id: 'redo', label: '重做', hint: 'Ctrl+Shift+Z', run: redo },
    { id: 'find', label: '搜索节点', hint: 'Ctrl+F', run: () => setPalette('node') },
    { id: 'runs', label: '打开运行记录', run: () => navigate(`${wsPrefix}/runs`) },
    { id: 'models', label: '打开模型配置', run: () => navigate(`${wsPrefix}/models`) },
    { id: 'settings', label: '打开设置', run: () => navigate(`${wsPrefix}/settings`) },
  ];

  return (
    <div className="afe-root">
      <div className="afe-statusbar">
        <div className="afe-statusbar__left">
          <span className="afe-statusbar__dot" />
          <span>
            <span className="afe-statusbar__user">@{user?.name || '本地用户'}</span> 正在编辑
          </span>
          <span className="afe-statusbar__divider" />
          <span className="afe-statusbar__mode">
            {publishedVersionId
              ? hasUnpublishedChanges
                ? 'Published · 有未发布修改'
                : 'Published · 已发布'
              : status === 'ready'
                ? 'Ready · 可运行'
                : 'Draft · 可编辑'}
          </span>
        </div>
        <div className="afe-statusbar__right">
          {saveState === 'saving'
            ? '保存中…'
            : dirty
              ? '有未保存修改'
              : lastSavedAt
                ? `已自动保存 ${new Date(lastSavedAt).toTimeString().slice(0, 5)}`
                : '尚未保存'}
          {!autoSaveEnabled && ' · 自动保存已关闭'}
        </div>
      </div>

      <div className="afe-header">
        <button className="afe-back" onClick={() => void handleBack()}>
          ← 返回
        </button>

        <div className="afe-title-wrap">
          <input
            className="afe-title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="工作流名称"
          />

          <span className="afe-save-state">
            {saveState === 'saving' && <span className="afe-dim">保存中…</span>}
            {saveState === 'error' && (
              <button className="afe-save-error" onClick={() => void saveNow()}>
                保存失败 · 重试
              </button>
            )}
            {saveState === 'idle' && dirty && <span className="afe-dim">未保存</span>}
            {saveState === 'idle' && !dirty && lastSavedAt && (
              <span className="afe-dim">
                已保存 {new Date(lastSavedAt).toTimeString().slice(0, 5)}
              </span>
            )}
          </span>
        </div>

        <div className="afe-header-actions">
          <button className="afe-btn" onClick={undo} disabled={pastCount === 0} title="撤销">
            <ArrowCounterClockwise size={14} />
            撤销
          </button>
          <button className="afe-btn" onClick={redo} disabled={futureCount === 0} title="重做">
            <ArrowClockwise size={14} />
            重做
          </button>
          <button className="afe-btn" onClick={handleAutoLayout}>
            ⊞ 自动布局
          </button>
          <button className="afe-btn" onClick={handleValidate} disabled={validating || creating}>
            {validating ? '校验中…' : '校验'}
          </button>
          <button className="afe-btn" onClick={() => void saveNow()} disabled={!workflowId}>
            <FloppyDisk size={14} />
            保存
          </button>
          <button className="afe-btn" onClick={() => setVersionsOpen(true)} disabled={!workflowId}>
            <GitBranch size={14} />
            版本
          </button>
          <button
            className="afe-btn"
            onClick={() => setTriggersOpen(true)}
            disabled={!workflowId}
            title="管理 Webhook 触发器"
          >
            <WebhooksLogo size={14} />
            触发器
          </button>
          <button className="afe-btn" onClick={handleExport} disabled={loading}>
            <DownloadSimple size={14} />
            导出
          </button>
          <button
            className="afe-btn afe-btn--primary"
            onClick={handleRun}
            disabled={starting || creating || loading}
          >
            <Play size={14} weight="fill" />
            {starting ? '发起中…' : '运行'}
          </button>
          <button
            className="afe-btn afe-btn--publish"
            onClick={() => void handlePublish()}
            disabled={
              !workflowId || publishing || (publishedVersionId !== null && !hasUnpublishedChanges)
            }
            title={publishedVersionId ? '发布最新内容' : '发布当前内容'}
          >
            <UploadSimple size={14} />
            {publishedVersionId && !hasUnpublishedChanges
              ? '已发布'
              : publishing
                ? '发布中…'
                : hasUnpublishedChanges
                  ? '发布更新'
                  : '发布'}
          </button>
          {publishedVersionId && (
            <button
              className="afe-btn"
              onClick={() => void handleUnpublish()}
              disabled={publishing}
              title="仅清除发布标记，画布与版本历史不变"
            >
              取消发布
            </button>
          )}
        </div>
      </div>

      {saveState === 'error' && (
        <div className="afe-save-banner">
          <span>保存失败：{saveError || '未知错误'}（本地编辑已保留）</span>
          <button className="afe-btn afe-btn--text" onClick={() => void saveNow()}>
            重试保存
          </button>
        </div>
      )}

      <div className="afe-body">
        <NodeLibrary onAdd={addNodeAtCenter} />

        <main
          className="afe-canvas"
          ref={canvasRef}
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
        >
          {loading ? (
            <div className="afe-canvas-loading">{creating ? '正在创建工作流…' : '加载中…'}</div>
          ) : (
            <ReactFlow
              key={workflowId ?? 'new'}
              nodes={runtimeNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={() => {
                const issue = lastConnectionIssue.current;
                lastConnectionIssue.current = null;
                if (issue) message.warning(`无法连接：${issue}`);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                select(node.id);
                setCtxMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: 'node',
                  nodeId: node.id,
                });
              }}
              onPaneContextMenu={(event) => {
                event.preventDefault();
                setCtxMenu({ x: event.clientX, y: event.clientY, kind: 'pane' });
              }}
              onEdgeContextMenu={(event, edge) => {
                event.preventDefault();
                setCtxMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: 'edge',
                  edgeId: edge.id,
                });
              }}
              onNodeDragStart={beginHistory}
              onSelectionChange={handleSelectionChange}
              onMoveEnd={(event, next) => setViewport(next, Boolean(event))}
              isValidConnection={isValidConnection}
              defaultViewport={viewport ?? undefined}
              fitView={!viewport}
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.2}
              maxZoom={2}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#273248" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="afe-minimap" />
            </ReactFlow>
          )}

          {!loading && nodes.length === 0 && (
            <div className="afe-empty">
              <div className="afe-empty-title">从左侧拖入输入节点开始</div>
              <div className="afe-empty-desc">
                建议顺序：输入 → 处理（LLM / 脚本 / HTTP）→ 输出，然后连线并填写参数。
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div className="afe-issues">
              <div className="afe-issues-head">
                <span>校验结果 · {issues.length}</span>
                <button className="afe-btn afe-btn--text" onClick={() => setIssues([])}>
                  关闭
                </button>
              </div>
              <div className="afe-issues-body">
                {issues.map((issue, index) => (
                  <button
                    type="button"
                    className="afe-issue-item"
                    key={`${issue.code}-${issue.node_id}-${index}`}
                    onClick={() => focusNode(issue.node_id)}
                  >
                    <span
                      className={
                        issue.blocking
                          ? 'afe-issue-code afe-issue-code--blocking'
                          : 'afe-issue-code'
                      }
                    >
                      {issue.code}
                    </span>
                    <span className="afe-issue-msg">{issue.message}</span>
                    {issue.node_id && <span className="afe-dim">{nameOf(issue.node_id)}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && (
            <div className="afe-canvas-info">
              {nodes.length} 个节点 · {edges.length} 条连线
            </div>
          )}
        </main>

        <PropertyPanel variables={variables} latestOutputs={latestOutputs} onDebug={handleDebug} />
      </div>

      <RunDrawer
        runId={runId}
        status={run.status}
        logs={run.logs}
        deltas={run.deltas}
        durationMs={run.durationMs}
        totalTokens={run.totalTokens}
        error={run.error}
        collapsed={drawerCollapsed}
        onToggle={() => setDrawerCollapsed((v) => !v)}
        onCancel={handleCancelRun}
        onClear={handleClearRun}
        onOpenDetail={runId ? () => navigate(`${wsPrefix}/runs/${runId}`) : undefined}
      />

      <RunInputsModal
        open={inputsOpen}
        fields={inputFields}
        loading={starting}
        onCancel={() => setInputsOpen(false)}
        onSubmit={(values) => void startRun(values)}
      />

      {ctxMenu && (
        <div
          className="afe-ctx"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 210),
            top: Math.min(ctxMenu.y, window.innerHeight - 300),
          }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          {ctxMenu.kind === 'node' && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  copySelection();
                  setCtxMenu(null);
                  message.success('已复制，可在画布上 Ctrl+V 粘贴');
                }}
              >
                复制
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  duplicateSelection();
                  setCtxMenu(null);
                }}
              >
                创建副本 <span className="afe-ctx-kbd">Ctrl+D</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleSelectedEnabled();
                  setCtxMenu(null);
                }}
              >
                启用 / 禁用
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => ctxMenu.nodeId && void debugFromMenu(ctxMenu.nodeId)}
              >
                调试此节点
              </button>
              <div className="afe-ctx-sep" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  deleteSelected();
                  setCtxMenu(null);
                }}
              >
                删除 <span className="afe-ctx-kbd">Del</span>
              </button>
            </>
          )}

          {ctxMenu.kind === 'pane' && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  pasteClipboard();
                  setCtxMenu(null);
                }}
              >
                粘贴 <span className="afe-ctx-kbd">Ctrl+V</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSelection(nodes.map((node) => node.id));
                  setCtxMenu(null);
                }}
              >
                全选 <span className="afe-ctx-kbd">Ctrl+A</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleAutoLayout();
                  setCtxMenu(null);
                }}
              >
                自动布局
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  flow.fitView({ padding: 0.25, duration: 300 });
                  setCtxMenu(null);
                }}
              >
                适应视图
              </button>
            </>
          )}

          {ctxMenu.kind === 'edge' && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                if (ctxMenu.edgeId) onEdgesChange([{ id: ctxMenu.edgeId, type: 'remove' }]);
                setCtxMenu(null);
              }}
            >
              删除连线
            </button>
          )}
        </div>
      )}

      <CommandPalette
        open={palette !== null}
        mode={palette ?? 'command'}
        nodes={nodes}
        commands={commands}
        onClose={() => setPalette(null)}
        onPickNode={(nodeId) => {
          setPalette(null);
          focusNode(nodeId);
        }}
      />

      <TriggerDrawer
        open={triggersOpen}
        workflowId={workflowId}
        onClose={() => setTriggersOpen(false)}
      />

      <VersionDrawer
        open={versionsOpen}
        workflowId={workflowId}
        publishedVersionId={publishedVersionId}
        onClose={() => setVersionsOpen(false)}
        onRestored={handleVersionRestored}
        onPublished={handleVersionPublished}
      />
    </div>
  );
}
