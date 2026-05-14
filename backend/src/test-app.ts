/**
 * Test helper: creates Express app with mock Socket.IO for integration tests.
 */
import express from "express";
import cors from "cors";
import path from "path";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import { registerIncidentRoutes } from "./routes/incidents";
import { registerResponderRoutes } from "./routes/responder";
import { registerAuthRoutes } from "./routes/auth";
import { registerAuditRoutes } from "./routes/audit";
import { registerEmailRoutes } from "./routes/email";
import { registerTwilioRoutes } from "./routes/twilio";
import { registerUploadRoutes } from "./routes/upload";
import { registerPoiRoutes } from "./routes/poi";
import { registerWitnessRoutes } from "./routes/witnesses";
import { registerDrawingRoutes } from "./routes/drawings";
import { registerDocumentRoutes } from "./routes/documents";
import { registerGeofenceRoutes } from "./routes/geofences";
import { registerMediaRoutes } from "./routes/media";
import { registerStatsRoutes } from "./routes/stats";
import { registerUserRoutes } from "./routes/users";
import { registerDirectMessageRoutes } from "./routes/dm";
import { registerArcgisRoutes } from "./routes/arcgis";

const mockIo = {
  emit: () => {},
  to: () => ({ emit: () => {} }),
};

export function createTestApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "5mb" }));

  const apiRouter = express.Router();
  registerAuthRoutes(apiRouter);
  registerIncidentRoutes(apiRouter, mockIo as any);
  registerResponderRoutes(apiRouter, mockIo as any);
  registerAuditRoutes(apiRouter);
  registerEmailRoutes(apiRouter);
  registerTwilioRoutes(apiRouter, mockIo as any);
  registerUploadRoutes(apiRouter);
  registerPoiRoutes(apiRouter);
  registerWitnessRoutes(apiRouter);
  registerDrawingRoutes(apiRouter, mockIo as any);
  registerDocumentRoutes(apiRouter);
  registerGeofenceRoutes(apiRouter);
  registerMediaRoutes(apiRouter);
  registerStatsRoutes(apiRouter);
  registerUserRoutes(apiRouter);
  registerDirectMessageRoutes(apiRouter, mockIo as any);
  registerArcgisRoutes(apiRouter);

  app.use("/api", apiRouter);

  const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
  app.use("/api/uploads", express.static(uploadsDir));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use((err: any, _req: express.Request, res: express.Response) => {
    if (err instanceof ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid request payload", details: err.issues });
    }
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal server error" });
  });

  return app;
}
