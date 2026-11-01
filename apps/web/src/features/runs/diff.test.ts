import { describe, expect, it } from 'vitest';

import { diffLines } from './diff';

describe('diffLines', () => {
  it('相同内容全部是 same', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines.map((line) => line.type)).toEqual(['same', 'same']);
  });

  it('修改一行产生 -/+', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(lines).toEqual([
      { type: 'same', text: 'a' },
      { type: 'rem', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('一侧多出内容标记为 add', () => {
    const lines = diffLines('{"a":1}', '{"a":1}\n{"b":2}');
    expect(lines.filter((line) => line.type === 'add')).toHaveLength(1);
  });

  it('CRLF 与 LF 视为相同', () => {
    const lines = diffLines('a\r\nb', 'a\nb');
    expect(lines.every((line) => line.type === 'same')).toBe(true);
  });
});
