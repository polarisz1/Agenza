import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * F4（T5.3.8）验收：无工作流 + 无服务商时自动弹引导；
 * 走「稍后配置模型」→ 选无需模型模板 → 示例运行成功 → 打开编辑器；
 * 完成后不再自动弹出。
 */

async function cleanup(request: APIRequestContext) {
  const workflows = await request.get('/api/workflows');
  if (workflows.ok()) {
    for (const item of (await workflows.json()).data.items) {
      await request.delete(`/api/workflows/${item.id}?confirm=true`);
    }
  }
  const providers = await request.get('/api/providers');
  if (providers.ok()) {
    for (const item of (await providers.json()).data.items) {
      await request.delete(`/api/providers/${item.id}`);
    }
  }
}

test('首次启动引导走完 3 步并跑通示例', async ({ page, request }) => {
  await cleanup(request);
  await page.addInitScript(() => localStorage.removeItem('agentflow.onboarded.v2'));
  await page.goto('/workflows');

  await expect(page.getByText('开始使用 AgentFlow')).toBeVisible();
  await expect(page.getByText('第 1 步 / 3')).toBeVisible();

  // 不配置模型，直接用「无需模型」的模板
  await page.getByText('先不配置模型').click();
  await expect(page.getByText('第 2 步 / 3')).toBeVisible();
  await expect(page.locator('.afe-onb-tpl.on')).toContainText('Python 数据处理');

  await page.getByRole('button', { name: '创建并运行示例' }).click();
  await expect(page.getByText('第 3 步 / 3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('示例运行成功')).toBeVisible({ timeout: 40_000 });

  await page.getByRole('button', { name: '打开编辑器' }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // 完成后不再自动弹出（列表里已有示例工作流）
  await page.goto('/workflows');
  await expect(page.getByText('开始使用 AgentFlow')).toBeHidden();
});
