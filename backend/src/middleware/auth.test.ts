import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { getUserIdFromAuth } from "./auth";

describe("getUserIdFromAuth", () => {
  const makeReq = (authorization?: string): Partial<Request> => ({
    headers: { authorization },
  });

  it("returns null when no Authorization header", () => {
    expect(getUserIdFromAuth(makeReq() as Request)).toBeNull();
  });

  it("returns null for invalid Bearer token", () => {
    expect(getUserIdFromAuth(makeReq("Basic xyz") as Request)).toBeNull();
    expect(getUserIdFromAuth(makeReq("Bearer") as Request)).toBeNull();
  });

  it("returns null when token does not start with demo-", () => {
    expect(getUserIdFromAuth(makeReq("Bearer jwt-abc") as Request)).toBeNull();
  });

  it("returns user id when token is demo-{userId}", () => {
    expect(getUserIdFromAuth(makeReq("Bearer demo-123") as Request)).toBe("123");
    expect(getUserIdFromAuth(makeReq("Bearer demo-uuid-here") as Request)).toBe("uuid-here");
  });
});
