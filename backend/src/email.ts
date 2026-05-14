import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/**
 * Get email transporter. Uses SMTP config from env, or Ethereal test account when not configured.
 * For testing without any signup: leave SMTP unset and Ethereal.createTestAccount() is used.
 */
export async function getEmailTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(
      "[CAD] Using Ethereal test SMTP. Messages: https://ethereal.email | User:",
      testAccount.user
    );
  }

  return transporter;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<{ messageId?: string; previewUrl?: string }> {
  const transport = await getEmailTransporter();
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM || "CAD <noreply@cad.local>",
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });

  const raw = nodemailer.getTestMessageUrl?.(info);
  const previewUrl = typeof raw === "string" ? raw : undefined;
  if (previewUrl) {
    console.log("[CAD] Test email preview:", previewUrl);
  }

  return { messageId: info.messageId, previewUrl };
}
