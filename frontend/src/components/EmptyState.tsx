/**
 * Shared EmptyState component.
 * Displays a centered empty state with icon, title, message, and optional action.
 */
import type { LucideIcon } from 'lucide-react';
import { FileText } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <div className="bauhaus-card text-center py-16">
      <div className="w-16 h-16 bg-bauhaus-lightgray rounded-full mx-auto mb-4 flex items-center justify-center">
        <Icon size={32} className="text-bauhaus-gray" />
      </div>
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-bauhaus-gray mb-6">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
