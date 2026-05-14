import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";
const E2E_PASSWORD = "password123";

test.describe("Incident lifecycle smoke", () => {
  test("create → assign → accept → complete; admin list carries lifecycle timestamps", async ({ request }) => {
    const ts = Date.now();
    const dispatcherUser = `e2e.lifecycle.disp+${ts}@cad.local`;
    const responderUser = `e2e.lifecycle.rsp+${ts}@cad.local`;

    const regD = await request.post(`${API}/auth/register`, {
      data: {
        username: dispatcherUser,
        password: E2E_PASSWORD,
        name: "E2E Lifecycle Dispatcher",
        role: "dispatcher",
      },
    });
    expect(regD.ok(), await regD.text()).toBeTruthy();

    const regR = await request.post(`${API}/auth/register`, {
      data: {
        username: responderUser,
        password: E2E_PASSWORD,
        name: "E2E Lifecycle Responder",
        role: "responder",
        unit: "EMS",
      },
    });
    expect(regR.ok(), await regR.text()).toBeTruthy();

    const loginD = await request.post(`${API}/auth/login`, {
      data: { username: dispatcherUser, password: E2E_PASSWORD },
    });
    expect(loginD.ok(), await loginD.text()).toBeTruthy();
    const loginDJson = (await loginD.json()) as { token: string };
    const tokD = loginDJson.token;
    expect(tokD).toBeTruthy();

    const loginR = await request.post(`${API}/auth/login`, {
      data: { username: responderUser, password: E2E_PASSWORD },
    });
    expect(loginR.ok(), await loginR.text()).toBeTruthy();
    const loginRJson = (await loginR.json()) as { token: string; user: { id: string } };
    const tokR = loginRJson.token;
    const responderId = loginRJson.user?.id;
    expect(tokR).toBeTruthy();
    expect(responderId).toBeTruthy();

    const title = `E2E Lifecycle ${ts}`;
    const createRes = await request.post(`${API}/incidents`, {
      headers: { Authorization: `Bearer ${tokD}`, "Content-Type": "application/json" },
      data: {
        title,
        description: "Lifecycle smoke description long enough",
        status: "NEW",
        priority: "MEDIUM",
        category: "MEDICAL",
        location: { lat: -1.9443, lon: 30.0592, address: "Kigali" },
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as { id: string; createdAt: string; status: string };
    expect(created.status).toBe("NEW");
    const incidentId = created.id;
    const createdAt = created.createdAt;

    const assignRes = await request.post(`${API}/incidents/${incidentId}/assign`, {
      headers: { Authorization: `Bearer ${tokD}`, "Content-Type": "application/json" },
      data: { responderId },
    });
    expect(assignRes.ok(), await assignRes.text()).toBeTruthy();
    const afterAssign = (await assignRes.json()) as {
      status: string;
      details?: { timeline?: { assignedAt?: string } };
    };
    expect(afterAssign.status).toBe("ASSIGNED");
    const assignedAt = afterAssign.details?.timeline?.assignedAt;
    expect(assignedAt).toBeTruthy();
    expect(new Date(assignedAt!).getTime()).toBeGreaterThanOrEqual(new Date(createdAt).getTime() - 1000);

    const acceptRes = await request.post(`${API}/incidents/${incidentId}/accept`, {
      headers: { Authorization: `Bearer ${tokR}`, "Content-Type": "application/json" },
    });
    expect(acceptRes.ok(), await acceptRes.text()).toBeTruthy();
    const afterAccept = (await acceptRes.json()) as {
      status: string;
      details?: {
        timeline?: { inProgressAt?: string; assignedAt?: string };
        responderDecision?: { acceptedAt?: string };
      };
    };
    expect(afterAccept.status).toBe("IN_PROGRESS");
    const acceptedAt = afterAccept.details?.responderDecision?.acceptedAt;
    const inProgressAt = afterAccept.details?.timeline?.inProgressAt;
    expect(acceptedAt).toBeTruthy();
    expect(inProgressAt).toBeTruthy();
    expect(new Date(acceptedAt!).getTime()).toBe(new Date(inProgressAt!).getTime());
    expect(new Date(acceptedAt!).getTime()).toBeGreaterThanOrEqual(new Date(assignedAt!).getTime() - 1000);

    const completeRes = await request.post(`${API}/incidents/${incidentId}/complete`, {
      headers: { Authorization: `Bearer ${tokR}`, "Content-Type": "application/json" },
      data: { summary: "E2E smoke complete" },
    });
    expect(completeRes.ok(), await completeRes.text()).toBeTruthy();
    const afterComplete = (await completeRes.json()) as {
      status: string;
      details?: {
        timeline?: { completedAt?: string };
        responderDecision?: { completedAt?: string };
      };
    };
    expect(afterComplete.status).toBe("RESOLVED");
    const completedAt =
      afterComplete.details?.timeline?.completedAt ?? afterComplete.details?.responderDecision?.completedAt;
    expect(completedAt).toBeTruthy();
    expect(new Date(completedAt!).getTime()).toBeGreaterThanOrEqual(new Date(inProgressAt!).getTime() - 1000);

    const adminLogin = await request.post(`${API}/admin/auth/login`, {
      data: { username: "admin", password: "Admin@12345" },
    });
    expect(adminLogin.ok(), await adminLogin.text()).toBeTruthy();
    const adminJson = (await adminLogin.json()) as { token: string };
    const adminTok = adminJson.token;
    expect(adminTok).toBeTruthy();

    const listRes = await request.get(`${API}/admin/incidents?limit=200&offset=0`, {
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    expect(listRes.ok(), await listRes.text()).toBeTruthy();
    const listJson = (await listRes.json()) as {
      items: Array<{ id: string; createdAt?: string; details?: Record<string, unknown> }>;
    };
    const hit = listJson.items.find((i) => i.id === incidentId);
    expect(hit, "admin incident list includes the incident").toBeTruthy();

    const details = (hit!.details ?? {}) as Record<string, unknown>;
    const timeline = (details.timeline ?? {}) as Record<string, unknown>;
    const responderDecision = (details.responderDecision ?? {}) as Record<string, unknown>;

    expect(hit!.createdAt).toBeTruthy();
    expect(timeline.assignedAt).toBe(assignedAt);
    expect(responderDecision.acceptedAt).toBe(acceptedAt);
    expect(timeline.inProgressAt).toBe(inProgressAt);
    expect(timeline.completedAt || responderDecision.completedAt).toBe(completedAt);
  });
});
