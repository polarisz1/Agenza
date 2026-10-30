import { describe, expect, it } from 'vitest';

import { toEditorPreferences } from './index';

/**
 * 设置 → 编辑器偏好的映射（S8：auto_save 设置此前完全没被消费）。
 * 缺省/异常一律按"开启"处理，保持旧行为。
 */
describe('toEditorPreferences', () => {
  it('auto_save=false 时关闭自动保存', () => {
    expect(toEditorPreferences({ auto_save: false })).toEqual({ autoSave: false });
  });

  it('auto_save=true 时开启', () => {
    expect(toEditorPreferences({ auto_save: true })).toEqual({ autoSave: true });
  });

  it('字段缺失或整体为空时按开启处理', () => {
    expect(toEditorPreferences({})).toEqual({ autoSave: true });
    expect(toEditorPreferences(null)).toEqual({ autoSave: true });
  });

  it('只有明确 false 才关闭；其他非布尔值不误判', () => {
    expect(toEditorPreferences({ auto_save: 'yes' })).toEqual({ autoSave: true });
    expect(toEditorPreferences({ auto_save: 0 })).toEqual({ autoSave: true });
    expect(toEditorPreferences({ auto_save: false })).toEqual({ autoSave: false });
  });
});
