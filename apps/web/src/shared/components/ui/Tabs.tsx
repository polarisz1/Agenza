import './ui.css';

export interface TabItem {
  key: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
}

/** 原型风格的下划线 Tabs */
export default function Tabs({ items, value, onChange }: TabsProps) {
  return (
    <div className="af-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          className={`af-tab${value === item.key ? ' af-tab--active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
