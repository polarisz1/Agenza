/**
 * TRIGGER-02 Phase B：从 `父节点/子节点/孙节点` 路径推导运行详情层级。
 *
 * 子工作流节点在 NodeRun 里的 node_id 使用 `/` 连接完整调用路径，
 * 这里只做纯字符串解析，供时间线缩进、分组折叠与编辑器定位复用。
 */

export function splitNodePath(nodeId: string): string[] {
  return nodeId.split('/').filter(Boolean);
}

/** 顶层节点为 0，子工作流内部节点依次 +1 */
export function nodeDepth(nodeId: string): number {
  return Math.max(0, splitNodePath(nodeId).length - 1);
}

/** `p_sub/c_in` → `p_sub`；顶层节点原样返回 */
export function topLevelNodeId(nodeId: string): string {
  return splitNodePath(nodeId)[0] ?? nodeId;
}

export function isNestedNodeId(nodeId: string): boolean {
  return splitNodePath(nodeId).length > 1;
}

/** 该节点是否直接或间接包含子节点 */
export function hasNestedChildren(nodeId: string, allNodeIds: readonly string[]): boolean {
  const prefix = `${nodeId}/`;
  return allNodeIds.some((candidate) => candidate.startsWith(prefix));
}

/** 任一祖先分组被折叠时，该节点应从列表中隐藏 */
export function isHiddenByCollapsedGroup(
  nodeId: string,
  collapsed: Readonly<Record<string, boolean>>,
): boolean {
  const parts = splitNodePath(nodeId);
  for (let depth = 1; depth < parts.length; depth += 1) {
    const ancestor = parts.slice(0, depth).join('/');
    if (collapsed[ancestor]) return true;
  }
  return false;
}
