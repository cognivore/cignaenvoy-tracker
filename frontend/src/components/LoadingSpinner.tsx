/**
 * Shared LoadingSpinner component.
 * Displays a centered loading spinner.
 */
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Center in container with height */
  centered?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-4',
};

export function LoadingSpinner({ size = 'lg', centered = true }: LoadingSpinnerProps) {
  const spinner = (
    <div
      className={cn(
        'border-bauhaus-blue border-t-transparent rounded-full animate-spin',
        sizeClasses[size]
      )}
    />
  );

  if (centered) {
    return (
      <div className="flex items-center justify-center h-64">
        {spinner}
      </div>
    );
  }

  return spinner;
}
