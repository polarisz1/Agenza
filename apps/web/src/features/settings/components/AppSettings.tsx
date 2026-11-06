import {
  Alert,
  App,
  Button,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
} from 'antd';
import {
  ClipboardText,
  Coins,
  Crown,
  DownloadSimple,
  Folder,
  Gear,
  Key,
  Package,
  PlayCircle,
  SquaresFour,
  UploadSimple,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import EmptyState from '@/shared/components/EmptyState';
import PageHeader from '@/shared/components/PageHeader';
import { Card, SectionHeader, StatCard } from '@/shared/components/ui';
import {
  clearRuns,
  exportBackup,
  getSettings,
  getSystemInfo,
  getWorkspaceSummary,
  importWorkflows,
  updateSettings,
} from '../api';
import type { SettingsResponse, SystemInfo, WorkflowImportResult, WorkspaceSummary } from '../api';
import ApiKeysPanel from './ApiKeysPanel';
import './AppSettings.css';

type Section = 'overview' | 'workspace' | 'data' | 'system' | 'billing' | 'integrations' | 'danger';

function planLabel(plan?: string): string {
  const value = (plan || 'free').toLowerCase();
  return value === 'free' ? 'Free' : value.charAt(0).toUpperCase() + value.slice(1);
}

function maskDbUrl(url?: string | null): string {
  if (!url) return '—';
  return url.replace(/:\/\/[^@/]+@/, '://***@');
}

export default function AppSettings() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const [, setSettings] = useState<SettingsResponse | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importPreview, setImportPreview] = useState<WorkflowImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [settings, systemInfo, summary] = await Promise.all([
        getSettings(),
        getSystemInfo(),
        wsId ? getWorkspaceSummary(wsId) : Promise.resolve(null),
      ]);
      setSettings(settings);
      setInfo(systemInfo);
      setWorkspace(summary);
      form.setFieldsValue(settings);
    } catch (err: any) {
      // 以前完全没有 catch：接口失败会静默留空表单 + unhandled rejection（G22）
      setLoadError(err?.message || '加载设置失败');
    }
  }, [form, wsId]);

  useEffect(() => {
    void load();
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
      await load();
    } catch (err: any) {
      message.error(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const plan = planLabel(workspace?.plan);
  const memberCount = workspace?.member_count ?? 0;

  return (
    <div>
      <PageHeader
        title="设置中心"
        description={
          workspace
            ? `${workspace.name} · ${plan} 计划 · 用量与工作空间配置`
            : '执行参数、数据备份与系统信息'
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="加载设置失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      <div className="af-settings">
        <aside className="af-settings__nav">
          <div className="af-settings__group">工作空间设置</div>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'overview' ? ' is-active' : ''}`}
            onClick={() => setSection('overview')}
          >
            <SquaresFour size={15} /> 概览（用量仪表板）
          </button>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'workspace' ? ' is-active' : ''}`}
            onClick={() => setSection('workspace')}
          >
            <Gear size={15} /> 工作空间设置
          </button>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'data' ? ' is-active' : ''}`}
            onClick={() => setSection('data')}
          >
            <Folder size={15} /> 数据与备份
          </button>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'system' ? ' is-active' : ''}`}
            onClick={() => setSection('system')}
          >
            <ClipboardText size={15} /> 系统信息
          </button>

          <div className="af-settings__group">协作</div>
          <button
            type="button"
            className="af-settings__nav-item"
            onClick={() => navigate(`${wsPrefix}/members`)}
          >
            <UsersThree size={15} /> 成员管理
          </button>
          <button
            type="button"
            className="af-settings__nav-item"
            onClick={() => navigate(`${wsPrefix}/audit`)}
          >
            <ClipboardText size={15} /> 审计日志
          </button>

          <div className="af-settings__group">集成与账单</div>
          <button
            type="button"
            className="af-settings__nav-item"
            onClick={() => navigate(`${wsPrefix}/models`)}
          >
            <Key size={15} /> 模型与密钥
          </button>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'integrations' ? ' is-active' : ''}`}
            onClick={() => setSection('integrations')}
          >
            <Package size={15} /> Webhook / API Key
          </button>
          <button
            type="button"
            className={`af-settings__nav-item${section === 'billing' ? ' is-active' : ''}`}
            onClick={() => setSection('billing')}
          >
            <Coins size={15} /> 账单与订阅
          </button>

          <div className="af-settings__divider" />
          <button
            type="button"
            className={`af-settings__nav-item is-danger${section === 'danger' ? ' is-active' : ''}`}
            onClick={() => setSection('danger')}
          >
            <Warning size={15} /> 危险操作
          </button>
        </aside>

        <div className="af-settings__content">
          {section === 'overview' && (
            <>
              <div>
                <h2 className="af-settings__heading">概览 · 用量仪表板</h2>
                <div className="af-settings__subheading">
                  {workspace?.name || '当前工作空间'} · {plan} 计划
                </div>
              </div>

              <div className="af-settings__usage">
                <StatCard
                  label="工作流数"
                  value={info?.workflow_count ?? '—'}
                  hint="当前工作空间"
                  icon={<SquaresFour size={16} />}
                />
                <StatCard
                  label="运行次数"
                  value={info?.run_count ?? '—'}
                  hint="全部历史记录"
                  icon={<PlayCircle size={16} />}
                />
                <StatCard
                  label="Token 消耗"
                  value="—"
                  hint="Token 计量待接入"
                  icon={<Coins size={16} />}
                />
                <StatCard
                  label="成员数"
                  value={memberCount}
                  hint="角色见成员管理"
                  icon={<UsersThree size={16} />}
                />
              </div>

              <Card padded className="af-settings__billing">
                <div className="af-settings__billing-head">
                  <Crown size={16} weight="fill" />
                  {plan} 计划
                </div>
                <div className="af-settings__billing-meta">
                  当前工作空间包含 {memberCount} 位成员与 {info?.provider_count ?? 0} 个模型服务商。
                  账单、发票与在线支付能力即将上线。
                </div>
                <div className="af-settings__actions" style={{ marginTop: 12 }}>
                  <Button onClick={() => setSection('billing')}>查看订阅</Button>
                  <Button onClick={() => navigate(`${wsPrefix}/members`)}>管理成员</Button>
                </div>
              </Card>
            </>
          )}

          {/* 始终挂载 Form，避免 useForm 实例在首次加载时未连接任何 Form 产生告警 */}
          <div style={{ display: section === 'workspace' ? 'block' : 'none' }}>
            <Card padded>
              <SectionHeader title="工作空间设置" description="执行参数与数据保留策略" />
              <Form
                form={form}
                layout="vertical"
                style={{ maxWidth: 520 }}
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
                <Form.Item name="default_timeout" label="默认超时（秒）">
                  <InputNumber min={5} max={3600} style={{ width: 200 }} />
                </Form.Item>
                <Form.Item
                  name="retention_per_workflow"
                  label="每个工作流保留运行条数"
                >
                  <InputNumber min={20} max={5000} style={{ width: 200 }} />
                </Form.Item>
                <Button type="primary" htmlType="submit">
                  保存设置
                </Button>
              </Form>
            </Card>
          </div>

          {section === 'data' && (
            <Card padded>
              <SectionHeader title="数据与备份" description="导出或导入工作空间数据" />
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="导出内容包含设置与全部工作流，不包含服务商与密钥。"
              />
              <div className="af-settings__actions">
                <Button
                  loading={exporting}
                  icon={<DownloadSimple size={14} />}
                  onClick={() => void handleExport()}
                >
                  导出备份
                </Button>
                <Button icon={<UploadSimple size={14} />} onClick={() => fileRef.current?.click()}>
                  导入工作流
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={(event) => void handleFile(event)}
                />
              </div>
            </Card>
          )}

          {section === 'system' && (
            <Card padded>
              <SectionHeader title="系统信息" description="当前运行环境与数据规模" />
              {info ? (
                <div className="af-settings__kv">
                  <span className="k">应用</span>
                  <span className="v">
                    {info.app_name} v{info.version}
                  </span>
                  <span className="k">工作流数</span>
                  <span className="v">{info.workflow_count}</span>
                  <span className="k">运行数</span>
                  <span className="v">{info.run_count}</span>
                  <span className="k">服务商数</span>
                  <span className="v">{info.provider_count}</span>
                  <span className="k">数据目录</span>
                  <span className="v af-mono">{info.data_dir}</span>
                  <span className="k">数据库</span>
                  <span className="v af-mono">{maskDbUrl(info.db_url)}</span>
                </div>
              ) : (
                <EmptyState title="暂无系统信息" description="接口未返回数据。" />
              )}
            </Card>
          )}

          {section === 'billing' && (
            <Card padded className="af-settings__billing">
              <div className="af-settings__billing-head">
                <Crown size={16} weight="fill" />
                {plan} 计划
              </div>
              <div className="af-settings__billing-meta">
                当前工作空间包含 {memberCount} 位成员。账单明细、发票下载与在线支付能力即将上线，
                如需调整订阅请联系管理员。
              </div>
              <div className="af-settings__actions" style={{ marginTop: 12 }}>
                <Button onClick={() => setSection('overview')}>返回用量概览</Button>
                <Button disabled>升级 / 降级（即将上线）</Button>
              </div>
            </Card>
          )}

          {section === 'integrations' && (
            <Card padded>
              <SectionHeader
                title="Webhook / API Key"
                description="外部系统触发工作流：API Key 用于 HTTP 触发，Webhook 触发器按工作流配置"
              />
              {wsId && !workspace ? (
                <div style={{ padding: 32, textAlign: 'center' }}>
                  <Spin />
                </div>
              ) : (
                <ApiKeysPanel canManage={!wsId || workspace?.my_role === 'owner'} />
              )}
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 16 }}
                message="Webhook 触发器在工作流编辑器中配置"
                description="每个触发器有独立 Secret，公网请求需携带 HMAC-SHA256 签名；也可以直接用 API Key 调用 HTTP 触发。"
                action={
                  <Button size="small" onClick={() => navigate(`${wsPrefix}/workflows`)}>
                    前往工作流
                  </Button>
                }
              />
            </Card>
          )}

          {section === 'danger' && (
            <Card padded>
              <SectionHeader title="危险操作" description="以下操作不可撤销，请谨慎执行" />
              <Space wrap>
                <Popconfirm
                  title="确定清空全部运行记录？"
                  description="此操作不可逆。"
                  okText="清空"
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    try {
                      const res = await clearRuns();
                      message.success(`已清空 ${res.cleared} 条`);
                      await load();
                    } catch (err: any) {
                      message.error(err?.message || '清空失败');
                    }
                  }}
                >
                  <Button danger>清空运行记录</Button>
                </Popconfirm>
              </Space>
            </Card>
          )}
        </div>
      </div>

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
