import { afterEach, describe, expect, it, vi } from "vitest";

import { applicationUrl } from "./app-url";

function validEnvironment(): void {
  vi.stubEnv("APP_URL", "https://bidwork.app");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "publishable-test-key");
  vi.stubEnv("NODE_ENV", "production");
}

afterEach(() => vi.unstubAllEnvs());

describe("applicationUrl", () => {
  it("always builds internal redirects from the configured public origin", () => {
    validEnvironment();
    expect(applicationUrl("/sign-in?next=%2Fapp%2Fcampaigns").toString()).toBe(
      "https://bidwork.app/sign-in?next=%2Fapp%2Fcampaigns"
    );
  });

  it("rejects protocol-relative and external redirect targets", () => {
    validEnvironment();
    expect(() => applicationUrl("//attacker.example/sign-in")).toThrow("internal absolute path");
    expect(() => applicationUrl("https://attacker.example/sign-in")).toThrow(
      "internal absolute path"
    );
  });
});
