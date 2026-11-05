import type { ReactNode } from 'react';

import './ui.css';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Dashboard / 运行详情使用的 KPI 卡 */
export default function StatCard({ label, value, hint, icon, className = '' }: StatCardProps) {
  return (
    <div className={`af-stat-card${className ? ` ${className}` : ''}`}>
      <div className="af-stat-card__head">
        <span>{label}</span>
        {icon}
      </div>
      <div className="af-stat-card__value">{value}</div>
      {hint && <div className="af-stat-card__hint">{hint}</div>}
    </div>
  );
}
