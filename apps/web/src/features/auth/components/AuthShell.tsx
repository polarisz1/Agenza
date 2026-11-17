import { FlowArrow } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Card } from '@/shared/components/ui';
import './Auth.css';

interface AuthShellProps {
  title: string;
  subtitle: string;
  wide?: boolean;
  children: ReactNode;
}

/** 登录 / 注册共用外壳：品牌、标题与暗色卡片 */
export default function AuthShell({ title, subtitle, wide = false, children }: AuthShellProps) {
  return (
    <div className="af-auth">
      <div className="af-auth__brand">
        <span className="af-auth__logo">
          <FlowArrow size={18} weight="bold" />
        </span>
        <span>Agenza</span>
      </div>
      <Card className={`af-auth__card${wide ? ' af-auth__card--wide' : ''}`} padded>
        <div className="af-auth__head">
          <h1 className="af-auth__title">{title}</h1>
          <div className="af-auth__subtitle">{subtitle}</div>
        </div>
        {children}
      </Card>
      <div className="af-auth__footer">多租户 AI 工作流编排平台</div>
    </div>
  );
}
