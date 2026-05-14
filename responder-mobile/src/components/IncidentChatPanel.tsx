import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthMobile } from "../contexts/AuthContextMobile";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { api, type ChatMessage } from "../lib/api";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { Button } from "../ui/Button";

type Props = {
  incidentId: string;
  onNewMessage?: (message: ChatMessage) => void;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dedupeById(rows: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of rows) byId.set(m.id, m);
  return Array.from(byId.values());
}

export function IncidentChatPanel({ incidentId, onNewMessage }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createIncidentChatStyles(theme), [theme]);
  const { user } = useAuthMobile();
  const { socket } = useSocketMobile();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  const bubbleMaxWidth = useMemo(() => {
    return 0.82;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);

    api
      .getIncidentMessages(incidentId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(
          rows
            .slice()
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
        );
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          setError("Failed to load chat messages. Check your connection and incident access.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  useEffect(() => {
    if (!socket) return;

    const onNewMessage = (msg: any) => {
      if (!msg || msg.incidentId !== incidentId) return;

      const mapped: ChatMessage = {
        id: String(msg.id),
        incidentId: String(msg.incidentId),
        senderId: String(msg.senderId),
        senderName: String(msg.senderName ?? ""),
        senderRole: msg.senderRole ? String(msg.senderRole) : undefined,
        content: typeof msg.content === "string" ? msg.content : "",
        timestamp: String(msg.timestamp),
        attachmentUrl: msg.attachmentUrl ?? undefined,
        attachmentType: msg.attachmentType ?? undefined,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === mapped.id)) return prev;
        const next = dedupeById([...prev, mapped]).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        onNewMessage?.(mapped);
        return next;
      });
    };

    socket.on("chat:newMessage", onNewMessage);
    return () => {
      socket.off("chat:newMessage", onNewMessage);
    };
  }, [socket, incidentId, onNewMessage]);

  useEffect(() => {
    // Keep the latest message visible.
    if (!messages.length) return;
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [messages.length]);

  const attachAndSend = useCallback(async () => {
    if (sending) return;
    if (!incidentId) return;

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ["image/*", "video/*"],
      });

      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      setSending(true);
      try {
        const upload = await api.uploadFile({
          uri: asset.uri,
          name: asset.name ?? "attachment",
          type: asset.mimeType ?? "application/octet-stream",
        });

        const mime = asset.mimeType ?? "";
        const attachmentType = mime.startsWith("image/")
          ? ("image" as const)
          : mime.startsWith("video/")
            ? ("video" as const)
            : null;

        if (!attachmentType) return;

        const sent = await api.sendIncidentMessage(incidentId, {
          content: text.trim().length ? text.trim() : undefined,
          attachmentUrl: upload.url,
          attachmentType,
        });

        setMessages((prev) =>
          dedupeById([...prev, sent]).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
        );
        setText("");
      } finally {
        setSending(false);
      }
    } catch {
      setSending(false);
    }
  }, [incidentId, sending, text]);

  const sendText = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;

    try {
      setSending(true);
      const sent = await api.sendIncidentMessage(incidentId, { content });
      setMessages((prev) =>
        dedupeById([...prev, sent]).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
      );
      setText("");
    } catch {
      // keep text for retry
    } finally {
      setSending(false);
    }
  }, [incidentId, sending, text]);

  const onPressAttachment = useCallback(() => {
    void attachAndSend();
  }, [attachAndSend]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOwn = user?.id ? String(item.senderId) === String(user.id) : false;
      const hasImage = item.attachmentType === "image" && !!item.attachmentUrl;
      const hasVideo = item.attachmentType === "video" && !!item.attachmentUrl;
      const showContent = !!item.content && item.content !== "[Attachment]";

      return (
        <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, { maxWidth: `${Math.round(bubbleMaxWidth * 100)}%` }]}>
            <Text style={[styles.sender, isOwn ? styles.senderOwn : null]}>{item.senderName}</Text>
            {showContent ? <Text style={[styles.content, isOwn ? styles.contentOwn : null]}>{item.content}</Text> : null}
            {hasImage ? (
              <Image source={{ uri: String(item.attachmentUrl) }} style={styles.image} resizeMode="cover" />
            ) : null}
            {hasVideo ? (
              <TouchableOpacity
                style={styles.videoLink}
                onPress={() => void Linking.openURL(String(item.attachmentUrl))}
              >
                <Text style={styles.videoLinkText}>Open video attachment</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={[styles.time, isOwn ? styles.timeOwn : null]}>{formatTime(item.timestamp)}</Text>
          </View>
        </View>
      );
    },
    [bubbleMaxWidth, user?.id],
  );

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading incident chat...</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text style={styles.emptyText}>No messages yet.</Text>
          </View>
        }
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}>
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={theme.color.textSubtle}
            style={styles.input}
          />
          <View style={styles.composerRow}>
            <View style={{ flex: 1 }}>
              <Button title={sending ? "..." : "Attach"} variant="secondary" onPress={onPressAttachment} disabled={sending} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Send" onPress={() => void sendText()} disabled={!text.trim() || sending} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function createIncidentChatStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  loadingWrap: { paddingTop: 16, alignItems: "center" },
  loadingText: { marginTop: 8, color: theme.color.textMuted, fontWeight: "800" },
  errorText: { color: theme.color.dangerTextSoft, fontWeight: "900", textAlign: "center", paddingHorizontal: 16 },
  row: { flexDirection: "row", marginBottom: 10 },
  rowOwn: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: { borderRadius: 14, padding: 10, borderWidth: 1, borderColor: theme.color.border },
  bubbleOwn: { backgroundColor: theme.color.primarySoft, borderColor: theme.color.primarySoftStrong },
  bubbleOther: { backgroundColor: theme.color.card },
  sender: { fontSize: 11, fontWeight: "900", marginBottom: 4, color: theme.color.textSubtle },
  senderOwn: { color: theme.color.white },
  content: { fontSize: 13, color: theme.color.text, fontWeight: "700" },
  contentOwn: { color: theme.color.white },
  time: { marginTop: 6, fontSize: 10, color: theme.color.textSubtle, fontWeight: "800" },
  timeOwn: { color: theme.color.text },
  image: { width: "100%", height: 170, borderRadius: 10, marginTop: 6 },
  videoLink: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.color.primarySoft, borderWidth: 1, borderColor: theme.color.primarySoftStrong },
  videoLinkText: { fontSize: 12, fontWeight: "900", color: theme.color.primary2 },
  composer: {
    flexDirection: "column",
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  composerRow: { flexDirection: "row", gap: 10 } as any,
  input: {
    minHeight: 38,
    maxHeight: 90,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.cardSolid,
    borderWidth: 1,
    borderColor: theme.color.border,
    color: theme.color.text,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyText: { textAlign: "center", color: theme.color.textMuted, fontWeight: "800" },
  });
}

