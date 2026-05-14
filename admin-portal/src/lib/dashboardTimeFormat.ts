/** Human-readable times for the executive dashboard (table, KPIs, exports). */

/** Format an ISO timestamp for display (locale-aware date + short time). */
export function formatDashboardDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
}

/**
 * Format a span from a value in minutes (may be fractional).
 * Examples: "45 sec", "12 min", "1 hr 5 min", "2 hr 30 sec".
 */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";

  const totalSeconds = Math.round(Math.abs(minutes) * 60);
  if (totalSeconds === 0) return "0 sec";

  let sec = totalSeconds;
  const hours = Math.floor(sec / 3600);
  sec %= 3600;
  const mins = Math.floor(sec / 60);
  const seconds = sec % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} hr`);
    if (mins > 0) parts.push(`${mins} min`);
    else if (seconds > 0) parts.push(`${seconds} sec`);
  } else if (mins > 0) {
    parts.push(`${mins} min`);
    if (seconds > 0) parts.push(`${seconds} sec`);
  } else {
    parts.push(`${seconds} sec`);
  }
  return parts.join(" ");
}

/** Same as {@link formatDurationMinutes} but input is decimal hours (e.g. KPI averages). */
export function formatDurationHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  return formatDurationMinutes(hours * 60);
}
