import { test, expect } from "@playwright/test";
import { seedIncidentLifecycle } from "./helpers/seed-incident-lifecycle";

test.describe("Admin portal incidents UI", () => {
  test("incidents table lists seeded lifecycle incident as RESOLVED", async ({ page, request }) => {
    const { title } = await seedIncidentLifecycle(request, "http://localhost:3001");

    await page.goto("/login");
    await page.getByLabel(/username/i).fill("admin");
    await page.getByLabel(/^password$/i).fill("Admin@12345");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /Incident Governance/i })).toBeVisible({ timeout: 30000 });

    await page.getByPlaceholder(/search title/i).fill(title);

    const row = page.locator("table.table tbody tr").first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toContainText("RESOLVED");
    await expect(row).toContainText(title);
  });
});
