import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * F1 验收：运行详情能看到输入/输出，失败可诊断，两次运行可对比。
 * 数据通过 API 造（不依赖 UI），断言全部走界面。
 */

const SCRIPT_OK =
  'import json\n' +
  'from pathlib import Path\n' +
  'data = json.loads(Path("input.json").read_text(encoding="utf-8"))\n' +
  'text = data["inputs"].get("text", "")\n' +
  'agentflow_result = {"length": len(text), "upper": text.upper()}\n';

function graph(script: string) {
  return {
    version: 1,
    inputs: [{ key: 'text', label: 'text', type: 'text', required: false }],
    nodes: [
      {
        id: 'in',
        type: 'input',
        name: '输入1',
        position: { x: 0, y: 0 },
        config: { key: 'text' },
      },
      {
        id: 'py',
        type: 'python',
        name: '脚本1',
        position: { x: 200, y: 0 },
        config: { script },
      },
      {
        id: 'out',
        type: 'output',
        name: '输出1',
        position: { x: 400, y: 0 },
        config: { field: 'result', source: '{{ 脚本1 }}' },
      },
    ],
    edges: [
      { id: 'e1', source: 'in', target: 'py' },
      { id: 'e2', source: 'py', target: 'out' },
    ],
  };
}

async function seedWorkflow(request: APIRequestContext, name: string, script: string) {
  const response = await request.post('/api/workflows', {
    data: { name, graph: graph(script) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data.id as string;
}

async function runWorkflow(
  request: APIRequestContext,
  workflowId: string,
  text: string,
): Promise<string> {
  const started = await request.post(`/api/workflows/${workflowId}/runs`, {
    data: { inputs: { text } },
  });
  expect(started.ok(), await started.text()).toBeTruthy();
  const runId = (await started.json()).data.id as string;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const detail = await request.get(`/api/runs/${runId}`);
    const body = (await detail.json()).data;
    if (body.status !== 'running') return runId;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function expandNode(page: Page, name: string) {
  await page.locator('.rv-node-head').filter({ hasText: name }).first().click();
}

test('运行详情可见输入/输出，且能对比两次运行', async ({ page, request }) => {
  const workflowId = await seedWorkflow(request, `F1 详情 ${Date.now()}`, SCRIPT_OK);
  const first = await runWorkflow(request, workflowId, 'abcd');
  const second = await runWorkflow(request, workflowId, 'xyz');

  await page.goto(`/runs/${second}`);
  await expect(page.getByRole('heading', { name: new RegExp(`运行 ${second}`) })).toBeVisible();
  await expect(page.getByText('运行输入')).toBeVisible();
  await expect(page.locator('.rv-kv').filter({ hasText: 'text' }).first()).toContainText('xyz');

  await expandNode(page, '脚本1');
  await expect(page.locator('.rv-node-body').getByText('输出', { exact: true })).toBeVisible();
  await page.locator('.rv-node-body .rv-tab', { hasText: '输入' }).first().click();
  await expect(page.locator('.rv-code').first()).toContainText('"text": "xyz"');

  // 关键路径：对比上一次
  await page.getByRole('button', { name: '对比上一次' }).click();
  await expect(page).toHaveURL(/\/runs\/compare\?ids=/);
  await expect(page.getByRole('heading', { name: '对比运行' })).toBeVisible();
  await expect(page.getByText('输出差异')).toBeVisible();

  // 默认选中的是第一个有差异的节点（输入节点）；切到脚本1 看它的输出差异
  await page.locator('.rv-compare-row').filter({ hasText: '脚本1' }).click();
  await expect(page.locator('.rv-diff-line.add').filter({ hasText: 'XYZ' })).toHaveCount(1);
  await expect(page.locator('.rv-diff-line.rem').filter({ hasText: 'ABCD' })).toHaveCount(1);

  // 对比的 A/B 顺序不写死，但必须包含两次运行
  expect(await page.textContent('body')).toContain(first);
});

test('失败运行给出可读分类、建议与跳转', async ({ page, request }) => {
  const workflowId = await seedWorkflow(
    request,
    `F1 失败 ${Date.now()}`,
    'raise SystemExit(1)\n',
  );
  const runId = await runWorkflow(request, workflowId, 'boom');

  await page.goto(`/runs/${runId}`);
  await expect(page.getByText('运行失败 ·').first()).toBeVisible();
  // 失败节点默认展开：分类徽标 + 建议 + 打开编辑器
  await expect(page.locator('.rv-error-title')).toContainText('脚本执行失败');
  await expect(page.locator('.rv-error-suggestion')).toContainText('agentflow_result');
  await page.getByRole('button', { name: '在编辑器中打开' }).first().click();

  await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}\\?focus=py`));
  // 编辑器应选中出错节点
  await expect(page.locator('.react-flow__node.selected')).toContainText('脚本1');
});
