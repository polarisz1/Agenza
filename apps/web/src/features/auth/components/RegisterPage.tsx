import { App, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../hooks/useAuthStore';
import AuthShell from './AuthShell';

interface RegisterForm {
  name: string;
  email: string;
  password: string;
  confirm: string;
  workspaceName?: string;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const register = useAuthStore((s) => s.register);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: RegisterForm) => {
    setLoading(true);
    try {
      const wsId = await register(values.email, values.password, values.name, values.workspaceName);
      message.success('注册成功');
      // 注册会自动创建工作空间，直接进入
      navigate(wsId ? `/workspaces/${wsId}` : '/workspaces', { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="创建账号"
      subtitle="加入 AgentFlow，开始构建 AI 工作流"
      wide
    >
      <Form<RegisterForm>
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
      >
        <Form.Item
          label="姓名"
          name="name"
          rules={[{ required: true, message: '请输入姓名' }]}
        >
          <Input placeholder="你的名字" />
        </Form.Item>

        <Form.Item
          label="邮箱"
          name="email"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input placeholder="you@example.com" />
        </Form.Item>

        <Form.Item
          label="工作空间名称"
          name="workspaceName"
          rules={[{ required: true, message: '请输入工作空间名称' }]}
          extra="注册后将自动创建该工作空间"
        >
          <Input placeholder="我的团队" />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 8, message: '密码至少 8 位' },
          ]}
        >
          <Input.Password placeholder="至少 8 位" />
        </Form.Item>

        <Form.Item
          label="确认密码"
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: '请确认密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('两次密码输入不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="再次输入密码" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            注册
          </Button>
        </Form.Item>
      </Form>

      <div className="af-auth__switch">
        已有账号？<Link to="/login">返回登录</Link>
      </div>
    </AuthShell>
  );
}
