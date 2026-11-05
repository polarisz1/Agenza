import type { ButtonHTMLAttributes, ReactNode } from 'react';

import './ui.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  active?: boolean;
}

/** 32×32 图标按钮，label 同时作为 aria-label 与 title */
export default function IconButton({
  label,
  icon,
  active = false,
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`af-icon-btn${active ? ' af-icon-btn--active' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
