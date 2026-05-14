import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Camera } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../lib/api";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { Button } from "../ui/Button";

type Props = {
  incidentId: string;
  showWhenIdle?: boolean;
  onIncomingRequest?: () => void;
  onBack?: () => void;
  initialIncoming?: { incidentId: string; incidentTitle?: string } | null;
};

function escapeForHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildVideoHtml(params: { url: string; token: string; roomName: string; muted: boolean }): string {
  const url = escapeForHtmlAttr(params.url);
  const token = escapeForHtmlAttr(params.token);
  const roomName = escapeForHtmlAttr(params.roomName);
  const muted = params.muted ? "true" : "false";

  // Note: we use an ESM import via esm.sh to avoid bundling livekit-client into the RN app.
  // This runs inside the WebView so browser WebRTC APIs (getUserMedia) are available.
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
      #remote { display:none; }
      #local { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; background:#000; }
    </style>
  </head>
  <body>
    <video id="remote" autoplay playsinline muted></video>
    <audio id="remoteAudio" autoplay></audio>
    <video id="local" autoplay playsinline muted></video>
    <script>
      function post(msg) {
        try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(msg)); } catch(e) {}
      }
      window.__dispatchToggleMute = null;
      window.__dispatchEnd = null;
    </script>
    <script type="module">
      try {
        const { Room, RoomEvent, VideoPresets } = await import('https://esm.sh/livekit-client');

        const url = "${url}";
        const token = "${token}";
        const roomName = "${roomName}";
        let room = null;
        let localStream = null;
        let remoteVideo = document.getElementById("remote");
        const remoteAudio = document.getElementById("remoteAudio");
        const localVideo = document.getElementById("local");

        let muted = ${muted};

        function setMuted(next) {
          muted = !!next;
          if (!localStream) return;
          const audioTracks = localStream.getAudioTracks();
          audioTracks.forEach(t => { t.enabled = !muted; });
        }

        window.__dispatchToggleMute = () => setMuted(!muted);

        window.__dispatchEnd = () => {
          try {
            room && room.disconnect && room.disconnect();
          } catch (e) {}
          try {
            localStream && localStream.getTracks && localStream.getTracks().forEach(t => t.stop());
          } catch (e) {}
          post("video-ended");
        };

        let watchdog = null;
        const startWatchdog = () => {
          watchdog = setTimeout(() => {
            post("video-error:Video setup timed out (check LiveKit connectivity/permissions).");
            try { room && room.disconnect && room.disconnect(); } catch (e) {}
          }, 60000);
        };
        const clearWatchdog = () => {
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = null;
          }
        };

        try {
          post("video-loading");
          startWatchdog();

          room = new Room({
            adaptiveStream: true,
            dynacast: true,
            // These defaults align with the web responder.
            videoCaptureDefaults: {
              resolution: VideoPresets ? VideoPresets.h720.resolution : undefined
            }
          });

          room.on(RoomEvent.TrackSubscribed, (track) => {
            try {
              if (!track || !track.kind) return;
              const kind = String(track.kind).toLowerCase();
              if (kind.includes("video")) {
                // Responder side focuses on local preview full-screen.
                // Still attach remote video if available (it is hidden via CSS).
                track.attach(remoteVideo);
              } else if (kind.includes("audio")) {
                track.attach(remoteAudio);
              }
            } catch (e) {}
          });

          // Connect first, then publish.
          room.prepareConnection && room.prepareConnection(url, token);
          await Promise.race([
            room.connect(url, token),
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      "LiveKit connect timeout. Check phone network access to LiveKit URL and backend LIVEKIT_URL config."
                    )
                  ),
                20000
              )
            ),
          ]);

          if (!navigator || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
            throw new Error("Media capture is not available in this WebView context (navigator.mediaDevices.getUserMedia missing).");
          }
          localStream = await Promise.race([
            navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            }),
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      "Camera/microphone permission timeout. Allow camera + microphone for the app and WebView."
                    )
                  ),
                20000
              )
            ),
          ]);

          localVideo.muted = true;
          localVideo.srcObject = localStream;
          try { await localVideo.play(); } catch (e) {}
          setMuted(muted);

          for (const track of localStream.getTracks()) {
            await room.localParticipant.publishTrack(track);
          }

          clearWatchdog();
          post("video-local-ready");
        } catch (err) {
          clearWatchdog();
          post("video-error:" + (err && err.message ? err.message : String(err)));
        }
      } catch (err) {
        post("video-error:Failed to load livekit-client: " + (err && err.message ? err.message : String(err)));
      }
    </script>
  </body>
