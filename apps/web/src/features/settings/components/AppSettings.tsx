import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Popconfirm,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearRuns,
  exportBackup,
  getSettings,
  getSystemInfo,
  importWorkflows,
  updateSettings,
} from '../api';
import type { SettingsResponse, SystemInfo, WorkflowImportResult } from '../api';

export default function AppSettings() {
  const { message } = App.useApp();
  const [, setSettings] = useState<SettingsResponse | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importPreview, setImportPreview] = useState<WorkflowImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, i] = await Promise.all([getSettings(), getSystemInfo()]);
      setSettings(s);
      setInfo(i);
      form.setFieldsValue(s);
    } catch (err: any) {
      // 以前完全没有 catch：接口失败会静默留空表单 + unhandled rejection（G22）
      setLoadError(err?.message || '加载设置失败');
    }
  }, [form]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBackup();
      message.success('备份已开始下载');
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const preview = await importWorkflows(payload, false);
      setImportPayload(payload);
      setImportPreview(preview);
    } catch (err: any) {
      message.error(err?.message || '读取导入文件失败');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPayload) return;
    setImporting(true);
    try {
      const result = await importWorkflows(importPayload, true);
      message.success(`已导入 ${result.created_ids.length} 个工作流`);
      setImportPreview(null);
      setImportPayload(null);
      load();
    } catch (err: any) {
      message.error(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message="加载设置失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}
      <Card title="本机设置">
        <Form
          form={form}
          layout="inline"
          onFinish={async (values) => {
            try {
              const updated = await updateSettings(values);
              setSettings(updated);
              message.success('已保存');
            } catch (err: any) {
              message.error(err?.message || '保存设置失败');
            }
          }}
        >
          <Form.Item name="auto_save" label="自动保存" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="default_timeout" label="默认超时(秒)">
            <InputNumber min={5} max={3600} />
          </Form.Item>
          <Form.Item name="retention_per_workflow" label="每工作流保留条数">
            <InputNumber min={20} max={5000} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="备份与恢复">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="导出内容包含设置与全部工作流，不包含服务商与密钥。"
        />
        <Space wrap>
          <Button loading={exporting} onClick={() => void handleExport()}>
            导出备份
          </Button>
          <Button onClick={() => fileRef.current?.click()}>导入工作流</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(event) => void handleFile(event)}
          />
        </Space>
      </Card>

      <Card title="系统信息">
        {info && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="应用">
              {info.app_name} v{info.version}
            </Descriptions.Item>
            <Descriptions.Item label="工作流数">{info.workflow_count}</Descriptions.Item>
            <Descriptions.Item label="运行数">{info.run_count}</Descriptions.Item>
            <Descriptions.Item label="服务商数">{info.provider_count}</Descriptions.Item>
            <Descriptions.Item label="数据目录" span={2}>
              {info.data_dir}
            </Descriptions.Item>
            <Descriptions.Item label="数据库" span={2}>
              {info.db_url}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Card title="危险操作" bordered={false} style={{ borderColor: '#ffccc7' }}>
        <Space>
          <Popconfirm
            title="确定清空全部运行记录？"
            description="此操作不可逆。"
            okText="清空"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                const res = await clearRuns();
                message.success(`已清空 ${res.cleared} 条`);
                load();
              } catch (err: any) {
                message.error(err?.message || '清空失败');
              }
            }}
          >
            <Button danger>清空运行记录</Button>
          </Popconfirm>
        </Space>
      </Card>

      <Modal
        title="导入预览"
        open={Boolean(importPreview)}
        onCancel={() => {
          setImportPreview(null);
          setImportPayload(null);
        }}
        onOk={() => void handleConfirmImport()}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={importing}
        width={620}
      >
        <Table
          size="small"
          pagination={false}
          rowKey={(record) => `${record.name}-${record.target_name}`}
          dataSource={importPreview?.items ?? []}
          columns={[
            { title: '文件中的名称', dataIndex: 'name' },
            {
              title: '导入为',
              dataIndex: 'target_name',
              render: (value, record) =>
                record.conflict ? (
                  <span>
                    {value} <Tag color="orange">重名，自动生成副本</Tag>
                  </span>
                ) : (
                  value
                ),
            },
            { title: '节点数', dataIndex: 'node_count', width: 80 },
          ]}
        />
      </Modal>
    </div>
  );
}
