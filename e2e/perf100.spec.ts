import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * B1 · 100 节点性能基线（此前从未压测）。
 *
 * 目标（roadmap M2 验收 + backlog B1）：
 *   1. 100 节点画布拖拽 ≥ 30fps
 *   2. 发起运行后主线程不被长任务卡死（长任务 < 1000ms）
 *
 * 阈值故意留得比实测宽：这是**回归闸门**（防止某次改动把性能砍半），不是跑分。
 * 实测数字记录在 docs/v0.1-perf-baseline.md。
 */

const NODE_COUNT = 100;

/** 1 个输入 + 99 个输出，全部直连输入：运行只走一层并行，适合压 UI 而不是压模型。 */
function build100NodeGraph() {
  const nodes: unknown[] = [
    {
      id: 'n_input',
      type: 'input',
      name: '输入1',
      position: { x: 40, y: 40 },
      config: { key: 'text', data_type: 'text', required: false },
    },
  ];
  for (let index = 1; index < NODE_COUNT; index += 1) {
    nodes.push({
      id: `n_out_${index}`,
      type: 'output',
      name: `输出${index}`,
      position: { x: 420 + (index % 10) * 40, y: 40 + Math.floor(index / 10) * 90 },
      config: { field: `result_${index}`, source: '{{ 输入1.text }}', format: 'text' },
    });
  }

  const edges = Array.from({ length: NODE_COUNT - 1 }, (_, index) => ({
    id: `e_${index}`,
    source: 'n_input',
    target: `n_out_${index + 1}`,
  }));

  return { version: 1, inputs: [], nodes, edges };
}

async function seedWorkflow(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/workflows', {
    data: { name, description: '100 节点性能基线', graph: build100NodeGraph() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).data.id;
}

test('100 节点：拖拽帧率 ≥ 30fps，运行期间无超长任务', async ({ page, request }) => {
  test.setTimeout(120_000);

  const workflowId = await seedWorkflow(request, `性能基线 ${Date.now()}`);
  await page.goto(`/workflows/${workflowId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(NODE_COUNT, { timeout: 30_000 });

  // ---------- 1) 拖拽帧率 ----------
  await page.evaluate(() => {
    const state = window as unknown as { __frames: number; __stop: boolean };
    state.__frames = 0;
    state.__stop = false;
    const loop = () => {
      state.__frames += 1;
      if (!state.__stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const target = page.locator('.react-flow__node').first();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const startY = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  const startedAt = Date.now();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(startX + step * 6, startY + step * 2);
  }
  await page.mouse.up();
  const draggedMs = Date.now() - startedAt;

  const frames = await page.evaluate(() => {
    const state = window as unknown as { __frames: number; __stop: boolean };
    state.__stop = true;
    return state.__frames;
  });

  const fps = frames / (draggedMs / 1000);
  console.log(
    `[perf] 拖拽 ${NODE_COUNT} 节点：${frames} 帧 / ${draggedMs}ms = ${fps.toFixed(1)}fps`,
  );
  expect(draggedMs).toBeGreaterThan(200);
  expect(fps).toBeGreaterThanOrEqual(30);

  // ---------- 2) 运行期间的长任务 ----------
  await page.evaluate(() => {
    const state = window as unknown as { __long: number[] };
    state.__long = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.__long.push(entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
  });

  await page.getByRole('button', { name: '▶ 运行' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('input.afe-input').first().fill('perf-baseline');
  await dialog.getByRole('button', { name: '开始运行' }).click();

  await expect(page.getByText('✓ 运行完成')).toBeVisible({ timeout: 60_000 });

  const longTasks = await page.evaluate(
    () => (window as unknown as { __long: number[] }).__long,
  );
  const worst = longTasks.length ? Math.max(...longTasks) : 0;
  console.log(
    `[perf] 运行期间长任务：${longTasks.length} 个，最长 ${worst.toFixed(0)}ms（阈值 1000ms）`,
  );

  // 长任务 >1s 意味着 UI 已经明显卡顿；100 节点下应力争远低于此
  expect(worst).toBeLessThan(1_000);
});
