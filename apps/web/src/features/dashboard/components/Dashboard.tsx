import { Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDashboardRuns } from '../api';
import type { RunListItem } from '../api';

const { Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  success: 'green',
  failed: 'red',
  running: 'blue',
  waiting_input: 'gold',
  cancelled: 'default',
};

const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  running: '运行中',
  waiting_input: '等待输入',
  cancelled: '已取消',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<RunListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboardRuns()
      .then((r) => {
        if (!cancelled) {
          setRuns(r);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 今日运行统计
  const todayStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRuns = runs.filter((r) => {
      const started = r.started_at ? new Date(r.started_at) : null;
      return started && started >= today;
    });
    return {
      total: todayRuns.length,
      success: todayRuns.filter((r) => r.status === 'success').length,
      failed: todayRuns.filter((r) => r.status === 'failed').length,
      running: todayRuns.filter((r) => r.status === 'running').length,
    };
  }, [runs]);

  // 近 7 天运行趋势
  const trendData = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const count = runs.filter((r) => {
        const started = r.started_at ? new Date(r.started_at) : null;
        return started && started >= d && started < next;
      }).length;
      days.push({ date: d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }), count });
    }
    return days;
  }, [runs]);

  // 热门工作流（运行次数 Top5）
  const popularWorkflows = useMemo(() => {
    const countMap = new Map<string, { name: string; count: number }>();
    for (const r of runs) {
      const existing = countMap.get(r.workflow_id);
      if (existing) {
        existing.count += 1;
      } else {
        countMap.set(r.workflow_id, { name: r.workflow_name, count: 1 });
      }
    }
    return Array.from(countMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [runs]);

  const maxTrend = Math.max(...trendData.map((d) => d.count), 1);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 今日焦点 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="今日运行" value={todayStats.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="成功" value={todayStats.success} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="失败" value={todayStats.failed} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="运行中" value={todayStats.running} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 运行趋势 */}
        <Col span={14}>
          <Card title="运行趋势（近 7 天）">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, paddingTop: 16 }}>
              {trendData.map((d) => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{d.count}</Text>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 32,
                      height: `${(d.count / maxTrend) * 120}px`,
                      minHeight: d.count > 0 ? 4 : 0,
                      background: 'linear-gradient(180deg, #667eea, #764ba2)',
                      borderRadius: '4px 4px 0 0',
                    }}
                  />
                  <Text type="secondary" style={{ fontSize: 11 }}>{d.date}</Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* 成本分布（占位） */}
        <Col span={10}>
          <Card title="成本分布">
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Text type="secondary">本期为占位展示</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>真实计量将在 Sprint 4 上线</Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 热门工作流 */}
      <Card title="热门工作流（运行次数 Top 5）">
        {popularWorkflows.length === 0 ? (
          <Empty description="暂无运行记录" />
        ) : (
          <Table
            dataSource={popularWorkflows}
            rowKey="name"
            pagination={false}
            size="small"
            columns={[
              { title: '工作流', dataIndex: 'name' },
              {
                title: '运行次数',
                dataIndex: 'count',
                width: 120,
                render: (count: number) => <Tag color="blue">{count} 次</Tag>,
              },
            ]}
          />
        )}
      </Card>

      {/* 最近运行 */}
      <Card title="最近运行">
        {runs.length === 0 ? (
          <Empty description="暂无运行记录" />
        ) : (
          <Table
            dataSource={runs.slice(0, 10)}
            rowKey="id"
            pagination={false}
            size="small"
            columns={[
              { title: '工作流', dataIndex: 'workflow_name' },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (status: string) => (
                  <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status] || status}</Tag>
                ),
              },
              {
                title: '操作',
                width: 80,
                render: (_, record) => (
                  <a onClick={() => navigate(`runs/${record.id}`)}>查看</a>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
