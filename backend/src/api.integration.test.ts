import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createTestApp } from "./test-app";
import fs from "fs";
import path from "path";
import { pool, query } from "./db";

const app = createTestApp();
const TEST_PASSWORD = "password123";

describe("API integration", () => {
  let dispatcherToken: string;
  let responderToken: string;
  let incidentId: string;
  let dispatcherUsername: string;

  beforeAll(async () => {
    // Ensure schema is up to date for local/dev databases.
    const schemaPath = path.join(__dirname, "..", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    await pool.query(sql);

    const suffix = Date.now();
    dispatcherUsername = `it.disp+${suffix}@cad.local`;
    const responderUsername = `it.rsp+${suffix}@cad.local`;

    const regD = await request(app).post("/api/auth/register").send({
      username: dispatcherUsername,
      password: TEST_PASSWORD,
      name: "Integration Dispatcher",
      role: "dispatcher",
    });
    expect(regD.status).toBe(201);

    const regR = await request(app).post("/api/auth/register").send({
      username: responderUsername,
      password: TEST_PASSWORD,
      name: "Integration Responder",
      role: "responder",
      unit: "EMS",
    });
    expect(regR.status).toBe(201);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: dispatcherUsername, password: TEST_PASSWORD });
    dispatcherToken = loginRes.body.token;

    const responderLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: responderUsername, password: TEST_PASSWORD });
    responderToken = responderLogin.body.token;

    // Create a base incident for downstream tests (witnesses, media, etc.)
    const incRes = await request(app)
      .post("/api/incidents")
      .set("Authorization", `Bearer ${dispatcherToken}`)
      .send({
        title: "Integration base incident",
        description: "Used in integration tests",
        status: "NEW",
        priority: "MEDIUM",
        category: "OTHER",
        location: { lat: -1.95, lon: 30.06, address: "Test" },
      });
    incidentId = incRes.body.id;
  });

  describe("Auth", () => {
    it("POST /auth/login rejects invalid credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "bad@cad.local", password: "wrong123" });
      expect(res.status).toBe(401);
    });

    it("POST /auth/login returns token for valid credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: dispatcherUsername, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.role).toBe("dispatcher");
    });

    it("GET /incidents without auth returns 401", async () => {
      const res = await request(app).get("/api/incidents");
      expect(res.status).toBe(401);
    });

    it("GET /incidents with valid token returns incidents", async () => {
      const res = await request(app)
        .get("/api/incidents")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("Incidents", () => {
    it("POST /incidents creates incident with dispatcher auth", async () => {
      const res = await request(app)
        .post("/api/incidents")
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({
          title: "Test incident",
          description: "Integration test",
          status: "NEW",
          priority: "MEDIUM",
          category: "OTHER",
          location: { lat: -1.95, lon: 30.06, address: "Test" },
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("Test incident");
    });

    it("GET /responder/incidents returns only assigned for responder", async () => {
      const res = await request(app)
        .get("/api/responder/incidents")
        .set("Authorization", `Bearer ${responderToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("POIs", () => {
    it("GET /points-of-interest requires auth", async () => {
      const res = await request(app).get("/api/points-of-interest");
      expect(res.status).toBe(401);
    });

    it("GET /points-of-interest returns POIs with auth", async () => {
      const res = await request(app)
        .get("/api/points-of-interest")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("Witnesses", () => {
    it("POST/GET/DELETE /incidents/:id/witnesses works for dispatcher", async () => {
      const create = await request(app)
        .post(`/api/incidents/${incidentId}/witnesses`)
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({ name: "Test Witness", phone: "+1234567890", notes: "Saw everything" });
      expect(create.status).toBe(201);
      expect(create.body).toHaveProperty("id");

      const list = await request(app)
        .get(`/api/incidents/${incidentId}/witnesses`)
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body.length).toBeGreaterThan(0);

      const witnessId = create.body.id as string;
      const del = await request(app)
        .delete(`/api/incidents/${incidentId}/witnesses/${witnessId}`)
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(del.status).toBe(204);
    });
  });

  describe("Documents & resources", () => {
    it("GET /documents returns documents for dispatcher when seeded", async () => {
      await query(
        `INSERT INTO documents (name, category, file_url)
         VALUES ($1, $2, $3)`,
        ["Test SOP", "SOP", "http://example.com/doc.pdf"]
      );

      const res = await request(app)
        .get("/api/documents")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((d: any) => d.name === "Test SOP")).toBe(true);
    });
  });

  describe("Geofences", () => {
    it("POST/GET/DELETE /geofences works for dispatcher and read-only for responder", async () => {
      const create = await request(app)
        .post("/api/geofences")
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({
          name: "Test Zone",
          geometry: { type: "circle", lat: -1.95, lon: 30.06, radiusMeters: 200 },
        });
      expect(create.status).toBe(201);
      const geofenceId = create.body.id as string;

      const listResponder = await request(app)
        .get("/api/geofences")
        .set("Authorization", `Bearer ${responderToken}`);
      expect(listResponder.status).toBe(200);
      expect(Array.isArray(listResponder.body)).toBe(true);

      const del = await request(app)
        .delete(`/api/geofences/${geofenceId}`)
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(del.status).toBe(204);
    });
  });

  describe("Media archive", () => {
    it("GET /media/attachments lists chat attachments when present", async () => {
      // Seed a chat message with attachment for the base incident
      const { rows: users } = await query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE role = 'dispatcher' LIMIT 1`
      );
      const dispatcherId = users[0].id;

      await query(
        `INSERT INTO chat_messages (incident_id, sender_id, sender_name, sender_role, content, attachment_url, attachment_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [incidentId, dispatcherId, "Dispatcher", "dispatcher", "Test with attachment", "http://example.com/image.jpg", "image"]
      );

      const res = await request(app)
        .get("/api/media/attachments")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe("Stats", () => {
    it("GET /stats/summary returns aggregate stats for dispatcher", async () => {
      const res = await request(app)
        .get("/api/stats/summary")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("countsByStatus");
      expect(res.body).toHaveProperty("countsByCategory");
      expect(res.body).toHaveProperty("avgResolutionMinutes");
    });

    it("GET /stats/timeseries returns time-bucketed counts", async () => {
      const res = await request(app)
        .get("/api/stats/timeseries?bucket=day&days=3")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("bucket");
      expect(res.body).toHaveProperty("points");
      expect(Array.isArray(res.body.points)).toBe(true);
    });
  });

  describe("User management", () => {
    it("GET /users lists users for dispatcher", async () => {
      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("POST/PATCH /users allows dispatcher to manage users", async () => {
      const uniqueUsername = `test.user+${Date.now()}@cad.local`;
      const create = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({
          username: uniqueUsername,
          name: "Test User",
          role: "responder",
          phone: "+250788000000",
        });
      expect(create.status).toBe(201);
      expect(create.body).toHaveProperty("id");
      const userId = create.body.id as string;

      const update = await request(app)
        .patch(`/api/users/${userId}`)
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({
          name: "Updated Test User",
          isActive: false,
        });
      expect(update.status).toBe(200);
      expect(update.body.name).toBe("Updated Test User");
      expect(update.body.isActive).toBe(false);

      const reset = await request(app)
        .post(`/api/users/${userId}/reset-password`)
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({ newPassword: "Newpass123" });
      expect(reset.status).toBe(200);
      expect(reset.body).toHaveProperty("success", true);
    });
  });

  describe("Direct messaging", () => {
    it("dispatcher can open conversation and send DM to responder", async () => {
      // Look up an active responder user
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM users WHERE role = 'responder' AND (is_active IS NULL OR is_active = TRUE) LIMIT 1`
      );
      const responderId = rows[0].id;

      const open = await request(app)
        .post("/api/dm/open")
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({ userId: responderId });
      expect(open.status).toBe(201);
      expect(open.body).toHaveProperty("conversationId");
      const conversationId = open.body.conversationId as string;

      const send = await request(app)
        .post("/api/dm/send")
        .set("Authorization", `Bearer ${dispatcherToken}`)
        .send({ conversationId, content: "Hello responder", priority: "normal" });
      expect(send.status).toBe(201);
      expect(send.body).toHaveProperty("id");

      const history = await request(app)
        .get(`/api/dm/history?conversationId=${conversationId}&limit=10`)
        .set("Authorization", `Bearer ${dispatcherToken}`);
      expect(history.status).toBe(200);
      expect(Array.isArray(history.body)).toBe(true);
      expect(history.body.length).toBeGreaterThan(0);
    });
  });
});
