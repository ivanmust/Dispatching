import type { Incident } from "../types";

/** Canonical map key so crime vs incidents UUID text casing does not split one row into two. */
export function incidentDedupeKey(id: unknown): string {
  return String(id ?? "").trim().toLowerCase();
}

/** Same logical incident can appear twice after merges or unusual DB paths; keep newest `updatedAt`. */
export function dedupeIncidentsByIdPreferNewest(items: Incident[]): Incident[] {
  const byId = new Map<string, Incident>();
  for (const inc of items) {
    const key = incidentDedupeKey(inc.id);
    if (!key) continue;
    const prev = byId.get(key);
    if (
      !prev ||
      new Date(inc.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
    ) {
      byId.set(key, inc);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
