/**
 * Shared DetailRow component.
 * Displays a label-value pair in a consistent format.
 */
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  /** Optional icon to show before the label */
  icon?: LucideIcon;
  /** Align value to right (default) or left */
  align?: 'left' | 'right';
  /** Show border bottom (default true) */
  border?: boolean;
}

export function DetailRow({
  label,
  value,
  icon: Icon,
  align = 'right',
  border = true,
}: DetailRowProps) {
  return (
    <div
      className={cn(
        'flex justify-between items-start gap-4 py-2',
        border && 'border-b border-bauhaus-lightgray'
      )}
    >
      <span className="text-sm text-bauhaus-gray flex items-center gap-2">
        {Icon && <Icon size={14} className="flex-shrink-0" />}
        {label}
      </span>
      <span className={cn('font-medium', align === 'right' && 'text-right')}>
        {value}
      </span>
    </div>
  );
}
