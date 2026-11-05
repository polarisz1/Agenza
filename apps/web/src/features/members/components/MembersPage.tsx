import { Alert, App, Button, Form, Input, Modal, Select, Skeleton } from 'antd';
import { Crown, Trash, UserPlus } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/hooks/useAuthStore';
import EmptyState from '@/shared/components/EmptyState';
import PageHeader from '@/shared/components/PageHeader';
import { Avatar, Card, Pill, SectionHeader } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import { parseServerTime } from '@/shared/utils/datetime';
import {
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
  type MemberInviteRequest,
  type WorkspaceMemberItem,
} from '../api';
import './MembersPage.css';

const ROLE_META: Record<string, { label: string; tone: PillTone }> = {
  owner: { label: 'Owner', tone: 'warning' },
  editor: { label: 'Editor', tone: 'brand' },
  operator: { label: 'Operator', tone: 'neutral' },
  viewer: { label: 'Viewer', tone: 'neutral' },
};

const ASSIGNABLE_ROLES = [
  { value: 'editor', label: 'Editor' },
  { value: 'operator', label: 'Operator' },
  { value: 'viewer', label: 'Viewer' },
];

const LEGEND = [
  { role: 'owner', desc: '完全控制权 · 可管理成员、模型、订阅、删除工作空间' },
  { role: 'editor', desc: '可创建、编辑、发布工作流 · 不可删除工作空间' },
  { role: 'operator', desc: '可运行已发布工作流 · 只读查看输出 · 不可编辑' },
  { role: 'viewer', desc: '只读查看 · 适合外部审计或协作浏览' },
];

function formatJoined(value: string): string {
  const date = parseServerTime(value);
  if (!date) return '—';
  return date.toLocaleDateString('zh-CN');
}

export default function MembersPage() {
  const { message, modal } = App.useApp();
  const { wsId } = useParams<{ wsId: string }>();
  const currentUser = useAuthStore((s) => s.user);
  const [members, setMembers] = useState<WorkspaceMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form] = Form.useForm<MemberInviteRequest>();

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setMembers(await listMembers(wsId));
    } catch (err: any) {
      setLoadError(err?.message || '加载成员失败');
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = async (values: MemberInviteRequest) => {
    if (!wsId) return;
    setInviting(true);
    try {
      await inviteMember(wsId, values);
      message.success('邀请成功');
      setInviteOpen(false);
      form.resetFields();
      await load();
    } catch (err: any) {
      message.error(err?.message || '邀请失败');
    } finally {
      setInviting(false);
    }
  };

  const handleRole = async (member: WorkspaceMemberItem, role: string) => {
    if (!wsId) return;
    setBusyId(member.user_id);
    try {
      await updateMemberRole(wsId, member.user_id, { role });
      message.success(`已将 ${member.name} 调整为 ${ROLE_META[role]?.label || role}`);
      await load();
    } catch (err: any) {
      message.error(err?.message || '变更角色失败');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = (member: WorkspaceMemberItem) => {
    if (!wsId) return;
    modal.confirm({
      title: `移除成员 ${member.name}？`,
      content: '移除后该成员将失去此工作空间的访问权限。',
      okText: '移除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeMember(wsId, member.user_id);
          message.success('已移除');
          await load();
        } catch (err: any) {
          message.error(err?.message || '移除失败');
        }
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="成员管理"
        description={`${members.length} 位成员 · 管理工作空间访问权限`}
        extra={
          <Button type="primary" icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>
            邀请成员
          </Button>
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载成员失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      <Card padded style={{ marginBottom: 16 }}>
        <SectionHeader title="成员列表" description="Owner 可变更角色与移除成员" />
        {loading ? (
          <div className="af-members__loading">
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            title="还没有成员"
            description="邀请同事加入工作空间，一起协作编排工作流。"
            action={<Button onClick={() => setInviteOpen(true)}>邀请成员</Button>}
          />
        ) : (
          <div className="af-members__list">
            {members.map((member) => {
              const isSelf = member.user_id === currentUser?.id;
              return (
                <div className="af-members__row" key={member.user_id}>
                  <div className="af-members__identity">
                    <Avatar name={member.name || member.email} size="md" />
                    <div>
                      <div className="af-members__name">
                        {member.name}
                        {isSelf && <Pill tone="brand">你</Pill>}
                      </div>
                      <div className="af-members__meta">
                        {member.email} · 加入于 {formatJoined(member.joined_at)}
                      </div>
                    </div>
                  </div>
                  <div className="af-members__actions">
                    {member.role === 'owner' ? (
                      <Pill tone="warning" icon={<Crown size={11} />}>
                        Owner
                      </Pill>
                    ) : (
                      <>
                        <Select
                          size="small"
                          value={member.role}
                          style={{ width: 110 }}
                          disabled={busyId === member.user_id}
                          options={ASSIGNABLE_ROLES}
                          onChange={(roleValue) => void handleRole(member, roleValue)}
                        />
                        <Button
                          type="text"
                          danger
                          size="small"
                          aria-label={`移除 ${member.name}`}
                          icon={<Trash size={14} />}
                          onClick={() => handleRemove(member)}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padded>
        <SectionHeader title="角色说明" description="不同角色在工作空间内可执行的操作" />
        <div className="af-members__legend">
          {LEGEND.map((item) => {
            const meta = ROLE_META[item.role];
            return (
              <div className="af-members__legend-item" key={item.role}>
                <Pill tone={meta.tone}>{meta.label}</Pill>
                <div>{item.desc}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        title="邀请成员"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={() => form.submit()}
        okText="发送邀请"
        cancelText="取消"
        confirmLoading={inviting}
        destroyOnHidden
      >
        <Form<MemberInviteRequest>
          form={form}
          layout="vertical"
          initialValues={{ role: 'viewer' }}
          onFinish={(values) => void handleInvite(values)}
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="teammate@example.com" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ASSIGNABLE_ROLES} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
