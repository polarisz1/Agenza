/**
 * 属性面板草稿的"立即提交"桥。
 *
 * 属性面板为了输入流畅用了 300ms 防抖，草稿停留在组件本地；但校验/运行/调试/返回列表
 * 读的是**已落库的图**，如果防抖窗口里点了按钮，就会拿旧参数去跑（F2）。
 *
 * 这里用一个极小的注册表让画布侧能在关键时刻把草稿立刻提交，避免把 draft 状态
 * 提升到 store 或层层透传 props。
 */
type Flusher = () => void;

let current: Flusher | null = null;

export function registerDraftFlusher(flusher: Flusher | null): void {
  current = flusher;
}

/** 立即把当前属性面板草稿写进 store；没有选中节点时是空操作。 */
export function flushDraft(): void {
  current?.();
}
