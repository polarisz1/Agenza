import { Alert, Button, Input, Skeleton, Table } from 'antd';
import { ArrowClockwise, MagnifyingGlass } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import EmptyState from '@/shared/components/EmptyState';
import PageHeader from '@/shared/components/PageHeader';
import { Card, Pill } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/datetime';
import { listAuditLogs, type AuditLogItem } from '../api';

function actionTone(action: string): PillTone {
  const value = action.toLowerCase();
  if (value.includes('delete') || value.includes('remove')) return 'danger';
  if (value.includes('create') || value.includes('register')) return 'success';
  if (value.includes('update') || value.includes('role')) return 'warning';
  if (value.includes('login') || value.includes('auth')) return 'brand';
  return 'neutral';
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listAuditLogs({ action: action.trim() || undefined, limit: 200 });
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setLoadError(err?.message || '加载审计日志失败');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="审计日志"
        description={`共 ${total} 条 · 追踪工作空间内的关键操作`}
        extra={
          <>
            <Input
              allowClear
              placeholder="按 action 精确筛选..."
              prefix={<MagnifyingGlass size={14} />}
              style={{ width: 220 }}
              value={action}
              onChange={(event) => setAction(event.target.value)}
              onPressEnter={() => void load()}
            />
            <Button icon={<ArrowClockwise size={14} />} onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载审计日志失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      <Card>
        {loading && items.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : (
          <Table<AuditLogItem>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <EmptyState
                  title="还没有审计日志"
                  description="成员、工作流与运行的关键操作会记录在这里。"
                />
              ),
            }}
            columns={[
              {
                title: '时间',
                dataIndex: 'created_at',
                width: 180,
                render: (value: string) => (
                  <span className="af-mono" style={{ color: 'var(--af-text-muted)', fontSize: 11 }}>
                    {formatDateTime(value)}
                  </span>
                ),
              },
              {
                title: '操作',
                dataIndex: 'action',
                width: 220,
                render: (value: string) => <Pill tone={actionTone(value)}>{value}</Pill>,
              },
              {
                title: '用户',
                dataIndex: 'user_email',
                width: 220,
                render: (value?: string | null) => value || '—',
              },
              {
                title: '资源',
                key: 'resource',
                width: 200,
                render: (_, record) =>
                  record.resource_type ? (
                    <span>
                      {record.resource_type}
                      {record.resource_id ? (
                        <span
                          className="af-mono"
                          style={{ color: 'var(--af-text-dim)', marginLeft: 6 }}
                        >
                          {record.resource_id}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                title: 'IP',
                dataIndex: 'ip',
                width: 140,
                render: (value?: string | null) => value || '—',
              },
              {
                title: '详情',
                dataIndex: 'detail',
                ellipsis: true,
                render: (value?: string | null) => value || '—',
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
