import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * 编辑器浏览器走查：覆盖主链路最关键的四组自动化。
 *
 * 覆盖点：
 * 1. 模板创建 → 填输入 → 运行 → 成功（主链路）
 * 2. 条件分支：只执行激活的那一支，另一支"已跳过"并给出原因；连续两次运行都正常（F6）
 * 3. 空白工作流：加节点、自动保存状态、校验并展示问题（F1/F2 的落库路径）
 * 4. 列表页正常加载
 */

const BRANCH_GRAPH = {
  version: 1,
  inputs: [],
  nodes: [
    { id: 'in', type: 'input', name: '输入', position: { x: 0, y: 0 }, config: { key: 'a' } },
    {
      id: 'c',
      type: 'condition',
      name: '判断',
      position: { x: 240, y: 0 },
      config: { left: 'a', op: 'eq', right: 'a' },
    },
    {
      id: 'o_true',
      type: 'output',
      name: '真输出',
      position: { x: 480, y: -90 },
      config: { field: 'result' },
    },
    {
      id: 'o_false',
      type: 'output',
      name: '假输出',
      position: { x: 480, y: 90 },
      config: { field: 'result' },
    },
  ],
  edges: [
    { id: 'e1', source: 'in', target: 'c' },
    { id: 'e2', source: 'c', target: 'o_true', from_port: 'true' },
    { id: 'e3', source: 'c', target: 'o_false', from_port: 'false' },
  ],
};

async function seed(request: APIRequestContext, name: string, graph: unknown): Promise<string> {
  const res = await request.post('/api/workflows', { data: { name, graph } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).data.id;
}

/**
 * 点「▶ 运行」并填写输入表单后提交。
 * 只要图里有输入节点，运行前就会先让你填值（即使字段非必填）——
 * 所以要**等弹窗出现**再操作，不能点完立刻判断 isVisible。
 */
async function startRun(page: Page) {
  await page.getByRole('button', { name: '▶ 运行' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('input.afe-input').first().fill('e2e-value');
  await dialog.getByRole('button', { name: '开始运行' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

test('模板创建 + 填写输入 + 运行成功', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.locator('.afe-tpl-card').filter({ hasText: 'Python 数据处理' }).click();

  await expect(page).toHaveURL(/\/workflows\/wf_/);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await page.getByRole('button', { name: '▶ 运行' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('填写运行输入');
  await dialog.locator('input.afe-input').first().fill('hello agentflow');
  await dialog.getByRole('button', { name: '开始运行' }).click();

  await expect(page.getByText('✓ 运行完成')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.afe-runpanel-title')).toContainText('成功');
});

test('条件分支只执行激活的一支，且连续运行两次都正常', async ({ page, request }) => {
  const wfId = await seed(request, 'E2E 分支', BRANCH_GRAPH);
  await page.goto(`/workflows/${wfId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  // 条件节点应有两个分支端口
  await expect(page.locator('.afn-branch--true')).toHaveCount(1);
  await expect(page.locator('.afn-branch--false')).toHaveCount(1);

  await startRun(page);
  await expect(page.getByText('✓ 运行完成')).toBeVisible({ timeout: 30_000 });

  // 只在运行面板里找，避免与画布上的节点名撞车
  const panel = page.locator('.afe-runpanel-body');
  await expect(panel.getByText(/假输出/)).toBeVisible();
  await expect(panel.getByText(/⊘ 跳过/)).toBeVisible();
  await expect(panel.getByText(/分支未激活/)).toBeVisible();

  const firstRun = await page.locator('.afe-runpanel-title').innerText();

  // 第二次运行：游标应随 run 重置，仍能从头看到事件并再次跑完（F6）
  await startRun(page);
  await expect
    .poll(async () => page.locator('.afe-runpanel-title').innerText(), { timeout: 30_000 })
    .not.toBe(firstRun);
  const panelAfter = page.locator('.afe-runpanel-body');
  await expect(panelAfter.getByText('✓ 运行完成')).toBeVisible({ timeout: 30_000 });
  await expect(panelAfter.getByText(/分支未激活/)).toBeVisible();
});

test('空白工作流：加节点、自动保存、校验展示问题', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '新建工作流' }).click();
  await page.getByText('空白工作流', { exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/);

  const lib = (name: string) => page.locator('.afe-lib-item').filter({ hasText: name }).first();
  await lib('输入').click();
  await lib('Python 脚本').click();
  await lib('输出').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  // 自动保存：2s 防抖后从"未保存"变"已保存"
  await expect(page.locator('.afe-save-state')).toContainText('已保存', { timeout: 15_000 });

  await page.getByRole('button', { name: '校验' }).click();
  // 三个节点互不相连：应出现孤立节点提示（提示级，不阻断）
  await expect(page.locator('.afe-issues')).toBeVisible();
  await expect(page.locator('.afe-issue-item').first()).toBeVisible();
});

test('列表页能加载且新建按钮可用', async ({ page }) => {
  await page.goto('/workflows');
  await expect(page.getByRole('button', { name: '新建工作流' })).toBeVisible();
  await expect(page.locator('.ant-table')).toBeVisible();
});
