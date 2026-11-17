import { Alert, App, Button, Dropdown, Input, Select, Skeleton } from 'antd';
import {
  ChartLine,
  DotsThree,
  Envelope,
  MagnifyingGlass,
  Microphone,
  Newspaper,
  PencilSimple,
  Play,
  Plus,
  SquaresFour,
  Target,
  Warning,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import EmptyState from '@/shared/components/EmptyState';
import { Card, IconButton, Pill } from '@/shared/components/ui';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { formatDateTime, parseServerTime } from '@/shared/utils/datetime';
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  listProviderOptions,
  listWorkflows,
} from '../api';
import type { WorkflowListItem } from '../api';
import { WORKFLOW_TEMPLATES } from '../templates';
import OnboardingWizard from './OnboardingWizard';
import TemplateGallery from './TemplateGallery';
import './WorkflowList.css';

const ONBOARDING_KEY = 'agenza.onboarded.v2';

const CARD_ICONS: ReactNode[] = [
  <Target size={18} key="target" />,
  <Microphone size={18} key="mic" />,
  <Newspaper size={18} key="news" />,
  <Envelope size={18} key="mail" />,
  <ChartLine size={18} key="chart" />,
  <SquaresFour size={18} key="squares" />,
];

const CARD_STYLES = [
  { background: 'rgba(59,130,246,0.15)', color: '#3B82F6' },
  { background: 'rgba(139,92,246,0.15)', color: '#A78BFA' },
  { background: 'rgba(245,158,11,0.15)', color: '#F59E0B' },
  { background: 'rgba(6,182,212,0.15)', color: '#22D3EE' },
  { background: 'rgba(244,63,94,0.15)', color: '#FB7185' },
  { background: 'rgba(34,197,94,0.15)', color: '#4ADE80' },
];

