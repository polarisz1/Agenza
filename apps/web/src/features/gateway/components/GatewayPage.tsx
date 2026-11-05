import { Brain, Lightbulb, LockKey, Scroll, Sparkle, Star, TrendUp } from '@phosphor-icons/react';

import PageHeader from '@/shared/components/PageHeader';
import { Card, Pill, SectionHeader } from '@/shared/components/ui';
import './GatewayPage.css';

const RULES = [
  {
    icon: <Sparkle size={16} />,
    title: '结构化抽取 / 高格式要求',
    desc: '识别条件：节点类型为 extract 或 output schema 为 JSON',
    primary: 'deepseek-v3',
    primaryTone: 'brand' as const,
    fallback: 'deepseek-flash',
    fallbackTone: 'warning' as const,
  },
  {
    icon: <Scroll size={16} />,
    title: '长文本摘要 / Token 量大',
    desc: '识别条件：input tokens > 3000',
    primary: 'deepseek-flash',
    primaryTone: 'warning' as const,
    fallback: 'deepseek-v3',
    fallbackTone: 'brand' as const,
  },
  {
    icon: <Brain size={16} />,
    title: '创意生成 / 头脑风暴',
    desc: '识别条件：prompt 含创意 / 生成 / 想法关键词',
    primary: 'deepseek-v3',
    primaryTone: 'brand' as const,
    fallback: 'deepseek-flash',
    fallbackTone: 'warning' as const,
  },
];

const MODELS = [
  {
    name: 'deepseek-v3',
    tone: 'brand' as const,
    calls: '1,247',
    success: '98.7%',
    latency: '12.3s',
    tokens: '12.5K',
    cost: '$0.008',
  },
  {
    name: 'deepseek-flash',
    tone: 'warning' as const,
    calls: '4,892',
    success: '99.1%',
    latency: '3.1s',
    tokens: '4.2K',
    cost: '$0.002',
  },
];

export default function GatewayPage() {
  return (
    <div>
      <PageHeader
        title="AI Gateway"
        description="模型路由策略 · 预算控制 · 性能监控"
        extra={<Pill tone="warning">示例数据 · 待接入真实计量</Pill>}
      />

      <Card padded style={{ marginBottom: 16 }}>
        <SectionHeader
          title="预算与告警"
          description="以下为原型占位数据，真实 Token / 费用计量接入后自动替换"
          extra={<Pill tone="neutral">月度</Pill>}
        />
        <div className="af-gw__budget-grid">
          <div>
            <div className="af-gw__budget-label">月度预算上限</div>
            <div className="af-gw__budget-value">$500</div>
          </div>
          <div>
            <div className="af-gw__budget-label">告警阈值（80%）</div>
            <div className="af-gw__budget-value" style={{ color: 'var(--af-warning)' }}>
              $400
            </div>
          </div>
          <div>
            <div className="af-gw__budget-label">硬停机阈值（100%）</div>
            <div className="af-gw__budget-value" style={{ color: 'var(--af-danger)' }}>
              $500
            </div>
          </div>
          <div>
            <div className="af-gw__budget-label">本月已用</div>
            <div className="af-gw__budget-value">
              $323 <small>(65%)</small>
            </div>
          </div>
        </div>
        <div className="af-gw__bar">
          <span className="af-gw__bar-fill" style={{ width: '65%' }} />
          <span className="af-gw__bar-mark" style={{ left: '80%' }} />
          <span className="af-gw__bar-mark af-gw__bar-mark--hard" style={{ left: '100%' }} />
        </div>
        <div className="af-gw__legend">
          <span>
            <span className="af-gw__dot" style={{ background: 'var(--af-warning)' }} /> 告警阈值 80%
          </span>
          <span>
            <span className="af-gw__dot" style={{ background: 'var(--af-danger)' }} /> 硬停机 100%
          </span>
          <span>示例数据，仅供参考</span>
        </div>
      </Card>

      <Card padded style={{ marginBottom: 16 }}>
        <SectionHeader
          title="默认模型路由策略"
          description="按节点类型与输入特征选择首选 / 备选模型"
          extra={<Pill tone="success">策略生效中（示例）</Pill>}
        />
        {RULES.map((rule) => (
          <div className="af-gw__rule" key={rule.title}>
            <div className="af-gw__rule-main">
              <span className="af-gw__rule-icon">{rule.icon}</span>
              <div>
                <div className="af-gw__rule-title">{rule.title}</div>
                <div className="af-gw__rule-desc">{rule.desc}</div>
              </div>
            </div>
            <div className="af-gw__rule-models">
              <div className="af-gw__rule-side">
                <div className="af-gw__rule-side-label">首选</div>
                <Pill tone={rule.primaryTone} icon={<Star size={10} weight="fill" />}>
                  {rule.primary}
                </Pill>
              </div>
              <span className="af-dim">→</span>
              <div className="af-gw__rule-side">
                <div className="af-gw__rule-side-label">备选</div>
                <Pill tone={rule.fallbackTone}>{rule.fallback}</Pill>
              </div>
            </div>
          </div>
        ))}
        <div className="af-gw__rule-disabled" style={{ marginTop: 8 }}>
          <LockKey size={16} />
          HTTP 请求 / Python 脚本 · 不涉及模型路由
        </div>
      </Card>

      <Card padded>
        <SectionHeader
          title="模型性能仪表板"
          description="近 7 天 · 示例数据"
          extra={<Pill tone="neutral">示例</Pill>}
        />
        <table className="af-gw__table">
          <thead>
            <tr>
              <th>模型</th>
              <th>调用次数</th>
              <th>成功率</th>
              <th>平均延迟</th>
              <th>平均 Token</th>
              <th>平均成本</th>
              <th>趋势</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map((model) => (
              <tr key={model.name}>
                <td>
                  <Pill tone={model.tone}>{model.name}</Pill>
                </td>
                <td>{model.calls}</td>
                <td style={{ color: 'var(--af-success)' }}>{model.success}</td>
                <td>{model.latency}</td>
                <td>{model.tokens}</td>
                <td>{model.cost}</td>
                <td style={{ color: 'var(--af-success)' }}>
                  <TrendUp size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="af-gw__insight">
          <Lightbulb size={16} />
          <span>
            deepseek-flash 成功率更高、延迟与成本更低。真实计量接入后，这里会给出可切换模型与预估节省金额。
          </span>
        </div>
      </Card>
    </div>
  );
}
