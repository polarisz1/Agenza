import { expect, test } from '@playwright/test';

/**
 * F4（T5.3.6–T5.3.7）验收：模板中心 8 个模板 + 标签；
 * 「无需模型」的模板可以零配置创建并跑通。
 */

test('模板中心展示 8 个模板与能力标签', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();

  const cards = page.locator('.afe-tpl-card');
  await expect(cards).toHaveCount(9); // 空白 + 8 个模板
  const tags = page.locator('.afe-tpl-card .ant-tag');
  await expect(tags.filter({ hasText: '无需模型' })).toHaveCount(4);
  await expect(tags.filter({ hasText: '需要模型' })).toHaveCount(4);
  await expect(cards.filter({ hasText: '结构化抽取' })).toBeVisible();
  await expect(cards.filter({ hasText: '分类分流' })).toBeVisible();
});

test('无需模型的模板可零配置创建并运行成功', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.locator('.afe-tpl-card').filter({ hasText: '条件分流（无需模型）' }).click();

  await expect(page).toHaveURL(/\/workflows\/wf_/);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  // 输入非必填，但模板含输入字段 → 仍会弹运行表单，直接提交
  await page.getByRole('button', { name: '▶ 运行' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '开始运行' }).click();
  await expect(page.getByText('✓ 运行完成')).toBeVisible({ timeout: 30_000 });
});
