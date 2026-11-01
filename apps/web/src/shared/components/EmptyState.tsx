import { Empty } from 'antd';
import type { ReactNode } from 'react';

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
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        imageStyle={{ height: 44 }}
        description={
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1b1c1a' }}>{title}</div>
            {description && (
              <div style={{ marginTop: 4, fontSize: 12.5, color: '#6b706a' }}>{description}</div>
            )}
          </div>
        }
      >
        {action && <div style={{ marginTop: 12 }}>{action}</div>}
        {secondary && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: '#8b9088' }}>{secondary}</div>
        )}
      </Empty>
    </div>
  );
}
