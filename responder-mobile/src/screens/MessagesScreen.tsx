import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { api, type DmContact, type DmMessage } from "../lib/api";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { AppHeader } from "../components/AppHeader";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "../ui/Screen";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { useTabBarOverlapReserve } from "../hooks/useTabBarOverlapReserve";

function dedupeMessages(rows: DmMessage[]): DmMessage[] {
  const byId = new Map<string, DmMessage>();
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function guessExtension(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const cleaned = String(c).split("?")[0];
    const match = cleaned.match(/\.([a-zA-Z0-9]{1,6})$/);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function resolveMimeType(
  providedMime: string | null | undefined,
  name: string | null | undefined,
  uri: string | null | undefined,
  kind: "image" | "video" | "document" | undefined,
): string {
  const normalized = String(providedMime ?? "").trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const ext = guessExtension(name, uri);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  if (kind === "image") return "image/jpeg";
  if (kind === "video") return "video/mp4";
  return "application/octet-stream";
}

export function MessagesScreen() {
  const { user } = useAuthMobile();
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [searchText, setSearchText] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "unread">("all");
  const [selected, setSelected] = useState<DmContact | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const { socket } = useSocketMobile();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const tablet = width >= 768;
  const bubbleMaxWidth = tablet ? "70%" : compact ? "92%" : "82%";
  const contentMaxWidth = tablet ? 920 : undefined;
  const sidePad = tablet ? 18 : compact ? 8 : 12;
  const tabBarOverlapReserve = useTabBarOverlapReserve();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createMessagesStyles(theme, { compact, tablet }), [theme, compact, tablet]);

  const loadContacts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const rows = await api.listDmContacts();
      setContacts(rows);
    } catch (e: any) {
      if (!opts?.silent) {
        Alert.alert("Chat error", e?.message ?? "Failed to load contacts.");
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const openContact = useCallback(async (contact: DmContact) => {
    setSelected(contact);
    try {
      const opened = await api.openDmConversation(contact.id);
      setConversationId(opened.conversationId);
      socket?.emit("dm:join", { conversationId: opened.conversationId });
      const history = await api.getDmHistory(opened.conversationId, 100);
      setMessages(dedupeMessages(history));
      for (const m of history) {
        if (m.senderId !== user?.id && !m.readAt) {
          void api.markDmMessageReceipt(m.id, "read");
        }
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.senderId !== user?.id && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m,
        ),
      );
      DeviceEventEmitter.emit("dm:badgeRefresh");
      void loadContacts({ silent: true });
    } catch (e: any) {
      Alert.alert("Chat error", e?.message ?? "Failed to open chat.");
    }
  }, [loadContacts, socket, user?.id]);

  const send = useCallback(async () => {
    const value = text.trim();
    if (!conversationId || !value) return;
    try {
      const sent = await api.sendDmMessage(conversationId, { content: value });
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setText("");
      void loadContacts({ silent: true });
    } catch (e: any) {
      Alert.alert("Send failed", e?.message ?? "Could not send message.");
    }
  }, [conversationId, loadContacts, text]);

  const sendAttachmentAsset = useCallback(
    async (asset: { uri: string; name?: string | null; mimeType?: string | null; kind?: "image" | "video" | "document" }) => {
      if (!conversationId || sendingAttachment) return;
      try {
        setSendingAttachment(true);
        const resolvedMime = resolveMimeType(asset.mimeType, asset.name, asset.uri, asset.kind);
        const guessedType =
          asset.kind ??
          (resolvedMime.startsWith("image/")
            ? "image"
            : resolvedMime.startsWith("video/")
              ? "video"
              : "document");
        const ext = guessExtension(asset.name, asset.uri) ?? (guessedType === "image" ? "jpg" : guessedType === "video" ? "mp4" : "bin");
        const safeName = asset.name && asset.name.trim().length > 0 ? asset.name : `attachment-${Date.now()}.${ext}`;
        const upload = await api.uploadFile({
          uri: asset.uri,
          name: safeName,
          type: resolvedMime,
        });
        const sent = await api.sendDmMessage(conversationId, {
          content: text.trim() || `[Attachment] ${safeName}`.trim(),
          attachmentUrl: upload.url,
          attachmentType: guessedType,
          attachmentName: safeName,
        });
        setMessages((prev) => dedupeMessages([...prev, sent]));
        setText("");
        void loadContacts({ silent: true });
      } catch (e: any) {
        Alert.alert("Attachment failed", e?.message ?? "Could not send attachment.");
      } finally {
        setSendingAttachment(false);
      }
    },
    [conversationId, loadContacts, sendingAttachment, text],
  );

  const attachAndSend = useCallback(async () => {
    if (!conversationId || sendingAttachment) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      await sendAttachmentAsset({
        uri: asset.uri,
        name: asset.name ?? "attachment",
        mimeType: asset.mimeType ?? "application/octet-stream",
        kind:
          String(asset.mimeType ?? "").startsWith("image/")
            ? "image"
            : String(asset.mimeType ?? "").startsWith("video/")
              ? "video"
              : "document",
      });
    } catch (e: any) {
      Alert.alert("Attachment failed", e?.message ?? "Could not send attachment.");
    }
  }, [conversationId, sendAttachmentAsset, sendingAttachment]);

  const captureAndSend = useCallback(async () => {
    if (!conversationId || sendingAttachment) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Please allow camera access to capture and send media.");
      return;
    }
    try {
      const captured = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.8,
      });
      if (captured.canceled || !captured.assets?.[0]) return;
      const asset = captured.assets[0];
      await sendAttachmentAsset({
        uri: asset.uri,
        name: asset.fileName ?? `camera-${Date.now()}`,
        mimeType: asset.mimeType ?? null,
        kind: asset.type === "video" ? "video" : "image",
      });
    } catch (e: any) {
      Alert.alert("Camera failed", e?.message ?? "Could not capture media.");
    }
  }, [conversationId, sendAttachmentAsset, sendingAttachment]);

  useEffect(() => {
    if (!socket) return;

    const onPresence = (p: { userId: string; online: boolean; lastSeen?: string | null }) => {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === p.userId ? { ...c, online: p.online, lastSeen: p.lastSeen ?? c.lastSeen } : c,
        ),
      );
    };

    const onMessage = (payload: DmMessage) => {
      void loadContacts({ silent: true });
      if (payload.conversationId !== conversationId) return;
      if (payload.senderId !== user?.id) {
        void api.markDmMessageReceipt(payload.id, "read");
        DeviceEventEmitter.emit("dm:badgeRefresh");
        setMessages((prev) =>
          dedupeMessages([...prev, { ...payload, readAt: new Date().toISOString() }]),
        );
        return;
      }
      setMessages((prev) => dedupeMessages([...prev, payload]));
    };

    const onTyping = (payload: { conversationId: string; userId?: string; isTyping: boolean }) => {
      if (payload.conversationId !== conversationId) return;
      if (payload.userId && payload.userId === user?.id) return;
      setIsOtherTyping(!!payload.isTyping);
    };

    const onReactionUpdated = (payload: {
      conversationId: string;
      messageId: string;
      reactionCounts: Record<string, number>;
      changedByUserId: string;
      myReaction: string | null;
    }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? {
                ...m,
                reactionCounts: payload.reactionCounts ?? {},
                myReaction: payload.changedByUserId === user?.id ? payload.myReaction : m.myReaction,
              }
            : m,
        ),
      );
    };

    const onMessageDeleted = (payload: { conversationId: string; messageId: string; deletedAt: string }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === payload.messageId ? { ...m, deletedAt: payload.deletedAt } : m)));
    };

    socket.on("user:presence", onPresence);
    socket.on("dm:newMessage", onMessage);
    socket.on("dm:typing", onTyping);
    socket.on("dm:reactionUpdated", onReactionUpdated);
    socket.on("dm:messageDeleted", onMessageDeleted);
    return () => {
      socket.off("user:presence", onPresence);
      socket.off("dm:newMessage", onMessage);
      socket.off("dm:typing", onTyping);
      socket.off("dm:reactionUpdated", onReactionUpdated);
      socket.off("dm:messageDeleted", onMessageDeleted);
    };
  }, [socket, conversationId, user?.id, loadContacts]);

  const title = useMemo(() => {
    if (selected) return `Chat: ${selected.name}`;
    return "Chats";
  }, [selected]);

  const chatUnreadCount = useMemo(
    () => messages.filter((m) => m.senderId !== user?.id && !m.readAt).length,
    [messages, user?.id],
  );

  const { totalMessagesAcrossContacts, totalUnreadAcrossContacts } = useMemo(() => {
    let msgs = 0;
    let unread = 0;
    for (const c of contacts) {
      msgs += Number(c.totalMessageCount ?? 0);
      unread += Number(c.unreadCount ?? 0);
    }
    return { totalMessagesAcrossContacts: msgs, totalUnreadAcrossContacts: unread };
  }, [contacts]);

  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const unreadA = Number(a.unreadCount ?? 0);
        const unreadB = Number(b.unreadCount ?? 0);
        if (unreadA !== unreadB) return unreadB - unreadA;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      }),
    [contacts],
  );

  const filteredContacts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return sortedContacts.filter((c) => {
      if (listFilter === "unread" && Number(c.unreadCount ?? 0) <= 0) return false;
      if (!query) return true;
      return (
        String(c.name ?? "").toLowerCase().includes(query) ||
        String(c.username ?? "").toLowerCase().includes(query) ||
        String(c.role ?? "").toLowerCase().includes(query)
      );
    });
  }, [sortedContacts, searchText, listFilter]);

  const onlineContacts = useMemo(() => filteredContacts.filter((c) => !!c.online), [filteredContacts]);
  const offlineContacts = useMemo(() => filteredContacts.filter((c) => !c.online), [filteredContacts]);

  const listRows = useMemo(() => {
    const rows: Array<
      | { type: "header"; key: string; label: string; count: number }
      | { type: "contact"; key: string; contact: DmContact }
    > = [];
    if (onlineContacts.length > 0) {
      rows.push({ type: "header", key: "online-header", label: "Online users", count: onlineContacts.length });
      rows.push(...onlineContacts.map((contact) => ({ type: "contact" as const, key: `contact-${contact.id}`, contact })));
    }
    if (offlineContacts.length > 0) {
      rows.push({ type: "header", key: "offline-header", label: "Offline users", count: offlineContacts.length });
      rows.push(...offlineContacts.map((contact) => ({ type: "contact" as const, key: `contact-${contact.id}`, contact })));
    }
    return rows;
  }, [offlineContacts, onlineContacts]);

  const mySentInOpenChat = useMemo(
    () => messages.filter((m) => m.senderId === user?.id).length,
    [messages, user?.id],
  );

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    [messages],
  );

  const formatMessageTime = useCallback((value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  const getOwnStatusText = useCallback((m: DmMessage) => {
    if (m.readAt) return "Read";
    if (m.deliveredAt) return "Delivered";
    return "Sent";
  }, []);

  const headerSubtitle = useMemo(() => {
    if (selected) {
      const parts = [
        selected.role,
        selected.online ? "Online" : "Offline",
        `${messages.length} message${messages.length === 1 ? "" : "s"} in this chat`,
        `you sent ${mySentInOpenChat}`,
      ];
      if (chatUnreadCount > 0) {
        parts.push(`${chatUnreadCount} unread`);
      }
      return parts.join(" · ");
    }
    if (loading) {
      return "Direct messages";
    }
    if (contacts.length === 0) {
      return "Direct messages · No contacts";
    }
    const parts = [
      "Direct messages",
      `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`,
      `${totalMessagesAcrossContacts} message${totalMessagesAcrossContacts === 1 ? "" : "s"} total`,
    ];
    if (totalUnreadAcrossContacts > 0) {
      parts.push(`${totalUnreadAcrossContacts} unread`);
    }
    return parts.join(" · ");
  }, [
    chatUnreadCount,
    contacts.length,
    loading,
    messages.length,
    selected,
    totalMessagesAcrossContacts,
    totalUnreadAcrossContacts,
    mySentInOpenChat,
  ]);

  return (
    <Screen style={styles.container} padded>
      <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
      {!selected ? (
        <AppHeader title={title} subtitle={headerSubtitle} />
      ) : (
        <View style={styles.chatTopBar}>
          <TouchableOpacity
            style={styles.chatTopBackBtn}
            onPress={() => {
              setSelected(null);
              setConversationId(null);
              setMessages([]);
              setIsOtherTyping(false);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.chatTopBackText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.chatTopAvatar}>
            <Text style={styles.chatTopAvatarText}>{String(selected.name ?? "?").trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.chatTopTextCol}>
            <Text style={styles.chatTopName} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={styles.chatTopMeta} numberOfLines={1}>
              {selected.online ? "Online" : "Offline"} · {selected.role}
            </Text>
          </View>
        </View>
      )}
      {!selected ? (
        <>
          {loading ? <Text style={styles.status}>Loading contacts...</Text> : null}
          <View style={styles.listControlsWrap}>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search chats"
              style={styles.searchInput}
              placeholderTextColor={theme.color.textSubtle}
            />
            <View style={styles.filterRow}>
              <Chip label="All" selected={listFilter === "all"} onPress={() => setListFilter("all")} />
              <Chip
                label={`Unread${totalUnreadAcrossContacts > 0 ? ` (${totalUnreadAcrossContacts})` : ""}`}
                selected={listFilter === "unread"}
                onPress={() => setListFilter("unread")}
              />
            </View>
          </View>
          <FlatList
            style={styles.listFlex}
            data={listRows}
            keyExtractor={(item) => item.key}
            contentContainerStyle={[styles.contactsListContent, { paddingBottom: tabBarOverlapReserve + 16, paddingHorizontal: sidePad }]}
            renderItem={({ item }) => {
              if (item.type === "header") {
                return (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>
                      {item.label} ({item.count})
                    </Text>
                  </View>
                );
              }
              const c = item.contact;
              const unreadCount = Number(c.unreadCount ?? 0);
              return (
                <TouchableOpacity style={styles.contactRowWrap} onPress={() => openContact(c)} activeOpacity={0.88}>
                  <Card style={styles.contactCard}>
                    <View style={styles.contactRow}>
                      <View style={styles.contactAvatar}>
                        <Text style={styles.contactAvatarText}>
                          {String(c.name ?? "?")
                            .trim()
                            .charAt(0)
                            .toUpperCase()}
                        </Text>
                        <View style={[styles.contactPresenceBadge, c.online ? styles.presenceOn : styles.presenceOff]} />
                      </View>
                      <View style={styles.contactTextCol}>
                        <Text style={styles.contactName} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={styles.contactMeta} numberOfLines={1}>
                          {c.role} · {c.online ? "Online now" : "Last seen recently"} · {Number(c.totalMessageCount ?? 0)} msgs
                        </Text>
                      </View>
                      <View style={styles.contactRightMeta}>
                        <Text style={styles.contactTimeText}>{c.online ? "now" : "today"}</Text>
                        {unreadCount > 0 ? (
                          <View style={styles.unreadBadge}>
                            <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : String(unreadCount)}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            }}
          />
        </>
      ) : (
        <>
          <ImageBackground
            source={{ uri: "https://www.transparenttextures.com/patterns/cream-pixels.png" }}
            resizeMode="repeat"
            style={styles.chatBackground}
            imageStyle={styles.chatBackgroundImage}
          >
            <FlatList
              style={styles.listFlex}
              data={sortedMessages}
              keyExtractor={(item, index) => `${item.id}:${index}`}
              contentContainerStyle={[styles.messagesListContent, { paddingBottom: 16, paddingHorizontal: sidePad }]}
              renderItem={({ item }) => {
                const mine = user?.id === item.senderId;
                return (
                  <TouchableOpacity
                    activeOpacity={0.95}
                    onLongPress={() => {
                      const actions = [
                        { text: "React 👍", onPress: () => void api.reactDmMessage(item.id, "like") },
                        { text: "React ❤️", onPress: () => void api.reactDmMessage(item.id, "love") },
                      ];
                      if (mine) {
                        actions.push({
                          text: "Delete",
                          onPress: () => {
                            Alert.alert("Delete message", "Delete this message?", [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: () => {
                                  void api.deleteDmMessage(item.id).catch((e: any) =>
                                    Alert.alert("Delete failed", e?.message ?? "Could not delete message."),
                                  );
                                },
                              },
                            ]);
                          },
                        });
                      }
                      Alert.alert("Message actions", "Choose action", [
                        ...actions.map((a) => ({ text: a.text, onPress: a.onPress })),
                        { text: "Cancel", style: "cancel" },
                      ]);
                    }}
                    style={[styles.msg, { maxWidth: bubbleMaxWidth }, mine ? styles.msgMine : styles.msgOther]}
                  >
                    {!mine ? <Text style={styles.msgSender}>{item.senderName}</Text> : null}
                    {item.deletedAt ? (
                      <Text style={styles.deletedText}>Message deleted</Text>
                    ) : (
                      <Text style={styles.msgText}>{item.content}</Text>
                    )}
                    {!item.deletedAt && item.attachmentUrl ? (
                      <Text
                        style={styles.attachmentText}
                        onPress={() => {
                          if (item.attachmentUrl) void Linking.openURL(item.attachmentUrl);
                        }}
                      >
                        Attachment: {item.attachmentName ?? item.attachmentType ?? "file"}
                      </Text>
                    ) : null}
                    <View style={styles.msgMetaRow}>
                      <Text style={styles.msgMetaText}>{formatMessageTime(item.createdAt)}</Text>
                      {mine ? <Text style={styles.msgMetaText}>{getOwnStatusText(item)}</Text> : null}
                    </View>
                    {!item.deletedAt && item.reactionCounts && Object.keys(item.reactionCounts).length > 0 ? (
                      <Text style={styles.reactionText}>
                        {Object.entries(item.reactionCounts)
                          .filter(([, count]) => Number(count) > 0)
                          .map(([reaction, count]) => `${reaction} ${count}`)
                          .join("  ")}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          </ImageBackground>
          {isOtherTyping ? <Text style={styles.typingText}>{selected?.name ?? "User"} is typing...</Text> : null}
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.composer, { paddingBottom: 12 + tabBarOverlapReserve, paddingHorizontal: sidePad + 4 }]}>
              <TouchableOpacity
                style={[styles.composerIconBtn, sendingAttachment ? styles.composerIconBtnDisabled : null]}
                onPress={attachAndSend}
                activeOpacity={0.85}
                disabled={sendingAttachment}
              >
                <Text style={styles.composerIconText}>{sendingAttachment ? "…" : "+"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.composerIconBtn} activeOpacity={0.85} onPress={() => void captureAndSend()}>
                <Text style={styles.composerIconText}>📷</Text>
              </TouchableOpacity>
              <TextInput
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  if (!conversationId || !socket) return;
                  socket.emit("dm:typing", { conversationId, isTyping: value.trim().length > 0 });
                }}
                style={styles.input}
                placeholder="Type message..."
                placeholderTextColor={theme.color.textSubtle}
              />
              <TouchableOpacity
                style={[styles.sendBtn, !text.trim() ? styles.sendBtnDisabled : null]}
                onPress={send}
                activeOpacity={0.88}
                disabled={!text.trim()}
              >
                <Text style={styles.sendBtnText}>➤</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </>
      )}
      </View>
    </Screen>
  );
}

function createMessagesStyles(theme: ThemeTokens, ui: { compact: boolean; tablet: boolean }) {
  return StyleSheet.create({
  container: { flex: 1, paddingTop: 0, backgroundColor: theme.color.screenMuted },
  contentWrap: { flex: 1, width: "100%", alignSelf: "center" },
  listFlex: { flex: 1 },
  chatTopBar: {
    minHeight: ui.tablet ? 74 : ui.compact ? 58 : 64,
    paddingHorizontal: ui.tablet ? 14 : 10,
    paddingVertical: ui.tablet ? 10 : 8,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lightBorderStrong,
    backgroundColor: theme.color.lightSurface,
  },
  chatTopBackBtn: { width: ui.tablet ? 40 : 34, alignItems: "center", justifyContent: "center" },
  chatTopBackText: { fontSize: ui.tablet ? 38 : ui.compact ? 30 : 34, lineHeight: ui.tablet ? 38 : ui.compact ? 30 : 34, color: theme.color.lightText, marginTop: -2 },
  chatTopAvatar: {
    width: ui.tablet ? 40 : 34,
    height: ui.tablet ? 40 : 34,
    borderRadius: ui.tablet ? 20 : 17,
    backgroundColor: theme.color.cardSolid,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  chatTopAvatarText: { color: theme.color.lightText, fontWeight: "900", fontSize: ui.tablet ? 16 : 14 },
  chatTopTextCol: { flex: 1, minWidth: 0 },
  chatTopName: { color: theme.color.lightText, fontWeight: "900", fontSize: ui.tablet ? 18 : 16 },
  chatTopMeta: { color: theme.color.lightTextSubtle, fontSize: ui.tablet ? 12 : 11, marginTop: 1, fontWeight: "700" },
  status: { textAlign: "center", color: theme.color.lightTextMuted, marginTop: 14, fontWeight: "700" },
  sectionHeader: {
    paddingHorizontal: 4,
    paddingVertical: 7,
  },
  sectionHeaderText: {
    fontSize: 12,
    color: theme.color.lightTextMuted,
    fontWeight: "900",
  },
  contactsListContent: { paddingBottom: 12 },
  contactRowWrap: { marginBottom: 8 },
  contactCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: theme.color.lightSurface,
    borderColor: theme.color.lightBorderStrong,
    shadowOpacity: 0,
    elevation: 0,
  },
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  contactAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.color.cardSolid,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  contactAvatarText: { color: theme.color.lightText, fontWeight: "900", fontSize: 15 },
  contactPresenceBadge: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.color.lightSurface,
  },
  contactTextCol: { flex: 1, minWidth: 0 },
  contactRightMeta: { alignItems: "flex-end", gap: 6 },
  contactTimeText: { color: theme.color.lightTextSubtle, fontSize: 10, fontWeight: "700" },
  contactName: { fontWeight: "900", color: theme.color.lightText, fontSize: 14 },
  presenceOn: { backgroundColor: theme.color.success },
  presenceOff: { backgroundColor: theme.color.lightBorderStrong },
  unreadBadge: {
    minWidth: 22,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.success,
  },
  unreadBadgeText: { color: theme.color.white, fontSize: 10, fontWeight: "700" },
  contactMeta: { color: theme.color.lightTextMuted, fontSize: 12, fontWeight: "700", marginTop: 6 },
  listControlsWrap: { gap: 8, marginBottom: 10 },
  searchInput: {
    borderWidth: 1,
    borderColor: theme.color.lightBorderStrong,
    borderRadius: 14,
    backgroundColor: theme.color.lightSurface,
    paddingHorizontal: 12,
    paddingVertical: ui.tablet ? 12 : 10,
    fontSize: ui.tablet ? 15 : 14,
    color: theme.color.lightText,
    fontWeight: "700",
  },
  filterRow: { flexDirection: "row", gap: 8 },
  chatBackground: { flex: 1 },
  chatBackgroundImage: { opacity: 0.2 },
  messagesListContent: { paddingTop: 8, paddingBottom: 10 },
  msg: { borderRadius: ui.tablet ? 16 : 14, padding: ui.tablet ? 12 : 10, marginBottom: 8, borderWidth: 1, borderColor: theme.color.lightBorderStrong },
  msgMine: {
    alignSelf: "flex-end",
    backgroundColor: "#dcf8c6",
    borderColor: "#b7e0aa",
    borderTopRightRadius: 6,
  },
  msgOther: { alignSelf: "flex-start", backgroundColor: theme.color.lightSurface, borderTopLeftRadius: 6 },
  msgSender: { fontSize: 11, color: theme.color.lightTextSubtle, marginBottom: 2, fontWeight: "800" },
  msgText: { color: theme.color.lightText, fontWeight: "700", fontSize: ui.tablet ? 15 : 14 },
  deletedText: { color: theme.color.lightTextMuted, fontSize: 12, fontStyle: "italic" },
  attachmentText: { color: theme.color.lightPrimary, marginTop: 6, fontSize: 12, fontWeight: "800" },
  msgMetaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  msgMetaText: { color: theme.color.lightTextSubtle, fontSize: 10, fontWeight: "800" },
  reactionText: { color: theme.color.lightTextMuted, marginTop: 4, fontSize: 11, fontWeight: "900" },
  typingText: { color: theme.color.lightTextMuted, marginBottom: 8, marginLeft: 2, fontSize: 12, fontWeight: "800" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 0,
    backgroundColor: theme.color.lightSurface,
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: theme.color.lightBorderStrong,
  },
  composerIconBtn: {
    width: ui.tablet ? 44 : 38,
    height: ui.tablet ? 44 : 38,
    borderRadius: ui.tablet ? 22 : 19,
    borderWidth: 1,
    borderColor: theme.color.lightBorderStrong,
    backgroundColor: theme.color.cardSolid,
    alignItems: "center",
    justifyContent: "center",
  },
  composerIconBtnDisabled: { opacity: 0.6 },
  composerIconText: { color: theme.color.lightTextMuted, fontSize: ui.tablet ? 24 : 22, lineHeight: ui.tablet ? 26 : 24, fontWeight: "700" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.lightBorderStrong,
    borderRadius: ui.tablet ? 24 : 22,
    paddingHorizontal: 12,
    paddingVertical: ui.tablet ? 12 : 10,
    color: theme.color.lightText,
    fontWeight: "700",
    backgroundColor: theme.color.lightSurface,
  },
  sendBtn: {
    width: ui.tablet ? 44 : 38,
    height: ui.tablet ? 44 : 38,
    borderRadius: ui.tablet ? 22 : 19,
    backgroundColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: theme.color.white, fontWeight: "800", fontSize: ui.tablet ? 16 : 14 },
  });
}
