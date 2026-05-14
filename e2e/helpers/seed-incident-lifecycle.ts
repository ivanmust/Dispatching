import type { APIRequestContext } from "@playwright/test";

const E2E_PASSWORD = "password123";

export type SeededLifecycle = {
  incidentId: string;
  title: string;
  dispatcherToken: string;
  responderToken: string;
};

/** Creates dispatcher + responder, incident NEW → assign → accept → complete. Returns ids and tokens. */
export async function seedIncidentLifecycle(request: APIRequestContext, apiBase: string): Promise<SeededLifecycle> {
  const API = `${apiBase.replace(/\/$/, "")}/api`;
  const ts = Date.now();
  const dispatcherUser = `e2e.seed.disp+${ts}@cad.local`;
  const responderUser = `e2e.seed.rsp+${ts}@cad.local`;

  const regD = await request.post(`${API}/auth/register`, {
    data: {
      username: dispatcherUser,
      password: E2E_PASSWORD,
      name: "E2E Seed Dispatcher",
      role: "dispatcher",
    },
  });
  if (!regD.ok()) throw new Error(`register dispatcher: ${regD.status()} ${await regD.text()}`);

  const regR = await request.post(`${API}/auth/register`, {
    data: {
      username: responderUser,
      password: E2E_PASSWORD,
      name: "E2E Seed Responder",
      role: "responder",
      unit: "EMS",
    },
  });
  if (!regR.ok()) throw new Error(`register responder: ${regR.status()} ${await regR.text()}`);

  const loginD = await request.post(`${API}/auth/login`, {
    data: { username: dispatcherUser, password: E2E_PASSWORD },
  });
  if (!loginD.ok()) throw new Error(`login dispatcher: ${loginD.status()} ${await loginD.text()}`);
  const { token: dispatcherToken } = (await loginD.json()) as { token: string };

  const loginR = await request.post(`${API}/auth/login`, {
    data: { username: responderUser, password: E2E_PASSWORD },
  });
  if (!loginR.ok()) throw new Error(`login responder: ${loginR.status()} ${await loginR.text()}`);
  const { token: responderToken, user: userR } = (await loginR.json()) as { token: string; user: { id: string } };
  const responderId = userR.id;

  const title = `E2E Seed Lifecycle ${ts}`;
  const createRes = await request.post(`${API}/incidents`, {
    headers: { Authorization: `Bearer ${dispatcherToken}`, "Content-Type": "application/json" },
    data: {
      title,
      description: "Seed lifecycle description long enough",
      status: "NEW",
      priority: "MEDIUM",
      category: "MEDICAL",
      location: { lat: -1.9443, lon: 30.0592, address: "Kigali" },
    },
  });
  if (!createRes.ok()) throw new Error(`create incident: ${createRes.status()} ${await createRes.text()}`);
  const created = (await createRes.json()) as { id: string };
  const incidentId = created.id;

  const assignRes = await request.post(`${API}/incidents/${incidentId}/assign`, {
    headers: { Authorization: `Bearer ${dispatcherToken}`, "Content-Type": "application/json" },
    data: { responderId },
  });
  if (!assignRes.ok()) throw new Error(`assign: ${assignRes.status()} ${await assignRes.text()}`);

  const acceptRes = await request.post(`${API}/incidents/${incidentId}/accept`, {
    headers: { Authorization: `Bearer ${responderToken}`, "Content-Type": "application/json" },
  });
  if (!acceptRes.ok()) throw new Error(`accept: ${acceptRes.status()} ${await acceptRes.text()}`);

  const completeRes = await request.post(`${API}/incidents/${incidentId}/complete`, {
    headers: { Authorization: `Bearer ${responderToken}`, "Content-Type": "application/json" },
    data: { summary: "E2E seed complete" },
  });
  if (!completeRes.ok()) throw new Error(`complete: ${completeRes.status()} ${await completeRes.text()}`);

  return { incidentId, title, dispatcherToken, responderToken };
}
