import jwt from "jsonwebtoken";
import path from "path";
import { getRecordingsDir } from "./storage";

type StartRecordingResult = {
  egressId: string;
  fileUrl: string;
  filePath?: string;
};

function getLivekitHost(): string | undefined {
  return process.env.LIVEKIT_HOST?.trim() || undefined;
}

function getLivekitUrl(): string | undefined {
  return process.env.LIVEKIT_URL?.trim() || undefined;
}

function getLivekitApiKey(): string | undefined {
  return process.env.LIVEKIT_API_KEY?.trim() || undefined;
}

function getLivekitApiSecret(): string | undefined {
  return process.env.LIVEKIT_API_SECRET?.trim() || undefined;
}

function getRestBase(): string | undefined {
  const LIVEKIT_HOST = getLivekitHost();
  const LIVEKIT_URL = getLivekitUrl();
  if (LIVEKIT_HOST) return LIVEKIT_HOST;
  if (LIVEKIT_URL) {
    // Convert ws(s)://... to http(s)://... for REST calls
    return LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  }
  return undefined;
}

function isLivekitConfigured(): boolean {
  return !!(getRestBase() && getLivekitApiKey() && getLivekitApiSecret());
}

function createServerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const apiKey = getLivekitApiKey();
  const apiSecret = getLivekitApiSecret();
  if (!apiKey || !apiSecret) {
    throw new Error("LiveKit API key/secret are not configured.");
  }
  return jwt.sign(
    {
      iss: apiKey,
      sub: "cad-backend",
      nbf: now,
      exp: now + 60 * 5,
      video: {
        roomRecord: true,
      },
    },
    apiSecret
  );
}

/**
 * Start a LiveKit room-composite recording for the given incident.
 * Room name convention: incident-{incidentId}
 *
 * If LiveKit is not configured, this becomes a no-op and returns null.
 */
export async function startRoomRecording(incidentId: string): Promise<StartRecordingResult | null> {
  if (!isLivekitConfigured()) {
    console.warn("[LiveKit] Skipping recording start – LIVEKIT_* env vars not set.");
    return null;
  }

  const token = createServerToken();
  const roomName = `incident-${incidentId}`;
  const base = getRestBase()!;
  const filename = `${roomName}-${Date.now()}.mp4`;
  const fileUrl = `/api/uploads/recordings/${filename}`;
  const outputMode = (process.env.LIVEKIT_RECORDING_OUTPUT ?? "uploads").toLowerCase(); // 'uploads' | 'filepath'

  // LiveKit Egress writes to the machine/container running Egress.
  // - uploads: write under /app/uploads/recordings/ (shared volume in docker-compose.livekit.yml)
  // - filepath: write to explicit filepath on the egress filesystem
  const filepath =
    outputMode === "filepath"
      ? path.join(getRecordingsDir(), filename)
      : `/app/uploads/recordings/${filename}`;

  const res = await fetch(`${base}/twirp/livekit.Egress/StartRoomCompositeEgress`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room_name: roomName,
      file_outputs: [
        {
          file_type: "MP4",
          filepath,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // If the room doesn't exist yet in LiveKit, just log and skip recording
    if (res.status === 404) {
      console.warn("[LiveKit] StartRoomCompositeEgress: room not found, skipping recording.");
      return null;
    }
    // If Egress is unavailable (egress not running / misconfigured), log and skip
    if (res.status === 503 || res.status === 502 || res.status === 500) {
      console.warn("[LiveKit] StartRoomCompositeEgress unavailable, skipping recording:", res.status, text);
      return null;
    }
    console.error("[LiveKit] StartRoomCompositeEgress failed:", res.status, text);
    throw new Error(`LiveKit recording start failed with status ${res.status}`);
  }

  const data: any = await res.json();
  const egressId: string | undefined = data.egress_id || data.egressId;
  if (!egressId) {
    console.warn("[LiveKit] StartRoomCompositeEgress response missing egress_id:", data);
    throw new Error("LiveKit recording start response missing egress_id");
  }

  return {
    egressId,
    fileUrl,
    filePath: outputMode === "filepath" ? filepath : undefined,
  };
}

/**
 * Stop an active LiveKit egress (recording) by id.
 * If LiveKit is not configured, this is a no-op.
 */
export async function stopRoomRecording(egressId: string): Promise<void> {
  if (!isLivekitConfigured()) {
    return;
  }

  const token = createServerToken();
  const base = getRestBase()!;

  const res = await fetch(`${base}/twirp/livekit.Egress/StopEgress`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ egress_id: egressId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[LiveKit] StopEgress failed:", res.status, text);
    // Do not throw – stopping on disconnect/end should be best-effort
  }
}

