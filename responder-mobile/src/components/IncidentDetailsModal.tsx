import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Incident } from "../lib/api";
import { toUiStatus } from "../lib/incidentStatus";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { IncidentChatPanel } from "./IncidentChatPanel";
import { IncidentVideoPanel } from "./IncidentVideoPanel";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";

type IncidentDetailsModalProps = {
  incident: Incident | null;
  visible: boolean;
  onClose: () => void;
  initialTab?: "details" | "chat" | "video";
  hideChat?: boolean;
  hideVideo?: boolean;
};

export function IncidentDetailsModal({
  incident,
  visible,
  onClose,
  initialTab,
  hideChat = false,
  hideVideo = false,
}: IncidentDetailsModalProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createIncidentDetailStyles(theme), [theme]);
  const { user } = useAuthMobile();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = React.useState<"details" | "chat" | "video">("details");

  // Reset tab selection when opening a different incident.
  React.useEffect(() => {
    if (!visible) return;
    const desired = (initialTab ?? "details") as "details" | "chat" | "video";
    if (desired === "chat" && hideChat) setTab("details");
    else if (desired === "video" && hideVideo) setTab("details");
    else setTab(desired);
  }, [incident?.id, initialTab, visible, hideChat, hideVideo]);

  const hasIncident = !!incident;

  const selfReport =
    !!user?.id &&
    hasIncident &&
    String(incident.createdById ?? "") === user.id &&
    String(incident.createdByRole ?? "").toLowerCase() === "responder";
  const pendingDispatchAssignment =
    selfReport &&
    hasIncident &&
    String(incident.status ?? "").toUpperCase() === "NEW" &&
    !incident.assignedResponderId;
  const interactiveIncident =
    hasIncident &&
    !!user?.id &&
    String(incident.assignedResponderId ?? "") === user.id &&
    ["IN_PROGRESS", "EN_ROUTE", "ON_SCENE"].includes(String(incident.status ?? "").toUpperCase());
  const chatLocked = !interactiveIncident;
  const videoLocked = !interactiveIncident;

  return (
    <Modal visible={visible && hasIncident} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 0) + 10 }]}>
            <Text style={styles.title}>Incident Details</Text>
            <Button title="Close" variant="secondary" onPress={onClose} />
          </View>

          <View style={styles.tabRow}>
            <Chip label="Details" selected={tab === "details"} onPress={() => setTab("details")} />
            {hideChat ? null : (
              <View style={chatLocked ? styles.disabledWrap : null}>
                <Chip
                  label="Chat"
                  selected={tab === "chat"}
                  onPress={() => {
                    if (chatLocked) return;
                    setTab("chat");
                  }}
                  disabled={chatLocked as any}
                />
              </View>
            )}
            {hideVideo ? null : (
              <View style={videoLocked ? styles.disabledWrap : null}>
                <Chip
                  label="Video"
                  selected={tab === "video"}
                  onPress={() => {
                    if (videoLocked) return;
                    setTab("video");
                  }}
                  disabled={videoLocked as any}
                />
              </View>
            )}
          </View>

          {hasIncident ? (
            <View style={styles.contentArea}>
              <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 14) + 18 }]}
                style={[styles.pane, { opacity: tab === "details" ? 1 : 0 }]}
                pointerEvents={tab === "details" ? "auto" : "none"}
              >
                <Text style={styles.label}>Title</Text>
                <Text style={styles.value}>{incident.title}</Text>

                <Text style={styles.label}>Description</Text>
                <Text style={styles.value}>{incident.description || "-"}</Text>

                <Text style={styles.label}>Status / Priority</Text>
                <Text style={styles.value}>
                  {toUiStatus(incident.status)} / {incident.priority}
                </Text>
                {pendingDispatchAssignment ? (
                  <Text style={styles.notice}>You filed this report. Awaiting dispatcher acceptance or rejection.</Text>
                ) : null}
                {!pendingDispatchAssignment && (chatLocked || videoLocked) ? (
                  <Text style={styles.notice}>Chat and video are available only after acceptance and assignment.</Text>
                ) : null}

                <Text style={styles.label}>Category</Text>
                <Text style={styles.value}>{incident.category || "-"}</Text>

                <Text style={styles.label}>Location</Text>
                <Text style={styles.value}>{incident.location.address || "-"}</Text>
                <Text style={styles.subtle}>
                  {incident.location.lat}, {incident.location.lon}
                </Text>

                <Text style={styles.label}>Caller phone</Text>
                <Text style={styles.value}>{incident.callerPhone || "-"}</Text>

                <Text style={styles.label}>Created</Text>
                <Text style={styles.value}>{new Date(incident.createdAt).toLocaleString()}</Text>
              </ScrollView>

              <View
                style={[styles.pane, { opacity: tab === "chat" ? 1 : 0 }]}
                pointerEvents={tab === "chat" ? "auto" : "none"}
              >
                {hideChat ? null : (
                  <IncidentChatPanel
                    incidentId={incident.id}
                    onNewMessage={() => {
                      if (!hideChat) setTab("chat");
                    }}
                  />
                )}
              </View>

              <View
                style={[styles.pane, { opacity: tab === "video" ? 1 : 0 }]}
                pointerEvents={tab === "video" ? "auto" : "none"}
              >
                {hideVideo ? null : (
                  <IncidentVideoPanel
                    incidentId={incident.id}
                    showWhenIdle={tab === "video"}
                    onIncomingRequest={() => {
                      if (!hideVideo) setTab("video");
                    }}
                    onBack={() => setTab("details")}
                  />
                )}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function createIncidentDetailStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.color.backdrop, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "92%",
    height: "92%",
    backgroundColor: theme.color.bg,
    flexDirection: "column",
    borderTopLeftRadius: theme.radius.sheetTop,
    borderTopRightRadius: theme.radius.sheetTop,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: theme.color.border,
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: "900", color: theme.color.text, flex: 1 },
  content: { padding: 14, gap: 8 } as any,
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 } as any,
  disabledWrap: { opacity: 0.45 },
  contentArea: {
    flex: 1,
    minHeight: 420,
    position: "relative",
  },
  pane: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  label: { fontSize: 12, color: theme.color.textSubtle, fontWeight: "900", marginTop: 6, letterSpacing: 0.4 },
  value: { fontSize: 14, color: theme.color.text, fontWeight: "700" },
  notice: { fontSize: 13, color: theme.color.success, fontWeight: "800", marginTop: 4 },
  subtle: { fontSize: 12, color: theme.color.textMuted, fontWeight: "700" },
  });
}
