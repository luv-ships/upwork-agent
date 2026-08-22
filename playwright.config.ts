import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/e2e/global-setup.ts",
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  ...(process.env.RUN_E2E === "true"
    ? {
        webServer: {
          command: "corepack pnpm dev",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000/sign-in"
        }
      }
    : {})
});
