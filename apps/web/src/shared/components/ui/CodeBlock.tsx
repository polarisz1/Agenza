import type { CSSProperties } from 'react';

import './ui.css';

interface CodeBlockProps {
  code: string;
  maxHeight?: number | string;
  className?: string;
  style?: CSSProperties;
}

/** 暗色等宽代码块，用于 JSON 快照、Prompt 预览等 */
export default function CodeBlock({ code, maxHeight, className = '', style }: CodeBlockProps) {
  return (
    <pre
      className={`af-code-block${className ? ` ${className}` : ''}`}
      style={{ maxHeight, ...style }}
    >
      <code>{code}</code>
    </pre>
  );
}
