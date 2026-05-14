import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import { IncidentVideoPanel } from "./IncidentVideoPanel";
import type { ThemeTokens } from "../ui/theme";

type ActiveRequest = { incidentId: string; incidentTitle?: string } | null;

export function VideoRequestOverlay() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createVideoOverlayStyles(theme), [theme]);
  const { socket } = useSocketMobile();
  const [active, setActive] = useState<ActiveRequest>(null);

  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (!socket) return;

    const onRequested = (data: { incidentId: string; incidentTitle?: string }) => {
      if (!data?.incidentId) return;
      setActive({ incidentId: String(data.incidentId), incidentTitle: data.incidentTitle ? String(data.incidentTitle) : undefined });
    };

    const onEnded = (data: { incidentId: string }) => {
      if (!data?.incidentId) return;
      setActive((prev) => {
        if (!prev) return prev;
        if (String(prev.incidentId) !== String(data.incidentId)) return prev;
        return null;
      });
    };

    const onError = (data: { incidentId: string; message?: string }) => {
      if (!data?.incidentId) return;
      setActive((prev) => {
        if (!prev) return prev;
        if (String(prev.incidentId) !== String(data.incidentId)) return prev;
        return null;
      });
    };

    socket.on("video:requested", onRequested);
    socket.on("video:ended", onEnded);
    socket.on("video:error", onError);

    return () => {
      socket.off("video:requested", onRequested);
      socket.off("video:ended", onEnded);
      socket.off("video:error", onError);
    };
  }, [socket]);

  return (
    <Modal visible={!!active} animationType="fade" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        {active ? (
          <IncidentVideoPanel
            incidentId={active.incidentId}
            showWhenIdle={false}
            initialIncoming={active}
            onBack={close}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function createVideoOverlayStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.color.backdropStrong },
  });
}
