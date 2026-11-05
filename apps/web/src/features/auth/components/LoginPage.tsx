import { App, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../hooks/useAuthStore';
import AuthShell from './AuthShell';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const login = useAuthStore((s) => s.login);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const wsId = await login(values.email, values.password);
      message.success('登录成功');
      // 直接进入默认工作空间；后端未返回工作空间时退回列表页
      navigate(wsId ? `/workspaces/${wsId}` : '/workspaces', { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="登录 AgentFlow" subtitle="多租户 AI 工作流编排平台">
      <Form<LoginForm>
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
      >
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
          label="密码"
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password placeholder="••••••••" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form.Item>
      </Form>

      <div className="af-auth__switch">
        还没有账号？<Link to="/register">立即注册</Link>
      </div>
    </AuthShell>
  );
}
