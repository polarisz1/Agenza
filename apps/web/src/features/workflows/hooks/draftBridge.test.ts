import { describe, expect, it } from 'vitest';

import { flushDraft, registerDraftFlusher } from './draftBridge';

/**
 * 草稿桥：校验/运行/调试/返回列表前要能立刻把属性面板草稿提交进 store（F2）。
 */
describe('draftBridge', () => {
  it('注册后 flush 会调用提交函数', () => {
    let calls = 0;
    registerDraftFlusher(() => {
      calls += 1;
    });

    flushDraft();
    flushDraft();

    expect(calls).toBe(2);
  });

  it('注册为 null 后 flush 是空操作（组件卸载后安全）', () => {
    let calls = 0;
    registerDraftFlusher(() => {
      calls += 1;
    });
    registerDraftFlusher(null);

    expect(() => flushDraft()).not.toThrow();
    expect(calls).toBe(0);
  });
});
