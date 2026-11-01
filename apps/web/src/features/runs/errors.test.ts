import { describe, expect, it } from 'vitest';

import { classifyRunError } from './errors';

describe('classifyRunError', () => {
  it('鉴权失败 → 去模型配置', () => {
    const info = classifyRunError('鉴权失败（HTTP 401）：请检查服务商密钥');
    expect(info.kind).toBe('auth');
    expect(info.action?.target).toBe('models');
    expect(info.suggestion).toContain('密钥');
  });

  it('服务商问题优先于网络问题', () => {
    expect(classifyRunError('服务商未找到或已停用（pv_1）').kind).toBe('provider');
  });

  it('超时', () => {
    expect(classifyRunError('Node timed out after 120.0s').kind).toBe('timeout');
    expect(classifyRunError('请求超时（30s）').kind).toBe('timeout');
  });

  it('网络', () => {
    expect(classifyRunError('无法连接到目标地址').kind).toBe('network');
  });

  it('脚本', () => {
    expect(classifyRunError('Script exit 1: Script did not produce result').kind).toBe('script');
  });

  it('变量', () => {
    expect(classifyRunError("Unknown variable source: 'LLM9'").kind).toBe('variable');
  });

  it('JSON', () => {
    expect(classifyRunError('JSON parse failed: Expecting value').kind).toBe('json');
  });

  it('内部错误（空消息兜底）', () => {
    expect(classifyRunError('NotImplementedError（无错误信息）').kind).toBe('internal');
  });

  it('未知文本回退到通用指引，且永不为空', () => {
    const info = classifyRunError('something odd happened');
    expect(info.kind).toBe('unknown');
    expect(info.label).toBe('运行失败');
    expect(info.suggestion.length).toBeGreaterThan(0);
  });

  it('空错误也给可读结果', () => {
    expect(classifyRunError(null).label).toBe('运行失败');
    expect(classifyRunError('   ').suggestion).toContain('调试');
  });
});
