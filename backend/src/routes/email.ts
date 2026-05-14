import type { Router } from "express";
import { z } from "zod";
import { sendEmail } from "../email";

const testEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  body: z.string().optional(),
});

/**
 * Test endpoint for email integration. No auth required in dev to verify Ethereal/Mailtrap.
 * In production, protect this endpoint.
 */
export function registerEmailRoutes(router: Router) {
  router.post("/test-email", async (req, res, next) => {
    try {
      const data = testEmailSchema.parse(req.body);
      const result = await sendEmail({
        to: data.to,
        subject: data.subject ?? "CAD Test Email",
        text: data.body ?? "This is a test email from the CAD system. If you see this, email integration works.",
      });
      res.json({
        success: true,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        hint: result.previewUrl ? "Open previewUrl in browser to view the test email." : undefined,
      });
    } catch (err) {
      next(err);
    }
  });
}
