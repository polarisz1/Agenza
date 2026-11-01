import { useEffect, useState } from 'react';

/**
 * 把频繁变化的值延迟到停止变化后再输出（评审 G25：搜索框每敲一个字符就发请求）。
 *
 * 用法：`const debounced = useDebouncedValue(q, 300)`，再用 debounced 作为请求依赖。
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
