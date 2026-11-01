import { App, Button, Drawer, Empty, Modal, Spin, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from '@xyflow/react';

import {
  getWorkflowVersion,
  listWorkflowVersions,
  restoreWorkflowVersion,
  type WorkflowResponse,
  type WorkflowVersionDetail,
  type WorkflowVersionItem,
} from '../api';
import { deserializeGraph, type GraphDef } from '../types';
import { nodeTypes } from './nodes';
import './VersionDrawer.css';

interface Props {
  open: boolean;
  workflowId: string | null;
  onClose: () => void;
  onRestored: (workflow: WorkflowResponse) => void;
}

/** 只读版本预览：复用节点渲染，但不可编辑。 */
function VersionCanvas({ graph }: { graph: GraphDef }) {
  const { nodes, edges } = useMemo(() => deserializeGraph(graph), [graph]);
  return (
    <div className="afe-ver-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes.map((node) => ({ ...node, selected: false }))}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#c9d1c8" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** 版本历史抽屉（F5/T5.4.4）：列表 / 只读预览 / 恢复。 */
export default function VersionDrawer({ open, workflowId, onClose, onRestored }: Props) {
  const { message, modal } = App.useApp();
  const [versions, setVersions] = useState<WorkflowVersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkflowVersionDetail | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      setVersions(await listWorkflowVersions(workflowId));
    } catch (err: any) {
      setError(err?.message || '加载版本历史失败');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const openPreview = async (item: WorkflowVersionItem) => {
    if (!workflowId) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    setPreview(null);
    try {
      setPreview(await getWorkflowVersion(workflowId, item.id));
    } catch (err: any) {
      message.error(err?.message || '加载版本失败');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const restore = (item: WorkflowVersionItem) => {
    if (!workflowId) return;
    modal.confirm({
      title: `恢复到 v${item.seq}？`,
      content: '当前内容会先保存为新版本；恢复后画布回到该版本，历史记录不会丢失。',
      okText: '恢复',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRestoring(item.id);
        try {
          const workflow = await restoreWorkflowVersion(workflowId, item.id);
          message.success(`已恢复到 v${item.seq}`);
          onRestored(workflow);
          await load();
        } catch (err: any) {
          message.error(err?.message || '恢复失败');
        } finally {
          setRestoring(null);
        }
      },
    });
  };

  return (
    <>
      <Drawer
        title="版本历史"
        placement="right"
        width={360}
        open={open}
        onClose={onClose}
        className="afe-ver-drawer"
      >
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : error ? (
          <Empty description={error}>
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          </Empty>
        ) : versions.length === 0 ? (
          <Empty description="还没有版本记录（保存后生成）" />
        ) : (
          <div className="afe-ver-list">
            {versions.map((item, index) => (
              <div className="afe-ver-item" key={item.id}>
                <div className="afe-ver-head">
                  <span className="afe-ver-seq">v{item.seq}</span>
                  {index === 0 && <Tag color="green">当前</Tag>}
                  <span className="afe-ver-time">{formatTime(item.created_at)}</span>
                </div>
                <div className="afe-ver-summary">{item.summary || '配置更新'}</div>
                <div className="afe-ver-meta">{item.node_count} 个节点</div>
                <div className="afe-ver-actions">
                  <Button size="small" onClick={() => void openPreview(item)}>
                    预览
                  </Button>
                  <Button
                    size="small"
                    loading={restoring === item.id}
                    onClick={() => restore(item)}
                  >
                    恢复
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <Modal
        open={previewOpen}
        title={preview ? `预览 v${preview.seq}（只读）` : '版本预览'}
        width={900}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
        destroyOnHidden
      >
        {previewLoading || !preview ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <VersionCanvas graph={preview.graph} />
        )}
      </Modal>
    </>
  );
}

function formatTime(value: string): string {
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}
