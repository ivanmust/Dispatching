import dotenv from "dotenv";

dotenv.config();

interface ArcGISToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedToken: ArcGISToken | null = null;

const PORTAL_URL = process.env.ARCGIS_PORTAL_URL || "https://www.arcgis.com";

export async function getArcGISToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.ARCGIS_CLIENT_ID;
  const clientSecret = process.env.ARCGIS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "ARCGIS_CLIENT_ID and ARCGIS_CLIENT_SECRET must be set. Get free credentials at https://developers.arcgis.com/"
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    expiration: "60",
    f: "json",
  });

  const resp = await fetch(`${PORTAL_URL}/sharing/rest/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    throw new Error(`Failed to obtain ArcGIS token: ${resp.status}`);
  }

  const data: any = await resp.json();
  if (!data.access_token || !data.expires_in) {
    throw new Error("ArcGIS token response missing access_token or expires_in");
  }

  const expiresAt = Date.now() + data.expires_in * 1000;
  cachedToken = { token: data.access_token, expiresAt };
  return cachedToken.token;
}

