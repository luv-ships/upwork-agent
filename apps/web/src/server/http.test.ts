import { describe, expect, it } from "vitest";

import { apiError, bearerToken, constantTimeEqual } from "./http";

describe("development endpoint HTTP helpers", () => {
  it("extracts only a non-empty Bearer token", () => {
    expect(bearerToken(new Request("http://local.test", { headers: { authorization: "Bearer private-token" } }))).toBe("private-token");
    expect(bearerToken(new Request("http://local.test", { headers: { authorization: "Basic value" } }))).toBeNull();
    expect(bearerToken(new Request("http://local.test", { headers: { authorization: "Bearer   " } }))).toBeNull();
  });

  it("compares equal-length secrets without accepting prefixes", () => {
    expect(constantTimeEqual("0123456789abcdef", "0123456789abcdef")).toBe(true);
    expect(constantTimeEqual("0123456789abcdeg", "0123456789abcdef")).toBe(false);
    expect(constantTimeEqual("0123", "0123456789abcdef")).toBe(false);
    expect(constantTimeEqual(null, "0123456789abcdef")).toBe(false);
  });

  it("returns a bounded JSON error contract", async () => {
    const response = apiError(401, "authentication_required");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "authentication_required" });
  });
});
