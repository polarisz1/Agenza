import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWorkspace, listWorkspaces, type WorkspaceResponse } from '../api';

const { Title, Text } = Typography;

export default function WorkspaceList() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载工作空间失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const ws = await createWorkspace(values);
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      navigate(`/workspaces/${ws.id}`);
    } catch (err) {
      if (err instanceof Error && err.message) message.error(err.message);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>我的工作空间</Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          创建工作空间
        </Button>
      </Space>

      {workspaces.length === 0 && !loading ? (
        <Empty description="还没有工作空间，点击右上角创建" />
      ) : (
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
          loading={loading}
          dataSource={workspaces}
          renderItem={(ws) => (
            <List.Item>
              <Card
                hoverable
                onClick={() => navigate(`/workspaces/${ws.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <Card.Meta
                  title={ws.name}
                  description={
                    <Space direction="vertical" size={4}>
                      <Text type="secondary">{ws.description || '暂无描述'}</Text>
                      <Tag color="blue">{ws.plan}</Tag>
                    </Space>
                  }
                />
              </Card>
            </List.Item>
          )}
        />
      )}

      <Modal
        title="创建工作空间"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入工作空间名称' }]}
          >
            <Input placeholder="例如：我的团队" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
