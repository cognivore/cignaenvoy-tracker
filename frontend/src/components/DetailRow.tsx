/**
 * Shared DetailRow component.
 * Displays a label-value pair in a consistent format.
 */
import { cn } from '@/lib/utils';

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  /** Align value to right (default) or left */
  align?: 'left' | 'right';
  /** Show border bottom (default true) */
  border?: boolean;
}

export function DetailRow({
  label,
  value,
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
      <span className="text-sm text-bauhaus-gray">{label}</span>
      <span className={cn('font-medium', align === 'right' && 'text-right')}>
        {value}
      </span>
    </div>
  );
}
