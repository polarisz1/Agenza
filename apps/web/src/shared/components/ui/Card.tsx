import type { HTMLAttributes, ReactNode } from 'react';

import './ui.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** 是否使用默认 20px 内边距 */
  padded?: boolean;
}

/** 与原型一致的暗色卡片容器 */
export default function Card({ children, padded = false, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`af-card${padded ? ' af-card--padded' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </div>
  );
}
