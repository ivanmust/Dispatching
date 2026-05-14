import { cn } from '@/lib/utils';
import { STATUS_COLORS, incidentStatusDisplayLabel, type IncidentStatus } from '@/types/incident';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function StatusPill({ status, className }: { status: IncidentStatus; className?: string }) {
  const color = STATUS_COLORS[status] ?? '#6b7280';
  const bg = withAlpha(color, 0.15);
  const ring = withAlpha(color, 0.25);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        className
      )}
      style={{
        color,
        backgroundColor: bg,
        boxShadow: `inset 0 0 0 1px ${ring}`,
      }}
    >
      <span className="mr-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
      {incidentStatusDisplayLabel(status)}
    </span>
  );
}
