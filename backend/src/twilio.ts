const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

function isValidTwilioAccountSid(sid: string | undefined): boolean {
  // Twilio Account SID format starts with "AC" (e.g. "AC123...")
  return typeof sid === "string" && sid.trim().toUpperCase().startsWith("AC");
}

export function isTwilioConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber && isValidTwilioAccountSid(accountSid));
}

export async function sendSms(to: string, body: string): Promise<{ sid?: string }> {
  if (!isTwilioConfigured()) {
    throw new Error(
      "Twilio not configured correctly. Set TWILIO_ACCOUNT_SID (must start with 'AC'), TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
    );
  }

  const twilio = await import("twilio");
  const client = twilio.default(accountSid, authToken);
  const message = await client.messages.create({
    body,
    from: fromNumber,
    to: to.replace(/\s/g, ""),
  });

  return { sid: message.sid };
}