</html>`;
}

export function IncidentVideoPanel({
  incidentId,
  showWhenIdle = false,
  onIncomingRequest,
  onBack,
  initialIncoming = null,
}: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createIncidentVideoStyles(theme), [theme]);
  const { socket } = useSocketMobile();
  const insets = useSafeAreaInsets();

  const [incoming, setIncoming] = useState<{ incidentId: string; incidentTitle?: string } | null>(() => {
    if (!initialIncoming) return null;
    if (String(initialIncoming.incidentId) !== String(incidentId)) return null;
    return { incidentId: String(initialIncoming.incidentId), incidentTitle: initialIncoming.incidentTitle };
  });
  const [streaming, setStreaming] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<{ url: string; token: string; roomName: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const webRef = useRef<WebView>(null);

  const ensureMediaPermissions = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    try {
      // Expo permission APIs are more reliable in Expo Go / managed workflow.
      const camPerm = await Camera.requestCameraPermissionsAsync();
      const micPerm = await Camera.requestMicrophonePermissionsAsync();
      let granted = camPerm.granted && micPerm.granted;

      // Android fallback in case OEM permission state is stale.
      if (!granted && Platform.OS === "android") {
        const requested = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        const cam = requested[PermissionsAndroid.PERMISSIONS.CAMERA];
        const mic = requested[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        granted = cam === PermissionsAndroid.RESULTS.GRANTED && mic === PermissionsAndroid.RESULTS.GRANTED;
      }

      if (!granted) {
        return {
          ok: false,
          message:
            "Camera/microphone permission denied. Please allow Camera and Microphone for Expo Go (or your app) in Android Settings, then try again.",
        };
      }
      return { ok: true };
    } catch (e: any) {
      return {
        ok: false,
        message: e?.message ?? "Failed to request camera/microphone permissions.",
      };
    }
  }, []);

  useEffect(() => {
    // If we were provided an initial incoming request (e.g. from a global overlay),
    // ensure our internal state matches the current props.
    if (initialIncoming) {
      if (String(initialIncoming.incidentId) === String(incidentId)) {
        setIncoming({ incidentId: String(initialIncoming.incidentId), incidentTitle: initialIncoming.incidentTitle });
      }
    } else {
      setIncoming(null);
    }
    // Reset stream state whenever the incident changes for this panel instance.
    setStreaming(false);
    setTokenInfo(null);
    setMuted(false);
    setError(null);
  }, [incidentId, initialIncoming]);

  useEffect(() => {
    if (!socket) return;

    const onRequested = (data: { incidentId: string; incidentTitle?: string }) => {
      if (data?.incidentId !== incidentId) return;
      setIncoming({ incidentId: data.incidentId, incidentTitle: data.incidentTitle });
      setError(null);
      onIncomingRequest?.();
    };

    const onEnded = (data: { incidentId: string }) => {
      if (data?.incidentId !== incidentId) return;
      setIncoming(null);
      setStreaming(false);
      setTokenInfo(null);
      setMuted(false);
      setError(null);
    };

    const onError = (data: { incidentId: string; message?: string }) => {
      if (data?.incidentId !== incidentId) return;
      setError(data?.message ? String(data.message) : "Video stream error");
      setIncoming(null);
      setStreaming(false);
      setTokenInfo(null);
      setMuted(false);
    };

    socket.on("video:requested", onRequested);
    socket.on("video:ended", onEnded);
    socket.on("video:error", onError);

    return () => {
      socket.off("video:requested", onRequested);
      socket.off("video:ended", onEnded);
      socket.off("video:error", onError);
    };
  }, [incidentId, socket]);

  const stopStream = useCallback(() => {
    setIncoming(null);
    setStreaming(false);
    setTokenInfo(null);
    setMuted(false);
    webRef.current?.injectJavaScript("window.__dispatchEnd && window.__dispatchEnd(); true;");
    // Let the other party know we ended.
    socket?.emit("video:end", { incidentId });
  }, [incidentId, socket]);

  const handleBack = useCallback(() => {
    // If we're only being asked to start, treat Back as "Reject".
    if (incoming && !streaming) {
      setIncoming(null);
      socket?.emit("video:reject", { incidentId });
      onBack?.();
      return;
    }
    // Otherwise, end the active stream.
    stopStream();
    onBack?.();
  }, [incoming, streaming, onBack, stopStream, socket, incidentId]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    webRef.current?.injectJavaScript("window.__dispatchToggleMute && window.__dispatchToggleMute(); true;");
  }, [muted]);

  const acceptRequest = useCallback(async () => {
    if (!socket) return;
    if (!incoming) return;
    setError(null);

    try {
      const perm = await ensureMediaPermissions();
      if (!perm.ok) {
        setError(perm.message ?? "Camera/microphone permission is required.");
        return;
      }

      const token = await api.getLivekitToken(incoming.incidentId);
      setTokenInfo(token);
      setStreaming(true);
      setIncoming(null);
      setMuted(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to get LiveKit token");
      setIncoming(null);
      setStreaming(false);
      setTokenInfo(null);
    }
  }, [ensureMediaPermissions, incoming, socket]);

  const onWebMessage = useCallback(
    (event: any) => {
      const msg = String(event?.nativeEvent?.data ?? "");
      if (!msg) return;
      if (msg === "video-local-ready") {
        // Now that the responder camera is publishing, notify dispatcher.
        socket?.emit("video:accept", { incidentId });
      }
      if (msg.startsWith("video-error:")) {
        const m = msg.slice("video-error:".length).trim();
        setError(m || "Video stream error");
        setIncoming(null);
        setStreaming(false);
        setTokenInfo(null);
      }
    },
    [incidentId, socket],
  );

  const videoHtml = useMemo(() => {
    if (!tokenInfo) return null;
    return buildVideoHtml({ url: tokenInfo.url, token: tokenInfo.token, roomName: tokenInfo.roomName, muted });
  }, [muted, tokenInfo]);

  if (error) {
    return (
      <View style={styles.center}>
        {onBack ? <Button title="Back" variant="secondary" onPress={handleBack} /> : null}
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.hintText}>
          Ensure phone has internet, camera/microphone permissions are granted, and LIVEKIT_URL is reachable from mobile.
        </Text>
      </View>
    );
  }

  if (!incoming && !streaming) {
    if (!showWhenIdle) return null;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No active live stream</Text>
        <Text style={styles.hintText}>When the dispatcher requests a live stream for this incident, an in-app prompt will appear.</Text>
      </View>
    );
  }

  if (incoming && !streaming) {
    return (
      <View style={styles.center}>
        {onBack ? <Button title="Back" variant="secondary" onPress={handleBack} /> : null}
        <Text style={styles.title}>Live stream requested</Text>
        <Text style={styles.hintText}>{incoming.incidentTitle ? `Incident: ${incoming.incidentTitle}` : "Incident"}</Text>
        <Text style={styles.hintText}>
          Tap Accept to enable your camera and stream to the dispatcher. You can go back to dismiss.
        </Text>
        <View style={{ width: "100%", marginTop: 14, gap: 10 } as any}>
          <Button title="Accept stream" onPress={() => void acceptRequest()} />
          <Button
            title="Reject"
            variant="danger"
            onPress={() => {
              setIncoming(null);
              socket?.emit("video:reject", { incidentId });
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {onBack ? (
        <View style={styles.topBar}>
          <Button title="Back" variant="secondary" onPress={handleBack} />
          <Text style={styles.topTitle}>Live stream</Text>
          <View style={{ width: 70 }} />
        </View>
      ) : null}
      {streaming && videoHtml ? (
        <WebView
          ref={webRef}
          source={{ html: videoHtml, baseUrl: "https://example.com/" }}
          originWhitelist={["*"]}
          mixedContentMode="always"
          onMessage={onWebMessage}
          onError={() => setError("Video WebView failed to load")}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsProtectedMedia
          {...({ mediaCapturePermissionGrantType: "grant" } as any)}
          style={styles.webview}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.hintText}>Starting camera...</Text>
        </View>
      )}

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={{ flex: 1 }}>
          <Button title={muted ? "Unmute" : "Mute"} variant={muted ? "danger" : "secondary"} onPress={() => toggleMute()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="End call" variant="danger" onPress={() => stopStream()} />
        </View>
      </View>
    </View>
  );
}

function createIncidentVideoStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.black, position: "relative" },
  webview: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  topBar: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topTitle: { color: theme.color.white, fontWeight: "900", fontSize: 13, marginLeft: 8, flex: 1, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: theme.color.black },
  title: { color: theme.color.white, fontWeight: "900", fontSize: 14, marginBottom: 6, textAlign: "center" },
  hintText: { color: theme.color.textMuted, fontWeight: "600", fontSize: 12, textAlign: "center", marginTop: 8 },
  errorText: { color: theme.color.danger, fontWeight: "900", fontSize: 13, textAlign: "center", marginBottom: 6 },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    padding: 10,
    backgroundColor: theme.color.surface,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  });
}

