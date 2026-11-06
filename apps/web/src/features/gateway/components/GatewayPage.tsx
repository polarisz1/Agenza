import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Switch,
} from 'antd';
import {
  ArrowClockwise,
  Brain,
  Lightbulb,
  LockKey,
  PencilSimple,
  Plus,
  Scroll,
  Sparkle,
  Star,
  Trash,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import PageHeader from '@/shared/components/PageHeader';
import { Card, Pill, SectionHeader } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import {
  deleteGatewayRoute,
  getGatewayConfig,
  getGatewayUsage,
  listGatewayRoutes,
  listProviderOptions,
  updateGatewayConfig,
  upsertGatewayRoute,
  type GatewayConfig,
  type GatewayConfigUpdate,
  type GatewayRoute,
  type GatewayRouteUpsert,
  type GatewayUsage,
  type ProviderOption,
  type TaskType,
} from '../api';
import './GatewayPage.css';

const TASK_META: Record<TaskType, { label: string; desc: string; icon: ReactNode }> = {
  default: {
    label: '默认策略',
    desc: '未命中其他规则时使用',
    icon: <Sparkle size={16} />,
  },
  extract: {
    label: '结构化抽取',
    desc: 'extract 节点 / 要求 JSON 输出的 LLM 节点',
    icon: <Sparkle size={16} />,
  },
  long_text: {
    label: '长文本摘要',
    desc: '需要显式设置 route_task_type=long_text',
    icon: <Scroll size={16} />,
  },
  creative: {
    label: '创意生成',
    desc: '需要显式设置 route_task_type=creative',
    icon: <Brain size={16} />,
  },
};

const TASK_OPTIONS = (Object.keys(TASK_META) as TaskType[]).map((value) => ({
  value,
  label: TASK_META[value].label,
}));

function money(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function latency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function GatewayPage() {
  const { message, modal } = App.useApp();

  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [routes, setRoutes] = useState<GatewayRoute[]>([]);
  const [usage, setUsage] = useState<GatewayUsage | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskType | null>(null);

  const [configForm] = Form.useForm<GatewayConfigUpdate>();
  const [routeForm] = Form.useForm<GatewayRouteUpsert>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextConfig, nextRoutes, nextUsage, nextProviders] = await Promise.all([
        getGatewayConfig(),
        listGatewayRoutes(),
        getGatewayUsage(30),
        listProviderOptions(),
      ]);
      setConfig(nextConfig);
      setRoutes(nextRoutes);
      setUsage(nextUsage);
      setProviders(nextProviders);
    } catch (err: any) {
      setLoadError(err?.message || '加载 AI Gateway 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerName = useCallback(
    (id?: string | null) => providers.find((item) => item.id === id)?.name || id || '未配置',
    [providers],
  );

  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: `${provider.name}${provider.enabled ? '' : '（已停用）'}`,
      })),
    [providers],
  );

  const budgetState: { tone: PillTone; text: string } = !config?.enabled
    ? { tone: 'neutral', text: 'Gateway 已停用' }
    : config.hard_stopped
      ? { tone: 'danger', text: '预算已停机' }
      : config.alert_triggered
        ? { tone: 'warning', text: '已达告警阈值' }
        : { tone: 'success', text: '预算正常' };

  const limit = config?.monthly_budget_usd ?? 0;
  const used = config?.used_usd ?? 0;
  const usagePct = Math.min(100, config?.usage_pct ?? 0);
  const alertPct = config?.alert_threshold_pct ?? 80;

  const bestModel = useMemo(() => {
    const models = usage?.models ?? [];
    if (models.length === 0) return null;
    return [...models].sort(
      (a, b) => a.cost_usd - b.cost_usd || b.success_rate - a.success_rate,
    )[0];
  }, [usage]);

  const openConfig = () => {
    configForm.setFieldsValue({
      enabled: config?.enabled ?? true,
      monthly_budget_usd: config?.monthly_budget_usd ?? 0,
      alert_threshold_pct: config?.alert_threshold_pct ?? 80,
      hard_stop: config?.hard_stop ?? true,
    });
    setConfigOpen(true);
  };

  const submitConfig = async () => {
    const values = await configForm.validateFields();
    try {
      setConfig(await updateGatewayConfig(values));
      setConfigOpen(false);
      message.success('预算配置已保存');
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    }
  };

  const openRoute = (route?: GatewayRoute) => {
    setEditingTask(route?.task_type ?? null);
    routeForm.setFieldsValue(
      route
        ? {
            task_type: route.task_type,
            label: route.label ?? '',
            primary_provider_id: route.primary_provider_id ?? undefined,
            primary_model: route.primary_model,
            fallback_provider_id: route.fallback_provider_id ?? undefined,
            fallback_model: route.fallback_model ?? '',
            input_price_per_1k: route.input_price_per_1k,
            output_price_per_1k: route.output_price_per_1k,
            fallback_input_price_per_1k: route.fallback_input_price_per_1k,
            fallback_output_price_per_1k: route.fallback_output_price_per_1k,
            enabled: route.enabled,
          }
        : {
            task_type: 'default',
            label: '',
            primary_provider_id: undefined,
            primary_model: '',
            fallback_provider_id: undefined,
            fallback_model: '',
            input_price_per_1k: 0,
            output_price_per_1k: 0,
            fallback_input_price_per_1k: 0,
            fallback_output_price_per_1k: 0,
            enabled: true,
          },
    );
    setRouteOpen(true);
  };

  const submitRoute = async () => {
    const values = await routeForm.validateFields();
    try {
      await upsertGatewayRoute({
        ...values,
        label: values.label || null,
        primary_provider_id: values.primary_provider_id || null,
        fallback_provider_id: values.fallback_provider_id || null,
        fallback_model: values.fallback_model || null,
      });
      setRouteOpen(false);
      message.success('路由策略已保存');
      await load();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    }
  };

  const removeRoute = (route: GatewayRoute) => {
    modal.confirm({
      title: `删除「${TASK_META[route.task_type].label}」策略？`,
      content: '删除后该任务类型会回退到默认策略；已产生的调用记录不受影响。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteGatewayRoute(route.id);
          message.success('已删除');
          await load();
        } catch (err: any) {
          message.error(err?.message || '删除失败');
        }
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="AI Gateway"
        description="模型路由策略 · 预算控制 · 性能监控"
        extra={
          <>
            <Pill tone={budgetState.tone}>{budgetState.text}</Pill>
            <Button icon={<ArrowClockwise size={14} />} onClick={() => void load()}>
              刷新
            </Button>
            <Button onClick={openConfig}>编辑预算</Button>
          </>
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载 AI Gateway 失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      {loading && !config ? (
        <Card padded>
          <Skeleton active paragraph={{ rows: 10 }} />
        </Card>
      ) : (
        <>
          <Card padded style={{ marginBottom: 16 }}>
            <SectionHeader
              title="预算与告警"
              description="按自然月统计模型调用成本；预算上限为 0 表示不限制"
              extra={
                <Pill tone={config?.hard_stop ? 'warning' : 'neutral'}>
                  {config?.hard_stop ? '硬停机已开启' : '仅告警'}
                </Pill>
              }
            />
            <div className="af-gw__budget-grid">
              <div>
                <div className="af-gw__budget-label">月度预算上限</div>
                <div className="af-gw__budget-value">{limit > 0 ? money(limit) : '不限制'}</div>
              </div>
              <div>
                <div className="af-gw__budget-label">告警阈值（{alertPct}%）</div>
                <div className="af-gw__budget-value" style={{ color: 'var(--af-warning)' }}>
                  {limit > 0 ? money((limit * alertPct) / 100) : '—'}
                </div>
              </div>
              <div>
                <div className="af-gw__budget-label">本月已用</div>
                <div className="af-gw__budget-value">
                  {money(used)}
                  <small>{limit > 0 ? ` (${usagePct}%)` : ` · ${config?.calls ?? 0} 次调用`}</small>
                </div>
              </div>
              <div>
                <div className="af-gw__budget-label">剩余</div>
                <div className="af-gw__budget-value">
                  {config?.remaining_usd != null ? money(config.remaining_usd) : '—'}
                </div>
              </div>
            </div>
            {limit > 0 && (
              <>
                <div className="af-gw__bar">
                  <span className="af-gw__bar-fill" style={{ width: `${usagePct}%` }} />
                  <span className="af-gw__bar-mark" style={{ left: `${alertPct}%` }} />
                  <span
                    className="af-gw__bar-mark af-gw__bar-mark--hard"
                    style={{ left: '100%' }}
                  />
                </div>
                <div className="af-gw__legend">
                  <span>
                    <span className="af-gw__dot" style={{ background: 'var(--af-warning)' }} />{' '}
                    告警阈值 {alertPct}%
                  </span>
                  <span>
                    <span className="af-gw__dot" style={{ background: 'var(--af-danger)' }} />{' '}
                    硬停机 100%
                  </span>
                  <span>
                    Token：{(config?.tokens_in ?? 0).toLocaleString()} in /{' '}
                    {(config?.tokens_out ?? 0).toLocaleString()} out
                  </span>
                </div>
              </>
            )}
            {config?.hard_stopped && (
              <Alert
                style={{ marginTop: 12 }}
                type="error"
                showIcon
                message="模型调用已停止"
                description="本月成本已达到预算上限，LLM / EXTRACT 节点会直接失败。调高预算或关闭硬停机后恢复。"
              />
            )}
            {!config?.hard_stopped && config?.alert_triggered && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="已超过告警阈值"
                description="本月成本已达到告警比例，建议检查高消耗节点或调整路由策略。"
              />
            )}
          </Card>

          <Card padded style={{ marginBottom: 16 }}>
            <SectionHeader
              title="默认模型路由策略"
              description="按任务类型选择首选 / 备选模型；节点设置 routing=auto 时生效"
              extra={
                <Button icon={<Plus size={14} />} onClick={() => openRoute()}>
                  新增策略
                </Button>
              }
            />
            {routes.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有路由策略：未配置时节点继续使用自己选择的模型"
              >
                <Button type="primary" onClick={() => openRoute()}>
                  新增策略
                </Button>
              </Empty>
            ) : (
              routes.map((route) => {
                const meta = TASK_META[route.task_type];
                return (
                  <div className="af-gw__rule" key={route.id}>
                    <div className="af-gw__rule-main">
                      <span className="af-gw__rule-icon">{meta.icon}</span>
                      <div>
                        <div className="af-gw__rule-title">
                          {route.label || meta.label}
                          {!route.enabled && <Pill tone="neutral">已停用</Pill>}
                        </div>
                        <div className="af-gw__rule-desc">
                          {meta.desc} · {money(route.input_price_per_1k, 4)}/1K in ·{' '}
                          {money(route.output_price_per_1k, 4)}/1K out
                        </div>
                      </div>
                    </div>
                    <div className="af-gw__rule-models">
                      <div className="af-gw__rule-side">
                        <div className="af-gw__rule-side-label">首选</div>
                        <Pill tone="brand" icon={<Star size={10} weight="fill" />}>
                          {route.primary_model}
                        </Pill>
                        <div className="af-gw__rule-side-label">
                          {providerName(route.primary_provider_id)}
                        </div>
                      </div>
                      <span className="af-dim">→</span>
                      <div className="af-gw__rule-side">
                        <div className="af-gw__rule-side-label">备选</div>
                        {route.fallback_model ? (
                          <>
                            <Pill tone="warning">{route.fallback_model}</Pill>
                            <div className="af-gw__rule-side-label">
                              {providerName(route.fallback_provider_id)}
                            </div>
                          </>
                        ) : (
                          <Pill tone="neutral">未设置</Pill>
                        )}
                      </div>
                      <Button
                        size="small"
                        type="text"
                        icon={<PencilSimple size={14} />}
                        onClick={() => openRoute(route)}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<Trash size={14} />}
                        onClick={() => removeRoute(route)}
                      />
                    </div>
                  </div>
                );
              })
            )}
            <div className="af-gw__rule-disabled" style={{ marginTop: 8 }}>
              <LockKey size={16} />
              HTTP 请求 / Python 脚本 · 不涉及模型路由
            </div>
          </Card>

          <Card padded>
            <SectionHeader
              title="模型性能仪表板"
              description={`近 30 天 · ${(usage?.calls ?? 0).toLocaleString()} 次调用 · ${money(
                usage?.cost_usd ?? 0,
              )}`}
              extra={<Pill tone="neutral">真实计量</Pill>}
            />
            {usage && usage.models.length > 0 ? (
              <table className="af-gw__table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>调用次数</th>
                    <th>成功率</th>
                    <th>平均延迟</th>
                    <th>Token（in / out）</th>
                    <th>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.models.map((model) => (
                    <tr key={model.model}>
                      <td>
                        <Pill tone="brand">{model.model}</Pill>
                      </td>
                      <td>{model.calls.toLocaleString()}</td>
                      <td style={{ color: 'var(--af-success)' }}>{percent(model.success_rate)}</td>
                      <td>{latency(model.avg_latency_ms)}</td>
                      <td>
                        {model.tokens_in.toLocaleString()} / {model.tokens_out.toLocaleString()}
                      </td>
                      <td>{money(model.cost_usd, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有模型调用记录：运行包含 LLM / EXTRACT 节点的工作流后会出现真实数据"
              />
            )}
            {bestModel && bestModel.calls > 0 ? (
              <div className="af-gw__insight">
                <Lightbulb size={16} />
                <span>
                  {bestModel.model} 成本最低（{money(bestModel.cost_usd, 4)}），成功率{' '}
                  {percent(bestModel.success_rate)}。可在「默认策略」里把它设为非关键任务的首选。
                </span>
              </div>
            ) : (
              <div className="af-gw__insight">
                <Lightbulb size={16} />
                <span>配置路由单价后，这里会按真实 Token 计算成本，并给出可切换模型的建议。</span>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal
        title="预算与告警"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => void submitConfig()}
        okText="保存"
      >
        <Form form={configForm} layout="vertical">
          <Form.Item label="启用 AI Gateway" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="月度预算上限（USD，0 = 不限制）"
            name="monthly_budget_usd"
            rules={[{ required: true, message: '请输入预算上限' }]}
          >
            <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="告警阈值（%）"
            name="alert_threshold_pct"
            rules={[{ required: true, message: '请输入告警阈值' }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="达到上限时停止模型调用" name="hard_stop" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTask ? `编辑「${TASK_META[editingTask].label}」策略` : '新增路由策略'}
        open={routeOpen}
        width={640}
        onCancel={() => setRouteOpen(false)}
        onOk={() => void submitRoute()}
        okText="保存"
      >
        <Form form={routeForm} layout="vertical">
          <Form.Item
            label="任务类型"
            name="task_type"
            rules={[{ required: true, message: '请选择任务类型' }]}
          >
            <Select options={TASK_OPTIONS} disabled={editingTask !== null} />
          </Form.Item>
          <Form.Item label="策略名称" name="label">
            <Input placeholder="例如：结构化抽取 / 质量优先" maxLength={100} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item
              label="首选服务商"
              name="primary_provider_id"
              rules={[{ required: true, message: '请选择服务商' }]}
            >
              <Select options={providerOptions} placeholder="选择服务商" allowClear />
            </Form.Item>
            <Form.Item
              label="首选模型"
              name="primary_model"
              rules={[{ required: true, message: '请输入模型名' }]}
            >
              <Input placeholder="例如：deepseek-v3" />
            </Form.Item>
            <Form.Item label="备选服务商" name="fallback_provider_id">
              <Select options={providerOptions} placeholder="可选" allowClear />
            </Form.Item>
            <Form.Item label="备选模型" name="fallback_model">
              <Input placeholder="可选" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Form.Item label="首选 输入价/1K" name="input_price_per_1k">
              <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="首选 输出价/1K" name="output_price_per_1k">
              <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="备选 输入价/1K" name="fallback_input_price_per_1k">
              <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="备选 输出价/1K" name="fallback_output_price_per_1k">
              <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="启用该策略" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
