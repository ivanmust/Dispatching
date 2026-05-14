import { cn } from '@/lib/utils';
import type { Incident } from '@/types/incident';
import {
  STATUS_COLORS,
  incidentCategoryDisplayLabel,
  incidentPriorityDisplayLabel,
  incidentStatusDisplayLabel,
} from '@/types/incident';

interface IncidentCardProps {
  incident: Incident;
  isSelected: boolean;
  onClick: () => void;
}

export function IncidentCard({ incident, isSelected, onClick }: IncidentCardProps) {
  const statusLabel = incidentStatusDisplayLabel(incident.status);
  const statusAccent = STATUS_COLORS[incident.status] ?? '#6b7280';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-2.5 py-2 transition-all hover:bg-muted/40',
        isSelected
          ? 'bg-primary/10'
          : ''
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: statusAccent, boxShadow: `0 0 6px ${statusAccent}` }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] leading-4.5">
            <div><span className="font-semibold">Task:</span> <span>{incident.title || '-'}</span></div>
            <div><span className="font-semibold">Type:</span> <span>{incidentCategoryDisplayLabel(incident.category || '-')}</span></div>
            <div><span className="font-semibold">Priority:</span> <span>{incidentPriorityDisplayLabel(incident.priority || 'None')}</span></div>
            <div>
              <span className="font-semibold">Status:</span>{' '}
              <span className="font-semibold" style={{ color: statusAccent }}>{statusLabel}</span>
            </div>
            <div className="text-[11px] text-foreground/80 mt-0.5">{new Date(incident.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </button>
  );
}
