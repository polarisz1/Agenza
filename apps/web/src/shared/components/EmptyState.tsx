import { Tray } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import './ui/ui.css';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  secondary?: ReactNode;
}

/**
 * 统一空态（F2/B8）：图标 + 标题 + 说明 + 一个主行动。
 * 不用大插画，保持工作台的克制感。
 */
export default function EmptyState({ title, description, action, secondary }: Props) {
  return (
    <div className="af-empty">
      <div className="af-empty__icon">
        <Tray size={22} />
      </div>
      <div className="af-empty__title">{title}</div>
      {description && <div className="af-empty__desc">{description}</div>}
      {action && <div className="af-empty__actions">{action}</div>}
      {secondary && <div className="af-empty__desc">{secondary}</div>}
    </div>
  );
}
