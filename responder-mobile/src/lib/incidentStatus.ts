export function toUiStatus(status: string): string {
  const s = String(status).toUpperCase();
  if (s === "NEW") return "New";
  if (s === "ASSIGNED") return "Assigned";
  if (s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE") return "In progress";
  if (s === "RESOLVED") return "Completed";
  if (s === "CLOSED") return "Closed";
  return String(status);
}

export function canAcceptIncident(status: string): boolean {
  return String(status).toUpperCase() === "ASSIGNED";
}

export function canRejectIncident(status: string): boolean {
  return String(status).toUpperCase() === "ASSIGNED";
}

export function canCompleteIncident(status: string): boolean {
  const s = String(status).toUpperCase();
  return s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE";
}
