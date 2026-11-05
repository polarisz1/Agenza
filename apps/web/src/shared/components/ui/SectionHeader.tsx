import type { ReactNode } from 'react';

import './ui.css';

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}

/** 卡片内的区块标题 */
export default function SectionHeader({ title, description, extra }: SectionHeaderProps) {
  return (
    <div className="af-section-header">
      <div>
        <div className="af-section-header__title">{title}</div>
        {description && <div className="af-section-header__desc">{description}</div>}
      </div>
      {extra && <div className="af-section-header__extra">{extra}</div>}
    </div>
  );
}
