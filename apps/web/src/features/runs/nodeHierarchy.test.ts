import { describe, expect, it } from 'vitest';

import {
  hasNestedChildren,
  isHiddenByCollapsedGroup,
  isNestedNodeId,
  nodeDepth,
  topLevelNodeId,
} from './nodeHierarchy';

describe('nodeHierarchy（子工作流嵌套节点）', () => {
  it('解析顶层与多级嵌套路径', () => {
    expect(nodeDepth('p_sub')).toBe(0);
    expect(nodeDepth('p_sub/c_in')).toBe(1);
    expect(nodeDepth('p_sub/c_sub/c_in')).toBe(2);
    expect(topLevelNodeId('p_sub/c_sub/c_in')).toBe('p_sub');
    expect(isNestedNodeId('p_sub')).toBe(false);
    expect(isNestedNodeId('p_sub/c_in')).toBe(true);
  });

  it('识别子节点并支持祖先分组折叠', () => {
    const ids = ['p_sub', 'p_sub/c_in', 'p_sub/c_sub/c_in', 'other'];

    expect(hasNestedChildren('p_sub', ids)).toBe(true);
    expect(hasNestedChildren('p_sub/c_in', ids)).toBe(false);

    expect(isHiddenByCollapsedGroup('p_sub/c_sub/c_in', { p_sub: true })).toBe(true);
    expect(isHiddenByCollapsedGroup('p_sub/c_sub/c_in', { 'p_sub/c_sub': true })).toBe(true);
    expect(isHiddenByCollapsedGroup('p_sub/c_in', { 'p_sub/c_sub': true })).toBe(false);
    expect(isHiddenByCollapsedGroup('p_sub', { p_sub: true })).toBe(false);
  });
});
