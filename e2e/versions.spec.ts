import { expect, test } from "@playwright/test";

/**
 * F5（T5.4.4）验收：编辑生成版本 → 只读预览 → 恢复旧版本 → 画布回退。
 */

test("版本历史：预览并可恢复旧版本", async ({ page }) => {
  await page.goto("/workflows");
  await page.getByRole("button", { name: "新建工作流" }).click();
  await page.getByText("空白工作流", { exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/);

  const lib = (name: string) =>
    page.locator(".afe-lib-item").filter({ hasText: name }).first();
  await lib("Python 脚本").click();
  // 自动保存有 2s 防抖：这里用工具栏「保存」显式落库，让版本确定生成
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(600);
  await lib("输出").click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(600);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  await page.getByRole("button", { name: "版本", exact: true }).click();
  const drawer = page.locator(".afe-ver-drawer");
  await expect(drawer).toBeVisible();
  const items = drawer.locator(".afe-ver-item");
  await expect(items.first()).toContainText("当前");
  const total = await items.count();
  expect(total).toBeGreaterThanOrEqual(3);

  // 预览最早的一版（空白图）
  await items
    .last()
    .getByRole("button", { name: /^预\s*览$/ })
    .click();
  await expect(page.getByText(/预览 v1（只读）/)).toBeVisible();
  await page
    .locator(".ant-modal")
    .getByRole("button", { name: /^关\s*闭$/ })
    .click();

  // 恢复 v1：画布回到 0 节点
  await items
    .last()
    .getByRole("button", { name: /^恢\s*复$/ })
    .click();
  const confirm = page.locator(".ant-modal-confirm");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: /^恢\s*复$/ }).click();

  await expect(page.getByText("已恢复到 v1")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.locator(".afe-ver-drawer")).toBeHidden();
});
