/**
 * Shared FilterTabs component.
 * Flexible filter tabs with count badges and optional color dots.
 */
import { cn } from '@/lib/utils';

export interface FilterTabItem<T extends string> {
  key: T;
  label: React.ReactNode;
  count: number;
  /** Optional color class for a status dot (e.g., "bg-bauhaus-yellow") */
  color?: string;
  /** Highlight style (teal accent) */
  highlight?: boolean;
}

interface FilterTabsProps<T extends string> {
  items: FilterTabItem<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function FilterTabs<T extends string>({
  items,
  active,
  onChange,
}: FilterTabsProps<T>) {
  return (
    <div className="flex gap-2 flex-wrap">
      {items.map((item) => (
        <FilterTab
          key={item.key}
          active={active === item.key}
          onClick={() => onChange(item.key)}
          count={item.count}
          color={item.color}
          highlight={item.highlight}
        >
          {item.label}
        </FilterTab>
      ))}
    </div>
  );
}

interface FilterTabProps {
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function FilterTab({
  active,
  onClick,
  count,
  color,
  highlight,
  children,
}: FilterTabProps) {
  const baseClasses = 'px-4 py-2 font-medium transition-colors flex items-center gap-2';

  const activeClasses = highlight
    ? 'bg-teal-600 text-white'
    : 'bg-bauhaus-black text-white';

  const inactiveClasses = highlight
    ? 'bg-teal-50 border-2 border-teal-600 text-teal-700 hover:bg-teal-100'
    : 'bg-white border-2 border-bauhaus-black hover:bg-bauhaus-lightgray';

  const badgeClasses = active
    ? 'bg-white text-bauhaus-black'
    : highlight
    ? 'bg-teal-200 text-teal-800'
    : 'bg-bauhaus-lightgray';

  return (
    <button
      onClick={onClick}
      className={cn(baseClasses, active ? activeClasses : inactiveClasses)}
    >
      {color && <span className={cn('w-2 h-2 rounded-full', color)} />}
      {children}
      <span className={cn('text-xs px-1.5 py-0.5 rounded-full', badgeClasses)}>
        {count}
      </span>
    </button>
  );
}
