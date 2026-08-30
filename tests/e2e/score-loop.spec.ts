import { expect, test } from "@playwright/test";

const enabled = process.env.RUN_E2E === "true";
test.skip(!enabled, "Set RUN_E2E=true with the documented local Supabase variables.");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when RUN_E2E=true.`);
  return value;
}

test("authenticated user receives scored jobs from the fake monitor and development source", async ({
  context,
  page
}) => {
  const session = await context.request.post("/api/internal/test/session", {
    headers: { "x-e2e-auth-token": required("E2E_AUTH_TOKEN") },
    data: {
      email: required("E2E_AUTH_EMAIL"),
      password: required("E2E_USER_PASSWORD")
    }
  });
  expect(session.status()).toBe(200);

  await page.goto("/app/campaigns");
  await page.getByRole("link", { name: "New campaign" }).click();
  const campaignName = `AI Automation Projects ${Date.now()}`;
  await page.getByLabel("Campaign name").fill(campaignName);
  await page.getByLabel("Required skills").fill("Make.com, OpenAI");
  await page.getByLabel("Include keywords").fill("automation, webhook");
  await page.getByLabel("Expert").check();
  await page.getByLabel("Fixed-price").check();
  await page.getByLabel("Minimum").nth(1).fill("1000");
  await page.getByLabel("Maximum").nth(1).fill("2500");
  await page.getByLabel("Payment verification").selectOption("only_verified");
  await page.getByLabel("Client hiring history").selectOption("10_plus");
  await page.getByRole("button", { name: "Create active campaign" }).click();

  await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();
  const campaignUrl = page.url();

  await page.getByRole("link", { name: "Knowledge" }).click();
  await page.getByLabel("Title").fill("Automation delivery case study");
  await page.getByLabel("Content").fill("Delivered Make.com and OpenAI workflow automation with tested webhooks, clear handoff documentation, and measurable time savings.");
  await page.getByRole("button", { name: "Save to private knowledge" }).click();
  await expect(page.getByText("Automation delivery case study")).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.goto(campaignUrl);

  await page.getByRole("button", { name: "Enable monitor" }).click();
  await expect(page.getByRole("button", { name: "Pause monitor" })).toBeVisible();
  await expect(page.getByText("fake", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Build a Make.com and OpenAI automation workflow"
    })
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Preference score").first()).toBeVisible();
  await expect(page.getByText("AI suitability").first()).toBeVisible();

  await page.getByRole("link", { name: "Test job" }).click();
  await page.getByLabel("Development token").fill(required("DEV_INGEST_TOKEN"));
  await page.getByLabel("Source job ID").fill(`e2e-make-openai-${Date.now()}`);
  await page.getByRole("button", { name: "Inject test job" }).click();
  await expect(page.getByText(/Job accepted|Existing job reused/)).toBeVisible();

  await page.goto(campaignUrl);
  await expect(
    page.getByRole("heading", { name: "Need Make.com + OpenAI automation expert" })
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Strong technology match")).toBeVisible();
  await expect(page.getByText(/qualified|proposal queued|ready for review/).first()).toBeVisible();

  await page.goto("/app/proposals");
  await expect(page.getByRole("heading", { name: "Proposal queue" })).toBeVisible();
  await expect(page.getByText("Automation delivery case study")).toBeVisible({ timeout: 45_000 });

  await page.getByRole("button", { name: "Pause monitor" }).click();
  await expect(page.getByRole("button", { name: "Resume monitor" })).toBeVisible();

  await page.goto(campaignUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete campaign" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns$/);
  await expect(page.getByRole("heading", { name: campaignName })).not.toBeVisible();
});
