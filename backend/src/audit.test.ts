import { describe, it, expect, vi, beforeEach } from "vitest";
import { logAudit } from "./audit";
import * as db from "./db";

vi.mock("./db", () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts audit log with required fields", async () => {
    await logAudit({
      action: "incident:created",
      userId: "u-1",
      userName: "Test User",
      entityType: "incident",
      entityId: "inc-1",
      details: { title: "Test Incident" },
    });

    const call = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("INSERT INTO audit_logs");
    expect(call[1][0]).toBe("incident:created");
    expect(call[1][1]).toBe("u-1");
    expect(call[1][2]).toBe("Test User");
    expect(call[1][3]).toBe("incident");
    expect(call[1][4]).toBe("inc-1");
  });

  it("allows null user and details", async () => {
    await logAudit({
      action: "incident:assigned",
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      ["incident:assigned", null, null, null, null, null]
    );
  });
});
