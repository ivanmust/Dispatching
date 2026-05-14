import { describe, expect, it } from "vitest";
import { buildNavigationChipState, formatNavigationChipLabel } from "@/lib/navigationChip";

describe("navigation chip helpers", () => {
  it("builds a ready chip with rounded ETA", () => {
    const chip = buildNavigationChipState({
      etaMinutes: 12.6,
      hasDrawableRoute: true,
      unavailable: false,
      loading: false,
    });
    expect(chip).toEqual({
      pts: 13,
      draw: "ready",
      unavailable: false,
      loading: false,
    });
  });

  it("builds an error chip when route is unavailable", () => {
    const chip = buildNavigationChipState({
      etaMinutes: 5.2,
      hasDrawableRoute: false,
      unavailable: true,
      loading: false,
    });
    expect(chip.draw).toBe("error");
    expect(chip.unavailable).toBe(true);
  });

  it("formats chip labels consistently", () => {
    const label = formatNavigationChipLabel({
      pts: 7,
      draw: "empty",
      unavailable: false,
      loading: true,
    });
    expect(label).toBe("pts:7 · draw:empty · unavailable:0 · loading:1");
  });
});
