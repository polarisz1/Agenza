import './ui.css';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  shape?: 'circle' | 'square';
  title?: string;
}

const GRADIENTS = [
  'linear-gradient(135deg, #34D399, #14B8A6)',
  'linear-gradient(135deg, #60A5FA, #6366F1)',
  'linear-gradient(135deg, #C084FC, #EC4899)',
  'linear-gradient(135deg, #FBBF24, #F97316)',
  'linear-gradient(135deg, #22D3EE, #3B82F6)',
  'linear-gradient(135deg, #FB7185, #F43F5E)',
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(0, 2);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** 首字母渐变头像，颜色由名字哈希稳定决定 */
export default function Avatar({ name, size = 'md', shape = 'circle', title }: AvatarProps) {
  const gradient = GRADIENTS[hashName(name) % GRADIENTS.length];
  return (
    <span
      className={`af-avatar af-avatar--${size}${shape === 'square' ? ' af-avatar--square' : ''}`}
      style={{ background: gradient }}
      title={title ?? name}
      aria-hidden={title === undefined}
    >
      {initials(name)}
    </span>
  );
}
