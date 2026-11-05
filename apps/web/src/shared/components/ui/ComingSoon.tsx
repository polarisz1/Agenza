import { ClockCountdown } from '@phosphor-icons/react';

import Card from './Card';
import Pill from './Pill';
import './ui.css';

interface ComingSoonProps {
  title: string;
  description: string;
  notes?: string[];
}

/** 后端能力尚未上线时的统一占位页 */
export default function ComingSoon({ title, description, notes = [] }: ComingSoonProps) {
  return (
    <Card className="af-coming-soon">
      <div className="af-coming-soon__icon">
        <ClockCountdown size={24} />
      </div>
      <Pill tone="warning">即将上线</Pill>
      <h1 className="af-coming-soon__title">{title}</h1>
      <p className="af-coming-soon__desc">{description}</p>
      {notes.length > 0 && (
        <div className="af-coming-soon__notes">
          {notes.map((note) => (
            <Pill key={note} tone="neutral">
              {note}
            </Pill>
          ))}
        </div>
      )}
    </Card>
  );
}
