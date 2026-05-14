import { cn } from '@/lib/utils';
import type { IncidentPriority } from '@/types/incident';

const priorityConfig: Record<IncidentPriority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'border-gray-300 text-gray-600' },
  MEDIUM: { label: 'Medium', className: 'border-blue-400 text-blue-600' },
  HIGH: { label: 'High', className: 'border-orange-400 text-orange-600' },
  CRITICAL: { label: 'Critical', className: 'border-red-400 text-red-600 bg-red-50' },
};

export function PriorityBadge({ priority, className }: { priority: IncidentPriority; className?: string }) {
  const config = priorityConfig[priority];
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', config.className, className)}>
      {config.label}
    </span>
  );
}
