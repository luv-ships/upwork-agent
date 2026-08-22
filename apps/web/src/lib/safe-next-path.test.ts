import { describe, expect, it } from "vitest";

import { safeAppNextPath } from "./safe-next-path";

describe("safeAppNextPath", () => {
  it("keeps same-origin application paths and query strings", () => {
    expect(safeAppNextPath("/app/campaigns/123?view=score")).toBe(
      "/app/campaigns/123?view=score"
    );
    expect(safeAppNextPath("/app")).toBe("/app");
  });

  it.each([
    undefined,
    null,
    "",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/app",
    "/application",
    "/auth/sign-out",
    "/app/campaigns\nSet-Cookie: unsafe=true"
  ])("falls back for an unsafe destination: %s", (candidate) => {
    expect(safeAppNextPath(candidate)).toBe("/app/campaigns");
  });
});
