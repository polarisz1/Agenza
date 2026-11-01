import { App, Table, Tag, Button, Space, Select, DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listRuns, listWorkflowOptions, rerunRun } from '../api';
import type { RunListItem, WorkflowOption } from '../api';
import { formatDateTime } from '@/shared/utils/datetime';

const { RangePicker } = DatePicker;

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'waiting_input', label: '等待输入' },
  { value: 'running', label: '运行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

const statusColor: Record<string, string> = {
  waiting_input: 'blue',
  running: 'processing',
  success: 'green',
  failed: 'red',
  cancelled: 'default',
};

/** 后端枚举的中文映射（评审 G23：此前 waiting_input 会直接显示英文原值） */
const statusText: Record<string, string> = {
  waiting_input: '等待输入',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function formatTime(value?: string | null): string {
  return formatDateTime(value);
}

/** 后端用 naive UTC 存储，查询参数也传去掉 Z 的 UTC 字符串 */
function toNaiveUtc(value?: Dayjs | null): string | undefined {
  if (!value) return undefined;
  return value.toISOString().replace('Z', '');
}

export default function RunList() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [items, setItems] = useState<RunListItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRuns({
        status: status || undefined,
        workflow_id: workflowId,
        started_after: toNaiveUtc(range?.[0]?.startOf('day')),
        started_before: toNaiveUtc(range?.[1]?.endOf('day')),
      });
      setItems(data);
    } catch (err: any) {
      message.error(err?.message || '加载运行记录失败');
    } finally {
      setLoading(false);
    }
  }, [status, workflowId, range, message]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listWorkflowOptions()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, []);

  const handleRerun = async (id: string) => {
    setRerunning(id);
    try {
      const run = await rerunRun(id);
      message.success(`已重新发起运行 ${run.id}`);
      nav(`/runs/${run.id}`);
    } catch (err: any) {
      message.error(err?.message || '重新运行失败');
    } finally {
      setRerunning(null);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>运行记录</div>
        <Space wrap>
          <Select
            value={status}
            style={{ width: 120 }}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
          <Select
            allowClear
            placeholder="全部工作流"
            style={{ width: 180 }}
            value={workflowId}
            options={workflows.map((wf) => ({ value: wf.id, label: wf.name }))}
            onChange={(value) => setWorkflowId(value)}
          />
          <RangePicker
            value={range}
            onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
          />
          <Button onClick={load}>刷新</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          {
            title: '运行编号',
            dataIndex: 'id',
            render: (text) => <a onClick={() => nav(`/runs/${text}`)}>{text}</a>,
          },
          { title: '工作流', dataIndex: 'workflow_name' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (value) => (
              <Tag color={statusColor[value] || 'default'}>{statusText[value] || value}</Tag>
            ),
          },
          { title: '触发', dataIndex: 'trigger', width: 90 },
          {
            title: '开始时间',
            dataIndex: 'started_at',
            width: 180,
            render: (value) => formatTime(value),
          },
          {
            title: '耗时',
            dataIndex: 'duration_ms',
            width: 90,
            render: (value) => (value != null ? `${(value / 1000).toFixed(1)}s` : '—'),
          },
          {
            title: '操作',
            key: 'ops',
            width: 160,
            render: (_, record) => (
              <Space>
                <Button type="link" size="small" onClick={() => nav(`/runs/${record.id}`)}>
                  详情
                </Button>
                <Button
                  type="link"
                  size="small"
                  loading={rerunning === record.id}
                  onClick={() => void handleRerun(record.id)}
                >
                  以此配置重跑
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
