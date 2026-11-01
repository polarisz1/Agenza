import { Modal, Tag } from 'antd';
import { useMemo } from 'react';

import { NODE_META, type NodeType } from '../types';
import { WORKFLOW_TEMPLATES } from '../templates';
import './TemplateGallery.css';

interface Props {
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onPick: (key: 'blank' | string) => void;
}

/** 模板中心（F4/T5.3.7）：空白 + 8 个内置模板，卡片展示标签/节点数/节点类型。 */
export default function TemplateGallery({ open, creating, onClose, onPick }: Props) {
  const templates = useMemo(
    () =>
      WORKFLOW_TEMPLATES.map((template) => {
        const graph = template.build();
        const types = [...new Set((graph.nodes ?? []).map((node) => node.type as NodeType))];
        return {
          ...template,
          nodeCount: graph.nodes?.length ?? 0,
          types,
        };
      }),
    [],
  );

  return (
    <Modal
      open={open}
      title="从模板新建"
      footer={null}
      width={880}
      onCancel={onClose}
      destroyOnHidden
      className="afe-tpl-modal"
    >
      <div className="afe-tpl-grid">
        <button
          type="button"
          className="afe-tpl-card afe-tpl-card--blank"
          disabled={creating}
          onClick={() => onPick('blank')}
        >
          <div className="afe-tpl-name">空白工作流</div>
          <div className="afe-tpl-desc">从一张空画布开始，自己拖节点、连线。</div>
          <div className="afe-tpl-meta">
            <Tag>0 个节点</Tag>
          </div>
        </button>

        {templates.map((template) => (
          <button
            type="button"
            key={template.key}
            className="afe-tpl-card"
            disabled={creating}
            onClick={() => onPick(template.key)}
          >
            <div className="afe-tpl-name">{template.name}</div>
            <div className="afe-tpl-desc">{template.description}</div>
            <div className="afe-tpl-meta">
              <Tag color={template.needsProvider ? 'blue' : 'green'}>
                {template.needsProvider ? '需要模型' : '无需模型'}
              </Tag>
              <Tag>{template.nodeCount} 个节点</Tag>
              <span className="afe-tpl-types">
                {template.types.map((type) => (
                  <span
                    key={type}
                    className="afe-tpl-dot"
                    style={{ background: NODE_META[type].color }}
                    title={NODE_META[type].label}
                  />
                ))}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="afe-tpl-foot">
        选一个最接近需求的模板，创建后仍可自由改节点与连线；「无需模型」的模板可以零配置直接跑。
      </div>
    </Modal>
  );
}
