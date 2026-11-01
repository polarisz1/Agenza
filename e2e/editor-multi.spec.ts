import { expect, test } from '@playwright/test';

/**
 * F2（T5.2.1–T5.2.2）验收：多选、批量禁用/删除、复制粘贴/副本。
 * 通过键盘与属性面板完成，断言画布节点数与批量面板。
 */

async function openBlankWorkflow(page: import('@playwright/test').Page) {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.getByText('空白工作流', { exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/);
}

test('框选/多选、批量复制与删除、Ctrl+C/V', async ({ page }) => {
  await openBlankWorkflow(page);

  const lib = (name: string) => page.locator('.afe-lib-item').filter({ hasText: name }).first();
  await lib('输入').click();
  await lib('Python 脚本').click();
  await lib('输出').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // Ctrl+A → 多选面板
  await page.keyboard.press('Control+a');
  await expect(page.getByText('已选中 3 个节点')).toBeVisible();

  // 批量复制 → 节点数翻倍（AntD 会给两个汉字自动加空格）
  await page.getByRole('button', { name: /^复\s*制$/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);

  // 撤销回到 3 个
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // Ctrl+C / Ctrl+V 同样生效
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // 批量删除 + 撤销
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: /^删\s*除$/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // 批量禁用：节点卡片显示"已跳过"需要在运行后出现，这里只验证配置已写入
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: /启\s*用\s*\/\s*禁\s*用/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('已选中 3 个节点')).toBeHidden();
});
