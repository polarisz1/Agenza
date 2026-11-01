/**
 * 兼容性规则的单测（`node --test`）。
 *
 * 只测纯函数，不读文件、不起后端 —— 规则本身才是容易写错的部分。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findBreakingChanges, resolveRef, schemaSignature } from './compat-rules.mjs';

/** 造一个最小契约：POST /api/demo，请求 DemoIn，响应 ApiResponse_DemoOut。 */
function spec({ input = {}, output = {}, inputRequired = [], outputRequired = [] } = {}) {
  return {
    openapi: '3.1.0',
    paths: {
      '/api/demo': {
        post: {
          operationId: 'demo_api_demo_post',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DemoIn' } } },
          },
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ApiResponse_DemoOut_' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        DemoIn: { type: 'object', properties: input, required: inputRequired },
        DemoOut: { type: 'object', properties: output, required: outputRequired },
        ApiResponse_DemoOut_: {
          type: 'object',
          properties: { code: { type: 'integer' }, data: { $ref: '#/components/schemas/DemoOut' } },
          required: ['code', 'data'],
        },
      },
    },
  };
}

test('相同契约没有任何变更', () => {
  const base = spec({ output: { id: { type: 'string' } } });
  const { breaking, warnings } = findBreakingChanges(base, structuredClone(base));
  assert.deepEqual(breaking, []);
  assert.deepEqual(warnings, []);
});

test('接口路径被移除是破坏性变更', () => {
  const base = spec();
  const current = spec();
  delete current.paths['/api/demo'];

  const { breaking } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].path, /\/api\/demo/);
});

test('响应字段被移除是破坏性变更；请求字段被移除只提醒', () => {
  const base = spec({ output: { id: { type: 'string' } }, input: { q: { type: 'string' } } });
  const current = spec({ output: {}, input: {} });

  const { breaking, warnings } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].path, /data\.id/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].path, /body\.q/);
});

test('请求新增必填字段是破坏性变更（老调用方不会传）', () => {
  const base = spec({ input: { q: { type: 'string' } }, inputRequired: ['q'] });
  const current = spec({
    input: { q: { type: 'string' }, page: { type: 'integer' } },
    inputRequired: ['q', 'page'],
  });

  const { breaking } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].message, /新增必填字段/);
});

test('请求字段由可选变必填是破坏性变更', () => {
  const base = spec({ input: { q: { type: 'string' } } });
  const current = spec({ input: { q: { type: 'string' } }, inputRequired: ['q'] });

  const { breaking } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].message, /可选变为必填/);
});

test('请求枚举删除取值是破坏性变更', () => {
  const base = spec({ input: { status: { type: 'string', enum: ['a', 'b'] } } });
  const current = spec({ input: { status: { type: 'string', enum: ['a'] } } });

  const { breaking, warnings } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].message, /枚举/);
  assert.equal(warnings.length, 0);
});

test('响应新增可选字段只提醒', () => {
  const base = spec({ output: { id: { type: 'string' } } });
  const current = spec({ output: { id: { type: 'string' }, name: { type: 'string' } } });

  const { breaking, warnings } = findBreakingChanges(base, current);
  assert.deepEqual(breaking, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].path, /data\.name/);
});

test('字段类型变化是破坏性变更', () => {
  const base = spec({ output: { id: { type: 'string' } } });
  const current = spec({ output: { id: { type: 'integer' } } });

  const { breaking } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].message, /类型变化/);
});

test('operationId 变化会让生成客户端方法名全变', () => {
  const base = spec();
  const current = spec();
  current.paths['/api/demo'].post.operationId = 'renamed_post';

  const { breaking } = findBreakingChanges(base, current);
  assert.equal(breaking.length, 1);
  assert.match(breaking[0].message, /operationId/);
});

test('$ref 会被解析，nullable 包裹不误报', () => {
  const base = spec({ output: { id: { anyOf: [{ type: 'string' }, { type: 'null' }] } } });
  const current = structuredClone(base);
  const resolved = resolveRef(base, { $ref: '#/components/schemas/DemoOut' });
  assert.equal(resolved.type, 'object');
  assert.equal(schemaSignature(base, { $ref: '#/components/schemas/DemoOut' }), 'object');
  assert.deepEqual(findBreakingChanges(base, current).breaking, []);
});
