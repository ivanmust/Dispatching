import type { Router, Request, Response } from "express";
import { z } from "zod";
import type { Server } from "socket.io";
import { sendSms, isTwilioConfigured } from "../twilio";
import { requireAuth, requireRole } from "../middleware/auth";

const sendSmsSchema = z.object({
  to: z.string().min(10),
  body: z.string().min(1).max(1600),
});

export function registerTwilioRoutes(router: Router, io: Server) {
  router.get("/twilio/status", (_req, res) => {
    res.json({ configured: isTwilioConfigured() });
  });

  router.post("/twilio/sms", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const data = sendSmsSchema.parse(req.body);
      const result = await sendSms(data.to, data.body);
      res.json({ success: true, sid: result.sid });
    } catch (err) {
      next(err);
    }
  });

  // Inbound voice webhook from Twilio (for call-taking)
  router.post("/twilio/voice-inbound", (req: Request, res: Response) => {
    const from = typeof req.body.From === "string" ? req.body.From : undefined;
    const to = typeof req.body.To === "string" ? req.body.To : undefined;
    const callSid = typeof req.body.CallSid === "string" ? req.body.CallSid : undefined;

    if (from && callSid) {
      io.emit("call:incoming", {
        from,
        to,
        callSid,
      });
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You have reached the dispatch demo system. Please stay on the line while we connect you to a dispatcher.</Say>
</Response>`;

    res.type("text/xml").send(twiml);
  });
}
