import type { ReactNode } from 'react';

import './ui/ui.css';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 右侧操作区（按钮 / 筛选器等） */
  extra?: ReactNode;
}

/**
 * 页面级标题栏。四个业务页统一用它，保证标题字号、间距、操作区位置一致。
 * 只做展示，不承载任何业务逻辑。
 */
export default function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div className="af-page-header">
      <div>
        <h1 className="af-page-header__title">{title}</h1>
        {description && <div className="af-page-header__desc">{description}</div>}
      </div>
      {extra && <div className="af-page-header__extra">{extra}</div>}
    </div>
  );
}
