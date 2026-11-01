import { createServer, type Server } from 'node:http';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * F3 验收：LLM 流式输出在运行结束前就能看到（node.delta → 运行抽屉）。
 * 用一个本地 mock OpenAI 兼容服务产生 SSE，不依赖真实 Key。
 */

const PORT = 18765;
let server: Server;

function startMockProvider(): Promise<void> {
  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-stream' }] }));
      return;
    }
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        if (!payload.stream) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              model: 'mock-stream',
              choices: [{ message: { content: '非流式结果' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
          );
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const chunks = ['第一段', '第二段', '第三段'];
        const send = (index: number) => {
          if (index >= chunks.length) {
            res.write(
              `data: ${JSON.stringify({
                model: 'mock-stream',
                choices: [{ delta: {} }],
                usage: { prompt_tokens: 3, completion_tokens: 3 },
              })}\n\n`,
            );
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write(
            `data: ${JSON.stringify({
              model: 'mock-stream',
              choices: [{ delta: { content: chunks[index] } }],
            })}\n\n`,
          );
          setTimeout(() => send(index + 1), 350);
        };
        send(0);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
}

test.beforeAll(async () => {
  await startMockProvider();
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function seed(request: APIRequestContext) {
  const providerResponse = await request.post('/api/providers', {
    data: {
      kind: 'openai-compat',
      name: `Mock 流式 ${Date.now()}`,
      base_url: `http://127.0.0.1:${PORT}/v1`,
      api_key: 'sk-mock',
      default_model: 'mock-stream',
      enabled: true,
    },
  });
  expect(providerResponse.ok(), await providerResponse.text()).toBeTruthy();
  const providerId = (await providerResponse.json()).data.id as string;

  const graph = {
    version: 1,
    inputs: [{ key: 'text', label: 'text', type: 'text', required: false }],
    nodes: [
      { id: 'in', type: 'input', name: '输入1', position: { x: 0, y: 0 }, config: { key: 'text' } },
      {
        id: 'llm',
        type: 'llm',
        name: 'LLM1',
        position: { x: 220, y: 0 },
        config: { provider_id: providerId, model: 'mock-stream', prompt: '说三句话：{{ 输入1.text }}' },
      },
      {
        id: 'out',
        type: 'output',
        name: '输出1',
        position: { x: 440, y: 0 },
        config: { field: 'result', source: '{{ LLM1 }}' },
      },
    ],
    edges: [
      { id: 'e1', source: 'in', target: 'llm' },
      { id: 'e2', source: 'llm', target: 'out' },
    ],
  };
  const workflowResponse = await request.post('/api/workflows', {
    data: { name: `流式用例 ${Date.now()}`, graph },
  });
  expect(workflowResponse.ok(), await workflowResponse.text()).toBeTruthy();
  return (await workflowResponse.json()).data.id as string;
}

test('LLM 流式增量在运行结束前可见', async ({ page, request }) => {
  const workflowId = await seed(request);
  await page.goto(`/workflows/${workflowId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await page.getByRole('button', { name: '▶ 运行' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input.afe-input').first().fill('你好');
  await dialog.getByRole('button', { name: '开始运行' }).click();

  // 关键断言：完成之前，抽屉里已经出现增量文本
  const stream = page.locator('.afe-stream-text');
  await expect(stream).toContainText('第一段', { timeout: 15_000 });
  await expect(stream).toContainText('第二段', { timeout: 15_000 });

  await expect(page.getByText('✓ 运行完成')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.afe-stream')).toBeHidden();
  await expect(page.locator('.afe-runpanel-body')).toContainText('LLM1');
});
