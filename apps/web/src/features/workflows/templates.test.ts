import { describe, expect, it } from 'vitest';

import { WORKFLOW_TEMPLATES, getTemplate } from './templates';

describe('内置模板（F4）', () => {
  it('共 8 个，key 唯一，需要/无需模型各 4 个', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(8);
    expect(new Set(WORKFLOW_TEMPLATES.map((t) => t.key)).size).toBe(8);
    expect(WORKFLOW_TEMPLATES.filter((t) => t.needsProvider)).toHaveLength(4);
    expect(WORKFLOW_TEMPLATES.filter((t) => !t.needsProvider)).toHaveLength(4);
  });

  it.each(WORKFLOW_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s：节点 id 唯一、连线两端存在、有输入/输出',
    (_key, template) => {
      const graph = template.build();
      const ids = (graph.nodes ?? []).map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect((graph.nodes ?? []).some((node) => node.type === 'input')).toBe(true);
      expect((graph.nodes ?? []).some((node) => node.type === 'output')).toBe(true);

      for (const edge of graph.edges ?? []) {
        expect(ids).toContain(edge.source);
        expect(ids).toContain(edge.target);
      }

      const inputKeys = (graph.inputs ?? []).map((field) => field.key);
      expect(new Set(inputKeys).size).toBe(inputKeys.length);
    },
  );

  it('条件分支模板的连线带 from_port', () => {
    for (const key of ['classify-branch', 'condition-split']) {
      const graph = getTemplate(key)?.build();
      const ports = (graph?.edges ?? []).map((edge) => edge.from_port);
      expect(ports).toContain('true');
      expect(ports).toContain('false');
    }
  });

  it('HTTP 模板的 headers 是对象（后端契约要求 dict，不能是 JSON 文本）', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      for (const node of template.build().nodes ?? []) {
        if (node.type === 'http') {
          const headers = node.config?.headers;
          expect(typeof headers).toBe('object');
          expect(Array.isArray(headers)).toBe(false);
        }
      }
    }
  });
});
