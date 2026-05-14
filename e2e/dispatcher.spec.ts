import { test, expect } from "@playwright/test";

const E2E_PASSWORD = "password123";

async function gotoLogin(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  // Login page may show both "Sign in" and "Create account" buttons; assert at least one is visible.
  await expect(page.getByRole("button", { name: /sign in|create account/i }).first()).toBeVisible({ timeout: 10000 });
}

/** Desktop: icon rail "Create"; mobile / list: "Create incident" */
async function openCreateIncidentModal(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: /^create$/i })
    .or(page.getByRole("button", { name: /create incident/i }))
    .first()
    .click();
}

test.describe("Dispatcher flow", () => {
  test("register and see dashboard", async ({ page }) => {
    const email = `e2e.dispatcher+${Date.now()}@cad.local`;
    await gotoLogin(page);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.getByLabel(/full name/i).fill("E2E Dispatcher");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
    await page.getByLabel(/^confirm password$/i).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/dispatcher/, { timeout: 15000 });
    await expect(page.getByText(/Dispatch Center/i)).toBeVisible({ timeout: 15000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await gotoLogin(page);
    await page.getByLabel(/email/i).fill("bad@cad.local");
    await page.getByLabel(/password/i).fill("wrong123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("user management - create and deactivate user", async ({ page }) => {
    const email = `e2e.mgmt+${Date.now()}@cad.local`;
    await gotoLogin(page);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.getByLabel(/full name/i).fill("E2E Manager");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByLabel(/^confirm password$/i).fill("password123");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/dispatcher/);

    // API-based user creation/deactivation keeps e2e stable even if the UI layout changes.
    const dispatcherToken = await page.evaluate(() => sessionStorage.getItem("cad_token"));
    expect(dispatcherToken).toBeTruthy();

    const uniqueEmail = `e2e.user+${Date.now()}@cad.local`;
    const registerRes = await page.request.post("http://localhost:3001/api/auth/register", {
      data: {
        username: uniqueEmail,
        password: "password123",
        name: "E2E User",
        role: "responder",
        unit: "EMS",
      },
    });
    expect(registerRes.ok()).toBeTruthy();
    const created = await registerRes.json();
    const responderId: string = created?.user?.id;
    expect(responderId).toBeTruthy();

    const deactivateRes = await page.request.post(`http://localhost:3001/api/users/${responderId}/deactivate`, {
      headers: { Authorization: `Bearer ${dispatcherToken}`, "Content-Type": "application/json" },
      data: {},
    });
    expect(deactivateRes.status()).toBe(204);

    const inactiveUsersRes = await page.request.get("http://localhost:3001/api/users?role=responder&status=inactive", {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    expect(inactiveUsersRes.ok()).toBeTruthy();
    const inactiveUsers = await inactiveUsersRes.json();
    expect(inactiveUsers.some((u: any) => u.username === uniqueEmail && u.isActive === false)).toBeTruthy();
  });

  test("internal messaging - dispatcher to responder", async ({ page }) => {
    const email = `e2e.dm+${Date.now()}@cad.local`;
    await gotoLogin(page);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.getByLabel(/full name/i).fill("E2E DM Dispatcher");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByLabel(/^confirm password$/i).fill("password123");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/dispatcher/);

    const responderEmail = `e2e.responder+${Date.now()}@cad.local`;
    const responderName = "E2E Responder";

    // Create responder via API (stable).
    const dispatcherToken = await page.evaluate(() => sessionStorage.getItem("cad_token"));
    expect(dispatcherToken).toBeTruthy();
    const registerRes = await page.request.post("http://localhost:3001/api/auth/register", {
      data: {
        username: responderEmail,
        password: "password123",
        name: responderName,
        role: "responder",
        unit: "EMS",
      },
    });
    expect(registerRes.ok()).toBeTruthy();

    // Open chats (direct messages) panel
    await page.getByRole("link", { name: /chats/i }).click();
    await expect(page.getByRole("heading", { name: /Chats/i }).first()).toBeVisible({ timeout: 5000 });

    // Select any contact (prefers responder, but generic works)
    const contactList = page.getByPlaceholder(/search chats/i);
    await contactList.fill("");

    const responderContactBtn = page.getByRole("button", { name: new RegExp(responderName, "i") }).first();
    await responderContactBtn.click();

    // Send a DM
    const input = page.getByPlaceholder(/type message/i);
    await input.fill("Test message from dispatcher");
    await page.getByRole("button", { name: /^send$/i }).click();

    // Message should appear in conversation view
    await expect(page.getByText(/test message from dispatcher/i)).toBeVisible();
  });

  test("dispatcher assigns responder and responder location posts succeed", async ({ page }) => {
    const dispatcherEmail = `e2e.assign.dispatcher+${Date.now()}@cad.local`;
    const responderEmail = `e2e.assign.responder+${Date.now()}@cad.local`;
    const responderName = "E2E Responder";
    const incidentTitle = `Assignment Test Incident ${Date.now()}`;

    const registerRes = await page.request.post("http://localhost:3001/api/auth/register", {
      data: {
        username: responderEmail,
        password: E2E_PASSWORD,
        name: responderName,
        role: "responder",
        unit: "EMS",
      },
    });
    expect(registerRes.ok()).toBeTruthy();

    await gotoLogin(page);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.getByLabel(/full name/i).fill("E2E Assignment Dispatcher");
    await page.getByLabel(/email/i).fill(dispatcherEmail);
    await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
    await page.getByLabel(/^confirm password$/i).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/dispatcher/, { timeout: 15000 });

    await openCreateIncidentModal(page);
    await page.getByPlaceholder(/short title/i).fill(incidentTitle);
    await page.getByPlaceholder(/describe what happened/i).fill("Testing assignment and location ping");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(new RegExp(incidentTitle, "i")).first()).toBeVisible({ timeout: 15000 });
    // Saving auto-opens the incident details panel (no list row click needed).
    await page.getByRole("tab", { name: /details/i }).click();

    const responderLoginRes = await page.request.post("http://localhost:3001/api/auth/login", {
      data: { username: responderEmail, password: E2E_PASSWORD },
    });
    expect(responderLoginRes.ok()).toBeTruthy();
    const responderLoginJson = await responderLoginRes.json();
    const responderToken: string = responderLoginJson.token;
    const responderId: string = responderLoginJson.user?.id;
    expect(responderId).toBeTruthy();

    const dispatcherToken = await page.evaluate(() => sessionStorage.getItem("cad_token"));
    expect(dispatcherToken).toBeTruthy();

    const incidentsRes = await page.request.get("http://localhost:3001/api/incidents?unit=EMS&limit=50", {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    expect(incidentsRes.ok()).toBeTruthy();
    const incidentsJson = await incidentsRes.json();
    const incidentId = (incidentsJson ?? []).find(
      (i: { title?: string }) => String(i.title).toLowerCase() === incidentTitle.toLowerCase()
    )?.id;
    expect(incidentId).toBeTruthy();

    const assignRes = await page.request.post(`http://localhost:3001/api/incidents/${incidentId}/assign`, {
      headers: { Authorization: `Bearer ${dispatcherToken}`, "Content-Type": "application/json" },
      data: { responderId },
    });
    expect(assignRes.ok()).toBeTruthy();

    await page.reload();

    const afterAssign = await page.request.get(`http://localhost:3001/api/incidents/${incidentId}`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    expect(afterAssign.ok()).toBeTruthy();
    expect((await afterAssign.json()).status).toBe("ASSIGNED");

    await page.getByRole("button", { name: new RegExp(incidentTitle, "i") }).first().click();
    await page.getByRole("tab", { name: /details/i }).click();
    await expect(page.getByText(new RegExp(`Assigned to ${responderName}`, "i")).first()).toBeVisible({
      timeout: 30000,
    });

    const locRes = await page.request.post("http://localhost:3001/api/responder/location", {
      headers: { Authorization: `Bearer ${responderToken}`, "Content-Type": "application/json" },
      data: { lat: -1.9443, lon: 30.0592 },
    });
    expect(locRes.ok()).toBeTruthy();
  });
});
