import { expect, test } from '@playwright/test';

/**
 * F2（T5.2.3–T5.2.6）验收：节点卡 v2 摘要、Ctrl+F 节点搜索、Ctrl+K 命令面板、
 * 右键菜单（副本/粘贴/删除）。
 */

async function openBlankWorkflow(page: import('@playwright/test').Page) {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.getByText('空白工作流', { exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/);
}

test('节点卡 v2 显示类型专属摘要', async ({ page }) => {
  await openBlankWorkflow(page);
  await page.locator('.afe-lib-item').filter({ hasText: 'LLM 调用' }).first().click();

  const node = page.locator('.react-flow__node').first();
  await expect(node).toContainText('未选择模型 · T=0.7');
  await expect(node).toContainText('未填写提示词');
});

test('Ctrl+F 搜索节点并定位', async ({ page }) => {
  await openBlankWorkflow(page);
  const lib = (name: string) => page.locator('.afe-lib-item').filter({ hasText: name }).first();
  await lib('输入').click();
  await lib('Python 脚本').click();

  await page.keyboard.press('Control+f');
  const palette = page.locator('.afe-palette');
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder('搜索节点名称 / 类型…')).toBeVisible();

  await palette.getByPlaceholder('搜索节点名称 / 类型…').fill('脚本');
  await expect(palette.locator('.afe-palette-item')).toHaveCount(1);
  await page.keyboard.press('Enter');

  await expect(palette).toBeHidden();
  await expect(page.locator('.react-flow__node.selected')).toContainText('脚本1');
});

test('Ctrl+K 命令面板可执行导航命令', async ({ page }) => {
  await openBlankWorkflow(page);
  await page.keyboard.press('Control+k');
  const palette = page.locator('.afe-palette');
  await expect(palette).toBeVisible();
  await expect(palette.locator('.afe-palette-foot')).toContainText('命令面板');

  await palette.getByPlaceholder('输入命令…').fill('运行记录');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/runs$/);
});

test('右键菜单：创建副本、粘贴、删除', async ({ page }) => {
  await openBlankWorkflow(page);
  const lib = (name: string) => page.locator('.afe-lib-item').filter({ hasText: name }).first();
  await lib('输入').click();
  await lib('输出').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // 节点右键 → 创建副本
  await page.locator('.react-flow__node').first().click({ button: 'right' });
  const menu = page.locator('.afe-ctx');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').filter({ hasText: '删除' })).toBeVisible();
  await menu.getByRole('menuitem').filter({ hasText: '创建副本' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // 画布空白处右键 → 粘贴（沿用上一次复制的内容）
  const canvas = await page.locator('.afe-canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click((canvas?.x ?? 0) + 40, (canvas?.y ?? 0) + 40, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem').filter({ hasText: '粘贴' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});
