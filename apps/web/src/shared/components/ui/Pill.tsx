import type { ReactNode } from 'react';

import './ui.css';

export type PillTone = 'brand' | 'success' | 'warning' | 'danger' | 'violet' | 'neutral';

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  icon?: ReactNode;
  className?: string;
  title?: string;
}

/** 状态 / 标签胶囊，对应原型里的 .pill */
export default function Pill({
  children,
  tone = 'neutral',
  icon,
  className = '',
  title,
}: PillProps) {
  return (
    <span className={`af-pill af-pill--${tone}${className ? ` ${className}` : ''}`} title={title}>
      {icon}
      {children}
    </span>
  );
}