function shortDate(value?: string | null): string {
  const date = parseServerTime(value);
  if (!date) return '—';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function WorkflowList() {
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string>('updated_desc');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 搜索防抖：每敲一个字就发一次请求既浪费也容易乱序（评审 G25）
  const debouncedQ = useDebouncedValue(q, 300);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listWorkflows(debouncedQ || undefined, undefined, sort);
      setItems(data);
    } catch (err: any) {
      // 以前只有 try/finally：接口失败会变成空表 + unhandled rejection（G22）
      setLoadError(err?.message || '加载工作流失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, sort]);

  useEffect(() => {
    load();
  }, [load]);

  // 首次使用（无工作流 + 无服务商）时弹引导；完成/跳过写本地标记（F4）
  useEffect(() => {
    if (loading || items.length > 0) return;
    if (localStorage.getItem(ONBOARDING_KEY) === '1') return;
    let cancelled = false;
    listProviderOptions()
      .then((providers) => {
        if (!cancelled && providers.length === 0) setShowOnboarding(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loading, items.length]);

  const handleCreate = async (key: string) => {
    setGalleryOpen(false);
    setCreating(true);
    try {
      if (key === 'blank') {
        const wf = await createWorkflow({
          name: '未命名工作流',
          description: '',
          graph: { version: 1, inputs: [], nodes: [], edges: [] },
        });
        nav(`${wsPrefix}/workflows/${wf.id}`);
        return;
      }

      const template = WORKFLOW_TEMPLATES.find((item) => item.key === key);
      if (!template) return;
      // 模板自带描述，创建时一并落库，列表的「描述」列才有内容（评审 G28）
      const wf = await createWorkflow({
        name: template.name,
        description: template.description,
        graph: template.build(),
      });
      nav(`${wsPrefix}/workflows/${wf.id}`);
    } catch (err: any) {
      message.error(err?.message || '创建工作流失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateWorkflow(id);
      message.success('已复制');
      load();
    } catch (err: any) {
      message.error(err?.message || '复制失败');
    }
  };

  const handleDelete = (id: string) => {
    modal.confirm({
      title: '确定删除该工作流？',
      content: '工作流将被软删除并从列表隐藏，历史运行记录会保留用于审计。此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteWorkflow(id);
          message.success('已删除');
          load();
        } catch (err: any) {
          message.error(err?.message || '删除失败');
        }
      },
    });
  };

  const publishedCount = items.filter((item) => item.published_version_id).length;
  const draftCount = items.length - publishedCount;

  return (
    <div>
      <div className="af-wf__header">
        <div>
          <h1 className="af-wf__title">工作流</h1>
          <div className="af-wf__subtitle">
            共 {items.length} 个 · 已发布 {publishedCount} · 未发布 {draftCount}
          </div>
        </div>
        <div className="af-wf__actions">
          <Input
            allowClear
            className="af-wf__search"
            placeholder="搜索工作流名称..."
            prefix={<MagnifyingGlass size={14} />}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onPressEnter={() => void load()}
          />
          <Select
            value={sort}
            style={{ width: 132 }}
            onChange={setSort}
            options={[
              { value: 'updated_desc', label: '按最近修改' },
              { value: 'last_run_desc', label: '按最近运行' },
            ]}
          />
          <Button
            type="primary"
            icon={<Plus size={14} />}
            loading={creating}
            onClick={() => setGalleryOpen(true)}
          >
            新建工作流
          </Button>
        </div>
      </div>

      <div className="af-wf__tabs">
        <button type="button" className="af-wf__tab is-active">
          全部 ({items.length})
        </button>
        <button type="button" className="af-wf__tab" disabled title="按成员筛选即将上线">
          我的
        </button>
        <button type="button" className="af-wf__tab" disabled title="团队共享筛选即将上线">
          团队共享
        </button>
        <button type="button" className="af-wf__tab" onClick={() => setGalleryOpen(true)}>
          模板中心
        </button>
        <span className="af-wf__tabs-note">按最近修改排序</span>
      </div>

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载工作流失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      {loading && items.length === 0 ? (
        <div className="af-wf__skeleton">
          {[0, 1, 2].map((index) => (
            <Card key={index} padded>
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ))}
        </div>
      ) : items.length === 0 && !loadError ? (
        <Card padded>
          <EmptyState
            title={debouncedQ ? '没有匹配的工作流' : '还没有工作流'}
            description={
              debouncedQ ? '换个关键词，或清除搜索条件。' : '新建一张空白画布，或从模板中心开始。'
            }
            action={
              debouncedQ ? (
                <Button onClick={() => setQ('')}>清除搜索</Button>
              ) : (
                <Button type="primary" onClick={() => setGalleryOpen(true)}>
                  新建工作流
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="af-wf__grid">
          {items.map((record, index) => {
            const status = record.published_version_id ? (
              record.has_unpublished_changes ? (
                <Pill tone="warning">有未发布修改</Pill>
              ) : (
                <Pill tone="success">已发布</Pill>
              )
            ) : record.status === 'ready' ? (
              <Pill tone="neutral">可运行</Pill>
            ) : (
              <Pill tone="neutral">草稿</Pill>
            );

            return (
              <Card
                key={record.id}
                className="af-wf__card"
                role="button"
                tabIndex={0}
                aria-label={`打开工作流 ${record.name}`}
                onClick={() => nav(`${wsPrefix}/workflows/${record.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    nav(`${wsPrefix}/workflows/${record.id}`);
                  }
                }}
              >
                <div className="af-wf__card-head">
                  <div className="af-wf__identity">
                    <span className="af-wf__icon" style={CARD_STYLES[index % CARD_STYLES.length]}>
                      {CARD_ICONS[index % CARD_ICONS.length]}
                    </span>
                    <div className="af-wf__name-wrap">
                      <div className="af-wf__name" title={record.name}>
                        {record.name}
                      </div>
                      <div className="af-wf__meta">
                        {record.node_count} 节点 · 编辑于 {shortDate(record.updated_at)}
                      </div>
                    </div>
                  </div>
                  {status}
                </div>

                <div className="af-wf__desc">{record.description || '暂无描述'}</div>

                <div className="af-wf__stats">
                  <span>
                    <SquaresFour size={11} /> {record.node_count} 节点
                  </span>
                  <span>
                    <Play size={11} />{' '}
                    {record.last_run_at ? `最近运行 ${shortDate(record.last_run_at)}` : '从未运行'}
                  </span>
                  {record.blocking_count > 0 && (
                    <span className="is-danger">
                      <Warning size={11} /> {record.blocking_count} 个阻断
                    </span>
                  )}
                  {record.blocking_count === 0 && record.issue_count > 0 && (
                    <span className="is-warning">
                      <Warning size={11} /> {record.issue_count} 个提示
                    </span>
                  )}
                </div>

                <div className="af-wf__footer">
                  <span className="af-wf__updated">更新于 {formatDateTime(record.updated_at)}</span>
                  <div className="af-wf__card-actions" onClick={(event) => event.stopPropagation()}>
                    <IconButton
                      label="打开编辑器"
                      icon={<Play size={14} />}
                      onClick={() => nav(`${wsPrefix}/workflows/${record.id}`)}
                    />
                    <IconButton
                      label="编辑"
                      icon={<PencilSimple size={14} />}
                      onClick={() => nav(`${wsPrefix}/workflows/${record.id}`)}
                    />
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'duplicate', label: '复制' },
                          { key: 'delete', label: '删除', danger: true },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'duplicate') void handleDuplicate(record.id);
                          if (key === 'delete') handleDelete(record.id);
                        },
                      }}
                    >
                      <span>
                        <IconButton label="更多操作" icon={<DotsThree size={16} />} />
                      </span>
                    </Dropdown>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateGallery
        open={galleryOpen}
        creating={creating}
        onClose={() => setGalleryOpen(false)}
        onPick={(key) => void handleCreate(key)}
      />

      <OnboardingWizard
        open={showOnboarding}
        onClose={(done) => {
          setShowOnboarding(false);
          if (done) localStorage.setItem(ONBOARDING_KEY, '1');
        }}
        onOpenWorkflow={(workflowId) => nav(`${wsPrefix}/workflows/${workflowId}`)}
      />
    </div>
  );
}
