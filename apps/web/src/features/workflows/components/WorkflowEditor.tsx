import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message } from 'antd';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useRunStream } from '@/features/runs/hooks/useRunStream';

import {
  cancelWorkflowRun,
  createWorkflow,
  getLatestRunNodeOutputs,
  getWorkflow,
  runWorkflow,
  testNode,
  validateWorkflow,
  type NodeTestResult,
  type WorkflowResponse,
} from '../api';
import {
  BLOCKING_ISSUE_CODES,
  NODE_DRAG_MIME,
  NODE_META,
  canConnect,
  extractWorkflowInputs,
  type EditorNode,
  type NodeType,
  type RuntimeStatus,
  type ValidateIssue,
} from '../types';
import { useAutoSave } from '../hooks/useAutoSave';
import { useEditorStore } from '../hooks/useEditorStore';
import { useVariables } from '../hooks/useVariables';
import { nodeTypes } from './nodes';
import NodeLibrary from './NodeLibrary';
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
  const { id } = useParams();
  const navigate = useNavigate();
  const flow = useReactFlow();

  const workflowId = useEditorStore((s) => s.workflowId);
  const name = useEditorStore((s) => s.name);
  const status = useEditorStore((s) => s.status);
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
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const onConnect = useEditorStore((s) => s.onConnect);
  const addNode = useEditorStore((s) => s.addNode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const autoLayout = useEditorStore((s) => s.autoLayout);
  const beginHistory = useEditorStore((s) => s.beginHistory);
  const loadWorkflow = useEditorStore((s) => s.load);

  const { saveNow } = useAutoSave(workflowId);

  const [runId, setRunId] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidateIssue[]>([]);
  const [latestOutputs, setLatestOutputs] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);

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
            graph: { version: 1, inputs: [], nodes: [], edges: [] },
          });
          creatingRef.current = false;
          // StrictMode 下首个 effect 会被清理，这里不依赖 cancelled 标记，确保只创建一次并跳转
          navigate(`/workflows/${created.id}`, { replace: true });
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
          status: wf.status,
          graph: wf.graph,
          viewport: (wf.viewport as any) ?? null,
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow, undo, redo]);

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

  const issueIds = useMemo(
    () => new Set(issues.map((i) => i.node_id).filter(Boolean)),
    [issues],
  );

  // 把运行态 / 校验态叠加到节点数据上；未变化节点保持原引用，避免全量重渲染
  const runtimeNodes = useMemo<EditorNode[]>(() => {
    const running = run.status === 'running';
    return nodes.map((node) => {
      const live = run.nodes[node.id];
      let nextStatus: RuntimeStatus | undefined;
      if (live) nextStatus = live.status;
      else if (running) nextStatus = 'queued';

      const hasIssue = issueIds.has(node.id);
      if (node.data.runtimeStatus === nextStatus && node.data.hasIssue === hasIssue) {
        return node;
      }
      return { ...node, data: { ...node.data, runtimeStatus: nextStatus, hasIssue } };
    });
  }, [nodes, run.nodes, run.status, issueIds]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      if (!source || !target || source.id === target.id) return false;
      return canConnect(source.data.type, target.data.type);
    },
    [nodes],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: EditorNode[] }) => {
      select(selected[0]?.id ?? null);
    },
    [select],
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

  const runValidation = useCallback(async (): Promise<ValidateIssue[]> => {
    const wfId = useEditorStore.getState().workflowId;
    if (!wfId) return [];
    setValidating(true);
    try {
      const saved = await saveNow();
      if (!saved) {
        message.error('保存失败，无法校验');
        return [];
      }
      const result = await validateWorkflow(wfId);
      const list = (result.issues ?? []) as unknown as ValidateIssue[];
      setIssues(list);
      return list;
    } catch (err: any) {
      message.error(err?.message || '校验失败');
      return [];
    } finally {
      setValidating(false);
    }
  }, [saveNow]);

  const handleValidate = async () => {
    const list = await runValidation();
    const blocking = list.filter((i) => BLOCKING_ISSUE_CODES.has(i.code));
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
    const blocking = list.filter((i) => BLOCKING_ISSUE_CODES.has(i.code));
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
      const saved = await saveNow();
      if (!saved) throw new Error('保存失败，无法调试');
      return testNode(wfId, nodeId);
    },
    [saveNow],
  );

  const nameOf = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.data.label || nodeId;

  const inputFields = useMemo(() => extractWorkflowInputs(nodes), [nodes]);

  return (
    <div className="afe-root">
      <div className="afe-header">
        <button className="afe-back" onClick={() => navigate('/workflows')}>
          ← 返回
        </button>

        <div className="afe-title-wrap">
          <input
            className="afe-title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="工作流名称"
          />
          <span className={status === 'ready' ? 'afe-tag afe-tag--success' : 'afe-tag afe-tag--draft'}>
            {status === 'ready' ? '就绪' : '草稿'}
          </span>

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
          <button className="afe-btn" onClick={undo} disabled={pastCount === 0}>
            ↶ 撤销
          </button>
          <button className="afe-btn" onClick={redo} disabled={futureCount === 0}>
            ↷ 重做
          </button>
          <button className="afe-btn" onClick={handleAutoLayout}>
            ⊞ 自动布局
          </button>
          <button className="afe-btn" onClick={handleValidate} disabled={validating || creating}>
            {validating ? '校验中…' : '校验'}
          </button>
          <button className="afe-btn" onClick={() => void saveNow()} disabled={!workflowId}>
            保存
          </button>
          <button
            className="afe-btn afe-btn--primary"
            onClick={handleRun}
            disabled={starting || creating || loading}
          >
            {starting ? '发起中…' : '▶ 运行'}
          </button>
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
              onNodeDragStart={beginHistory}
              onSelectionChange={handleSelectionChange}
              onMoveEnd={(_, next) => setViewport(next)}
              isValidConnection={isValidConnection}
              defaultViewport={viewport ?? undefined}
              fitView={!viewport}
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.2}
              maxZoom={2}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#c9d1c8" />
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
                        BLOCKING_ISSUE_CODES.has(issue.code)
                          ? 'afe-issue-code afe-issue-code--blocking'
                          : 'afe-issue-code'
                      }
                    >
                      {issue.code}
                    </span>
                    <span className="afe-issue-msg">{issue.message}</span>
                    {issue.node_id && (
                      <span className="afe-dim">{nameOf(issue.node_id)}</span>
                    )}
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

        <PropertyPanel
          variables={variables}
          latestOutputs={latestOutputs}
          onDebug={handleDebug}
        />
      </div>

      <RunDrawer
        runId={runId}
        status={run.status}
        logs={run.logs}
        durationMs={run.durationMs}
        totalTokens={run.totalTokens}
        error={run.error}
        collapsed={drawerCollapsed}
        onToggle={() => setDrawerCollapsed((v) => !v)}
        onCancel={handleCancelRun}
        onClear={handleClearRun}
      />

      <RunInputsModal
        open={inputsOpen}
        fields={inputFields}
        loading={starting}
        onCancel={() => setInputsOpen(false)}
        onSubmit={(values) => void startRun(values)}
      />
    </div>
  );
}
