/**
 * 行级 diff（运行对比用）。
 *
 * 不引第三方依赖：输出通常是几十行 JSON，用 LCS 足够。超过阈值时退化为
 * "整段替换"（性能保护），并由调用方提示"内容过长"。
 */

export interface DiffLine {
  type: 'same' | 'rem' | 'add';
  text: string;
}

const MAX_CELLS = 200_000;

function toLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n');
}

/** 基于最长公共子序列的行级 diff。 */
export function diffLines(a: string, b: string): DiffLine[] {
  const left = toLines(a);
  const right = toLines(b);

  if (a === b) return left.map((text) => ({ type: 'same', text }));

  if (left.length * right.length > MAX_CELLS) {
    return [
      ...left.map((text) => ({ type: 'rem' as const, text })),
      ...right.map((text) => ({ type: 'add' as const, text })),
    ];
  }

  const rows = left.length;
  const cols = right.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      out.push({ type: 'same', text: left[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'rem', text: left[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: right[j] });
      j += 1;
    }
  }
  while (i < rows) out.push({ type: 'rem', text: left[i++] });
  while (j < cols) out.push({ type: 'add', text: right[j++] });

  return out;
}
