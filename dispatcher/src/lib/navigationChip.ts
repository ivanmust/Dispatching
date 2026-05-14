export type NavigationChipDrawState = "ready" | "empty" | "error";

export type NavigationChipState = {
  pts: number;
  draw: NavigationChipDrawState;
  unavailable: boolean;
  loading: boolean;
};

export function buildNavigationChipState(args: {
  etaMinutes: number | null | undefined;
  hasDrawableRoute: boolean;
  unavailable: boolean;
  loading: boolean;
}): NavigationChipState {
  const eta = Number(args.etaMinutes);
  const pts = Number.isFinite(eta) ? Math.max(0, Math.round(eta)) : 0;
  const draw: NavigationChipDrawState =
    args.hasDrawableRoute ? "ready" : args.unavailable ? "error" : "empty";
  return {
    pts,
    draw,
    unavailable: !!args.unavailable,
    loading: !!args.loading,
  };
}

export function formatNavigationChipLabel(chip: NavigationChipState): string {
  return `pts:${chip.pts} · draw:${chip.draw} · unavailable:${chip.unavailable ? "1" : "0"} · loading:${chip.loading ? "1" : "0"}`;
}
