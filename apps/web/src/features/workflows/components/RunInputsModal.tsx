import { useEffect, useState } from 'react';
import { App, Modal } from 'antd';

import type { WorkflowInputField } from '../types';

interface Props {
  open: boolean;
  fields: WorkflowInputField[];
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

/** 运行前的必填输入表单（PRD §5.5：必填输入未填写先弹表单） */
export default function RunInputsModal({ open, fields, loading, onCancel, onSubmit }: Props) {
  const { message } = App.useApp();
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, any> = {};
    for (const field of fields) {
      initial[field.key] = field.default ?? (field.type === 'bool' ? false : '');
    }
    setValues(initial);
  }, [open, fields]);

  const handleOk = () => {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.key];

      if (field.required && (raw === '' || raw === undefined || raw === null)) {
        message.error(`请填写必填输入：${field.label || field.key}`);
        return;
      }

      if (field.type === 'number') {
        payload[field.key] = raw === '' ? null : Number(raw);
      } else if (field.type === 'json') {
        if (raw === '') {
          payload[field.key] = null;
        } else {
          try {
            payload[field.key] = JSON.parse(String(raw));
          } catch {
            message.error(`输入「${field.label || field.key}」不是合法 JSON`);
            return;
          }
        }
      } else if (field.type === 'bool') {
        payload[field.key] = Boolean(raw);
      } else {
        payload[field.key] = raw;
      }
    }
    onSubmit(payload);
  };

  return (
    <Modal
      title="填写运行输入"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="开始运行"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      {fields.length === 0 ? (
        <div>该工作流没有输入字段，可直接运行。</div>
      ) : (
        <div className="afe-run-form">
          {fields.map((field) => (
            <div className="afe-field" key={field.key}>
              <label>
                {field.label || field.key}
                {field.required && <span className="afe-required"> *</span>}
                <span className="afe-dim"> · {field.type}</span>
              </label>
              {field.type === 'bool' ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.key]: e.target.checked }))
                  }
                />
              ) : field.type === 'json' ? (
                <textarea
                  className="afe-textarea"
                  rows={4}
                  placeholder='{"key": "value"}'
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ) : (
                <input
                  className="afe-input"
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
