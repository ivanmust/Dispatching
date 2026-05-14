import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

// Color tokens chosen to match responder-mobile/src/ui/theme.ts
const COLORS = {
  lightBg: '#ffffff',
  lightSurface: '#ffffff',
  lightBorderStrong: 'rgba(15,23,42,0.22)',
  lightText: '#0f172a',
  lightTextMuted: '#334155',
  lightTextSubtle: '#64748b',
  cardSolid: '#f1f5f9',
  success: '#22c55e',
  primarySoft: 'rgba(29,79,158,0.1)',
  primarySoftStrong: 'rgba(29,79,158,0.38)',
  border: '#d1d5db',
  textMuted: '#64748b',
  text: '#0f172a',
  bubbleMineBg: '#dcf8c6',
  bubbleMineBorder: '#b7e0aa',
} as const;

type Contact = {
  id: string;
  username: string;
  name: string;
  role: string;
  callsign?: string | null;
  unit?: string | null;
  phone?: string | null;
  isActive: boolean;
  online?: boolean;
  lastSeen?: string | null;
  unreadCount?: number;
  totalMessageCount?: number;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  lastMessageFromMe?: boolean;
};

export type DirectMessageSelectedUser = {
  id: string;
  name: string;
  role: string;
  username: string;
} | null;

interface DirectMessagePanelProps {
  onSelectedUserChange?: (user: DirectMessageSelectedUser) => void;
}

type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  priority: 'normal' | 'urgent' | 'emergency';
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  forwardedFromMessageId?: string | null;
  myReaction?: string | null;
  reactionCounts?: Record<string, number> | null;
  attachmentUrl?: string | null;
  attachmentType?: 'image' | 'video' | 'document' | null;
  attachmentName?: string | null;
};

function initialOf(name: string): string {
  return (
    String(name ?? '?')
      .trim()
      .charAt(0)
      .toUpperCase() || '?'
  );
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: selected ? COLORS.primarySoftStrong : COLORS.border,
        backgroundColor: selected ? COLORS.primarySoft : COLORS.lightSurface,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 999,
        color: selected ? COLORS.text : COLORS.textMuted,
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function Avatar({
  name,
  online,
  size = 46,
  showPresence = true,
}: {
  name: string;
  online?: boolean;
  size?: number;
  showPresence?: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: COLORS.cardSolid,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: COLORS.lightText,
          fontWeight: 900,
          fontSize: Math.round(size * 0.34),
          lineHeight: 1,
        }}
      >
        {initialOf(name)}
      </span>
      {showPresence && typeof online === 'boolean' ? (
        <span
          style={{
            position: 'absolute',
            right: 1,
            bottom: 1,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderStyle: 'solid',
            borderColor: COLORS.lightSurface,
            backgroundColor: online ? COLORS.success : COLORS.lightBorderStrong,
          }}
        />
      ) : null}
    </div>
  );
}

export function DirectMessagePanel({ onSelectedUserChange }: DirectMessagePanelProps) {
  const queryClient = useQueryClient();
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'unread'>('all');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const PAGE_SIZE = 20;
  const [beforeCursor, setBeforeCursor] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string;
    type: 'image' | 'video' | 'document';
    name: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

  const generateClientMessageId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `cm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  type OutboxItem = {
    conversationId: string;
    clientMessageId: string;
    content: string;
    priority: 'normal' | 'urgent' | 'emergency';
    attachmentUrl?: string | null;
    attachmentType?: 'image' | 'video' | 'document' | null;
    attachmentName?: string | null;
    attachmentMimeType?: string | null;
    attempts: number;
    nextAttemptAt: number;
  };

  const [sendQueue, setSendQueue] = useState<OutboxItem[]>([]);
  const sendQueueRef = useRef<OutboxItem[]>([]);
  const sendQueueInFlightRef = useRef(false);
  const MAX_SEND_ATTEMPTS = 10;

  useEffect(() => {
    onSelectedUserChange?.(
      selectedContact
        ? {
            id: selectedContact.id,
            name: selectedContact.name,
            role: selectedContact.role,
            username: selectedContact.username,
          }
        : null,
    );
  }, [onSelectedUserChange, selectedContact]);

  useEffect(() => {
    sendQueueRef.current = sendQueue;
  }, [sendQueue]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !conversationId) return;
      socket.emit('dm:typing', { conversationId, isTyping });
    },
    [socket, conversationId],
  );

  const triggerTyping = useCallback(() => {
    emitTyping(true);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      emitTyping(false);
      setTypingUserId(null);
    }, 1500);
  }, [emitTyping]);

  const {
    data: contacts = [],
    isLoading: contactsLoading,
    isError: contactsError,
    refetch: refetchContacts,
  } = useQuery<Contact[]>({
    queryKey: ['dm-contacts', search],
    queryFn: () => api.listDmContacts({ q: search || undefined }),
    staleTime: 5000,
  });

  const {
    data: history = [],
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery<DmMessage[]>({
    queryKey: ['dm-history', conversationId],
    queryFn: () => {
      if (!conversationId) return Promise.resolve([]);
      return api.getDmHistory(conversationId, { limit: PAGE_SIZE });
    },
    enabled: !!conversationId,
    staleTime: 1000,
  });

  useEffect(() => {
    if (!socket || !conversationId) return;
    socket.emit('dm:join', { conversationId });
    const handler = (msg: DmMessage) => {
      if (msg.conversationId !== conversationId) return;
      const now = new Date().toISOString();
      const enriched: DmMessage = {
        ...msg,
        deliveredAt: msg.deliveredAt ?? now,
        readAt: msg.readAt ?? (msg.senderId === user?.id ? now : null),
      };
      queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) => {
        if (prev.some((m) => m.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
    };
    socket.on('dm:newMessage', handler);

    const reactionUpdatedHandler = (p: {
      conversationId: string;
      messageId: string;
      changedByUserId: string;
      myReaction: string | null;
      reactionCounts: Record<string, number>;
    }) => {
      if (p.conversationId !== conversationId) return;
      queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) =>
        prev.map((m) =>
          m.id === p.messageId
            ? {
                ...m,
                reactionCounts: p.reactionCounts ?? {},
                myReaction: p.changedByUserId === user?.id ? p.myReaction : m.myReaction,
              }
            : m,
        ),
      );
    };

    const messageEditedHandler = (p: {
      conversationId: string;
      messageId: string;
      content: string;
      editedAt: string;
      deletedAt: string | null;
    }) => {
      if (p.conversationId !== conversationId) return;
      queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) =>
        prev.map((m) =>
          m.id === p.messageId
            ? {
                ...m,
                content: p.content,
                editedAt: p.editedAt,
                deletedAt: p.deletedAt,
              }
            : m,
        ),
      );
    };

    const messageDeletedHandler = (p: { conversationId: string; messageId: string; deletedAt: string }) => {
      if (p.conversationId !== conversationId) return;
      queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) =>
        prev.map((m) => (m.id === p.messageId ? { ...m, deletedAt: p.deletedAt } : m)),
      );
    };

    socket.on('dm:reactionUpdated', reactionUpdatedHandler);
    socket.on('dm:messageEdited', messageEditedHandler);
    socket.on('dm:messageDeleted', messageDeletedHandler);
    return () => {
      emitTyping(false);
      setTypingUserId(null);
      socket.emit('dm:leave', { conversationId });
      socket.off('dm:newMessage', handler);
      socket.off('dm:reactionUpdated', reactionUpdatedHandler);
      socket.off('dm:messageEdited', messageEditedHandler);
      socket.off('dm:messageDeleted', messageDeletedHandler);
    };
  }, [socket, conversationId, queryClient, user?.id, emitTyping]);

  useEffect(() => {
    setBeforeCursor(null);
    setHasMoreHistory(true);
    setSendQueue([]);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const key = `dm-outbox:${conversationId}`;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
      setSendQueue(parsed);
    } catch {
      setSendQueue([]);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const key = `dm-outbox:${conversationId}`;
    try {
      localStorage.setItem(key, JSON.stringify(sendQueue));
    } catch {
      // best-effort persistence
    }
  }, [sendQueue, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    if (history.length === 0) {
      setBeforeCursor(null);
      setHasMoreHistory(false);
      return;
    }
    setBeforeCursor(history[0]?.createdAt ?? null);
    setHasMoreHistory(history.length === PAGE_SIZE);
  }, [conversationId, history.length]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId) return;
    if (!hasMoreHistory || loadingOlder) return;
    if (!beforeCursor) return;

    const el = messagesScrollRef.current;
    const prevScrollTop = el?.scrollTop ?? 0;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    setLoadingOlder(true);
    try {
      const older = await api.getDmHistory(conversationId, { limit: PAGE_SIZE, before: beforeCursor });
      if (!older.length) {
        setHasMoreHistory(false);
        setBeforeCursor(null);
        return;
      }

      queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) => {
        const merged = [...older, ...prev];
        const byId = new Map<string, DmMessage>();
        merged.forEach((m) => byId.set(m.id, m));
        return Array.from(byId.values());
      });

      setBeforeCursor(older[0]?.createdAt ?? null);
      if (older.length < PAGE_SIZE) setHasMoreHistory(false);

      requestAnimationFrame(() => {
        const nextEl = messagesScrollRef.current;
        if (!nextEl) return;
        const nextScrollHeight = nextEl.scrollHeight;
        nextEl.scrollTop = prevScrollTop + (nextScrollHeight - prevScrollHeight);
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMoreHistory, loadingOlder, beforeCursor, queryClient]);

  useEffect(() => {
    if (!conversationId) return;
    if (sendQueue.length === 0) return;

    const interval = window.setInterval(async () => {
      if (sendQueueInFlightRef.current) return;
      if (!navigator.onLine) return;

      const nowTs = Date.now();
      const due = sendQueueRef.current
        .filter((i) => i.nextAttemptAt <= nowTs)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
      if (!due) return;

      sendQueueInFlightRef.current = true;
      try {
        const msg = await api.sendDmMessage(due.conversationId, {
          content: due.content,
          priority: due.priority,
          attachmentUrl: due.attachmentUrl ?? null,
          attachmentType: due.attachmentType ?? null,
          attachmentName: due.attachmentName ?? null,
          attachmentMimeType: due.attachmentMimeType ?? null,
          clientMessageId: due.clientMessageId,
        });

        if (msg) {
          const now = new Date().toISOString();
          const enriched: DmMessage = {
            ...msg,
            deliveredAt: msg.deliveredAt ?? now,
            readAt: msg.readAt ?? (msg.senderId === user?.id ? now : null),
          };
          queryClient.setQueryData<DmMessage[]>(['dm-history', msg.conversationId], (prev = []) => {
            if (prev.some((m) => m.id === enriched.id)) return prev;
            return [...prev, enriched];
          });
        }

        setSendQueue((prev) => prev.filter((i) => i.clientMessageId !== due.clientMessageId));
      } catch {
        const nextAttempts = due.attempts + 1;
        if (nextAttempts >= MAX_SEND_ATTEMPTS) {
          setSendQueue((prev) => prev.filter((i) => i.clientMessageId !== due.clientMessageId));
          toast({
            title: 'Message failed to send',
            description: 'Please try again.',
            variant: 'destructive',
          });
        } else {
          const backoffMs = Math.min(30000, 1000 * Math.pow(2, nextAttempts));
          setSendQueue((prev) =>
            prev.map((i) =>
              i.clientMessageId === due.clientMessageId
                ? {
                    ...i,
                    attempts: nextAttempts,
                    nextAttemptAt: Date.now() + backoffMs,
                  }
                : i,
            ),
          );
        }
      } finally {
        sendQueueInFlightRef.current = false;
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [conversationId, sendQueue.length, queryClient, user?.id]);

  useEffect(() => {
    if (!socket || !conversationId || !user?.id) return;
    const handler = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversationId) return;
      if (data.userId === user.id) return;
      setTypingUserId(data.isTyping ? data.userId : null);
    };
    socket.on('dm:typing', handler);
    return () => {
      socket.off('dm:typing', handler);
    };
  }, [socket, conversationId, user?.id]);

  useEffect(() => {
    if (!socket) return;
    const handler = (p: { userId: string; online: boolean; lastSeen?: string | null }) => {
      queryClient.setQueriesData<Contact[]>({ queryKey: ['dm-contacts'] }, (prev) => {
        if (!prev) return prev;
        return prev.map((c) =>
          c.id === p.userId
            ? {
                ...c,
                online: p.online,
                lastSeen: p.lastSeen ?? c.lastSeen,
              }
            : c,
        );
      });
    };
    socket.on('user:presence', handler);
    return () => {
      socket.off('user:presence', handler);
    };
  }, [socket, queryClient]);

  const openConversation = useMutation({
    mutationFn: async (contact: Contact) => {
      const res = await api.openDmConversation(contact.id);
      return { conversationId: res.conversationId, contact };
    },
    onSuccess: ({ conversationId: cid, contact }) => {
      setSelectedContact(contact);
      setConversationId(cid);
      queryClient.invalidateQueries({ queryKey: ['dm-history', cid] });
    },
  });

  const sendMessage = useMutation({
    mutationFn: async (vars: Omit<OutboxItem, 'attempts' | 'nextAttemptAt'>) => {
      return api.sendDmMessage(vars.conversationId, {
        content: vars.content,
        priority: vars.priority,
        attachmentUrl: vars.attachmentUrl ?? null,
        attachmentType: vars.attachmentType ?? null,
        attachmentName: vars.attachmentName ?? null,
        attachmentMimeType: vars.attachmentMimeType ?? null,
        clientMessageId: vars.clientMessageId,
      });
    },
    onSuccess: (msg) => {
      if (!msg) return;
      const now = new Date().toISOString();
      const enriched: DmMessage = {
        ...msg,
        deliveredAt: msg.deliveredAt ?? now,
        readAt: msg.readAt ?? (msg.senderId === user?.id ? now : null),
      };
      queryClient.setQueryData<DmMessage[]>(['dm-history', msg.conversationId], (prev = []) => {
        if (prev.some((m) => m.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
    },
    onError: (_err, vars) => {
      setSendQueue((prev) => {
        if (prev.some((i) => i.clientMessageId === vars.clientMessageId)) return prev;
        return [
          ...prev,
          {
            ...vars,
            attempts: 0,
            nextAttemptAt: Date.now() + 1000,
          },
        ];
      });
      toast({
        title: 'Message queued',
        description: "We'll retry sending when your connection is back.",
      });
    },
  });

  const sortedMessages = useMemo(
    () => [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [history],
  );

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (listFilter === 'unread' && Number(c.unreadCount ?? 0) <= 0) return false;
      if (!query) return true;
      return (
        String(c.name ?? '').toLowerCase().includes(query) ||
        String(c.username ?? '').toLowerCase().includes(query) ||
        String(c.role ?? '').toLowerCase().includes(query)
      );
    });
  }, [contacts, listFilter, search]);

  const sortedContacts = useMemo(() => {
    return [...filteredContacts].sort((a, b) => {
      const unreadA = a.unreadCount ?? 0;
      const unreadB = b.unreadCount ?? 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredContacts]);

  const onlineContacts = useMemo(() => sortedContacts.filter((c) => !!c.online), [sortedContacts]);
  const offlineContacts = useMemo(() => sortedContacts.filter((c) => !c.online), [sortedContacts]);

  const totalUnread = useMemo(
    () => contacts.reduce((sum, c) => sum + Number(c.unreadCount ?? 0), 0),
    [contacts],
  );

  const prevHistoryLenRef = useRef(0);
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || !conversationId) return;
    if (loadingOlder) return;
    if (history.length > prevHistoryLenRef.current || prevHistoryLenRef.current === 0) {
      el.scrollTop = el.scrollHeight;
    }
    prevHistoryLenRef.current = history.length;
  }, [history.length, conversationId, loadingOlder]);

  useEffect(() => {
    if (!conversationId || !user?.id || history.length === 0) return;
    const unreadInbound = history.filter((m) => m.senderId !== user.id && !m.readAt);
    if (unreadInbound.length === 0) return;

    unreadInbound.forEach((m) => {
      api.markDmMessageReceipt(m.id, 'read').catch(() => {
        // best-effort; ignore failure here
      });
    });

    queryClient.setQueryData<DmMessage[]>(['dm-history', conversationId], (prev = []) =>
      prev.map((m) =>
        m.senderId !== user.id && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m,
      ),
    );
    queryClient.invalidateQueries({ queryKey: ['dm-contacts'] });
  }, [conversationId, history, user?.id, queryClient]);

  const handleSelectContact = (contact: Contact) => {
    openConversation.mutate(contact);
  };

  const handleBackToUserList = () => {
    emitTyping(false);
    setTypingUserId(null);
    setSelectedContact(null);
    setConversationId(null);
    setMessageText('');
    setPendingAttachment(null);
    setSendQueue([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversationId || (!messageText.trim() && !pendingAttachment)) return;
    emitTyping(false);
    setTypingUserId(null);

    const text = messageText.trim();
    const contentToSend = text || (pendingAttachment ? '[Attachment]' : '');
    const clientMessageId = generateClientMessageId();

    setMessageText('');
    setPendingAttachment(null);

    sendMessage.mutate({
      conversationId,
      clientMessageId,
      content: contentToSend,
      priority: 'normal',
      attachmentUrl: pendingAttachment?.url ?? null,
      attachmentType: pendingAttachment?.type ?? null,
      attachmentName: pendingAttachment?.name ?? null,
      attachmentMimeType: null,
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: 'File too large', description: 'Max 50 MB.', variant: 'destructive' });
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const type: 'image' | 'video' | 'document' = isImage ? 'image' : isVideo ? 'video' : 'document';

    setUploading(true);
    try {
      const { url } = await api.uploadFile(file);
      setPendingAttachment({ url, type, name: file.name });
    } catch {
      toast({ title: 'Upload failed', description: 'Could not upload attachment.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = async (m: DmMessage) => {
    if (m.deletedAt) return;
    if (m.attachmentUrl) {
      toast({
        title: 'Edit not supported',
        description: "Messages with attachments can't be edited yet.",
        variant: 'destructive',
      });
      return;
    }
    const next = window.prompt('Edit message', m.content);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try {
      await api.editDmMessage(m.id, trimmed);
    } catch {
      toast({ title: 'Edit failed', description: 'Could not update message.', variant: 'destructive' });
    }
  };

  const handleDelete = async (m: DmMessage) => {
    if (m.deletedAt) return;
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.deleteDmMessage(m.id);
    } catch {
      toast({ title: 'Delete failed', description: 'Could not delete message.', variant: 'destructive' });
    }
  };

  const handleForward = async (m: DmMessage) => {
    if (m.deletedAt || !conversationId) return;
    try {
      await api.forwardDmMessage(conversationId, m.id);
    } catch {
      toast({ title: 'Forward failed', description: 'Could not forward message.', variant: 'destructive' });
    }
  };

  const formatMessageTime = (value?: string | null) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getOwnStatusText = (m: DmMessage) => {
    if (m.readAt) return 'Read';
    if (m.deliveredAt) return 'Delivered';
    return 'Sent';
  };

  const renderContactRow = (c: Contact) => {
    const unreadCount = Number(c.unreadCount ?? 0);
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => handleSelectContact(c)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          marginBottom: 8,
          padding: '8px 10px',
          borderRadius: 14,
          backgroundColor: COLORS.lightSurface,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: COLORS.lightBorderStrong,
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <div style={{ marginRight: 10 }}>
              <Avatar name={c.name} online={c.online} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 900,
                  color: COLORS.lightText,
                  fontSize: 14,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.name}
              </div>
              <div
                style={{
                  color: COLORS.lightTextMuted,
                  fontSize: 12,
                  fontWeight: 700,
                  marginTop: 6,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.role} · {c.online ? 'Online now' : 'Last seen recently'} ·{' '}
                {Number(c.totalMessageCount ?? 0)} msgs
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginLeft: 10 }}>
            <span style={{ color: COLORS.lightTextSubtle, fontSize: 10, fontWeight: 700 }}>
              {c.online ? 'now' : 'today'}
            </span>
            {unreadCount > 0 ? (
              <span
                style={{
                  minWidth: 22,
                  height: 18,
                  borderRadius: 9,
                  padding: '0 6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: COLORS.success,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    );
  };

  const selectedOnline = selectedContact
    ? contacts.find((c) => c.id === selectedContact.id)?.online ?? false
    : false;

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        flexDirection: 'column',
        backgroundColor: COLORS.lightBg,
      }}
    >
      {!selectedContact ? (
        <>
          <div style={{ gap: 8, marginBottom: 10, display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              style={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: COLORS.lightBorderStrong,
                borderRadius: 14,
                backgroundColor: COLORS.lightSurface,
                padding: '10px 12px',
                fontSize: 14,
                color: COLORS.lightText,
                fontWeight: 700,
                outline: 'none',
                width: '100%',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
              <Chip label="All" selected={listFilter === 'all'} onClick={() => setListFilter('all')} />
              <Chip
                label={`Unread${totalUnread > 0 ? ` (${totalUnread})` : ''}`}
                selected={listFilter === 'unread'}
                onClick={() => setListFilter('unread')}
              />
            </div>
            {!connected && (
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid #fde68a',
                  backgroundColor: '#fffbeb',
                  padding: '6px 10px',
                  fontSize: 12,
                  color: '#b45309',
                  fontWeight: 700,
                }}
              >
                You are offline. User presence may be outdated.
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
            {contactsLoading ? (
              <div
                style={{
                  textAlign: 'center',
                  color: COLORS.lightTextMuted,
                  marginTop: 14,
                  fontWeight: 700,
                }}
              >
                Loading contacts...
              </div>
            ) : contactsError ? (
              <div style={{ textAlign: 'center', marginTop: 14, fontWeight: 700, color: COLORS.lightTextMuted }}>
                <p>Could not load users.</p>
                <button
                  type="button"
                  onClick={() => refetchContacts()}
                  style={{
                    marginTop: 8,
                    padding: '6px 12px',
                    borderRadius: 10,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.lightSurface,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            ) : sortedContacts.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: COLORS.lightTextMuted,
                  marginTop: 14,
                  fontWeight: 700,
                }}
              >
                No users found
              </div>
            ) : (
              <>
                {onlineContacts.length > 0 && (
                  <>
                    <div style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 7, paddingBottom: 7 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: COLORS.lightTextMuted,
                          fontWeight: 900,
                        }}
                      >
                        Online users ({onlineContacts.length})
                      </span>
                    </div>
                    {onlineContacts.map(renderContactRow)}
                  </>
                )}
                {offlineContacts.length > 0 && (
                  <>
                    <div style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 7, paddingBottom: 7 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: COLORS.lightTextMuted,
                          fontWeight: 900,
                        }}
                      >
                        Offline users ({offlineContacts.length})
                      </span>
                    </div>
                    {offlineContacts.map(renderContactRow)}
                  </>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              minHeight: 64,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              borderBottomWidth: 1,
              borderBottomStyle: 'solid',
              borderBottomColor: COLORS.lightBorderStrong,
              backgroundColor: COLORS.lightSurface,
              marginLeft: -16,
              marginRight: -16,
            }}
          >
            <button
              type="button"
              onClick={handleBackToUserList}
              style={{
                width: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
              aria-label="Back"
            >
              <span
                style={{
                  fontSize: 34,
                  lineHeight: '34px',
                  color: COLORS.lightText,
                  marginTop: -2,
                  fontWeight: 400,
                }}
              >
                ‹
              </span>
            </button>
            <div style={{ marginRight: 8 }}>
              <Avatar name={selectedContact.name} size={34} showPresence={false} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: COLORS.lightText,
                  fontWeight: 900,
                  fontSize: 16,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedContact.name}
              </div>
              <div
                style={{
                  color: COLORS.lightTextSubtle,
                  fontSize: 11,
                  marginTop: 1,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedOnline ? 'Online' : 'Offline'} · {selectedContact.role}
              </div>
            </div>
          </div>

          <div
            ref={messagesScrollRef}
            onScroll={() => {
              const el = messagesScrollRef.current;
              if (!el) return;
              if (el.scrollTop < 40 && !historyLoading) void loadOlderMessages();
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 0 10px 0',
              marginLeft: -16,
              marginRight: -16,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundImage:
                'url("https://www.transparenttextures.com/patterns/cream-pixels.png")',
              backgroundRepeat: 'repeat',
              backgroundColor: '#fefefe',
            }}
          >
            {loadingOlder && (
              <div style={{ textAlign: 'center', color: COLORS.lightTextMuted, fontSize: 12, padding: 8 }}>
                Loading older…
              </div>
            )}
            {historyLoading && conversationId ? (
              <div style={{ textAlign: 'center', color: COLORS.lightTextMuted, fontSize: 12, padding: 12 }}>
                Loading messages…
              </div>
            ) : historyError ? (
              <div style={{ textAlign: 'center', color: COLORS.lightTextMuted, fontSize: 12, padding: 12 }}>
                <p>Could not load messages.</p>
                <button
                  type="button"
                  onClick={() => refetchHistory()}
                  style={{
                    marginTop: 8,
                    padding: '6px 12px',
                    borderRadius: 10,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.lightSurface,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            ) : sortedMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: COLORS.lightTextMuted, fontSize: 12, padding: 12 }}>
                {conversationId ? 'No messages yet' : 'Start by selecting a contact'}
              </div>
            ) : (
              sortedMessages.map((m) => {
                const mine = m.senderId === user?.id;
                const bubbleStyle: React.CSSProperties = {
                  borderRadius: 14,
                  padding: 10,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: COLORS.lightBorderStrong,
                  maxWidth: '82%',
                  display: 'inline-block',
                  ...(mine
                    ? {
                        backgroundColor: COLORS.bubbleMineBg,
                        borderColor: COLORS.bubbleMineBorder,
                        borderTopRightRadius: 6,
                      }
                    : {
                        backgroundColor: COLORS.lightSurface,
                        borderTopLeftRadius: 6,
                      }),
                };
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      width: '100%',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                    }}
                    className="group"
                  >
                    <div style={bubbleStyle}>
                      {!mine && (
                        <div
                          style={{
                            fontSize: 11,
                            color: COLORS.lightTextSubtle,
                            marginBottom: 2,
                            fontWeight: 800,
                          }}
                        >
                          {m.senderName}
                        </div>
                      )}
                      {!m.deletedAt && m.attachmentUrl && m.attachmentType === 'image' && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={m.attachmentUrl}
                            alt={m.attachmentName ?? 'Image'}
                            style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block' }}
                          />
                        </a>
                      )}
                      {!m.deletedAt && m.attachmentUrl && m.attachmentType === 'video' && (
                        <video
                          src={m.attachmentUrl}
                          controls
                          style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block' }}
                        />
                      )}
                      {m.deletedAt ? (
                        <div
                          style={{
                            color: COLORS.lightTextMuted,
                            fontSize: 12,
                            fontStyle: 'italic',
                          }}
                        >
                          Message deleted
                        </div>
                      ) : m.content && m.content.trim() !== '[Attachment]' ? (
                        <div
                          style={{
                            color: COLORS.lightText,
                            fontWeight: 700,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {m.content}
                        </div>
                      ) : null}
                      {!m.deletedAt && m.attachmentUrl && m.attachmentType === 'document' && (
                        <a
                          href={m.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#2563eb',
                            marginTop: 6,
                            fontSize: 12,
                            fontWeight: 800,
                            display: 'inline-block',
                            textDecoration: 'underline',
                          }}
                        >
                          Attachment: {m.attachmentName ?? m.attachmentType ?? 'file'}
                        </a>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          justifyContent: 'flex-end',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <span style={{ color: COLORS.lightTextSubtle, fontSize: 10, fontWeight: 800 }}>
                          {formatMessageTime(m.createdAt)}
                        </span>
                        {m.editedAt && !m.deletedAt && (
                          <span style={{ color: COLORS.lightTextSubtle, fontSize: 10, fontWeight: 800 }}>
                            (edited)
                          </span>
                        )}
                        {mine && (
                          <span style={{ color: COLORS.lightTextSubtle, fontSize: 10, fontWeight: 800 }}>
                            {getOwnStatusText(m)}
                          </span>
                        )}
                      </div>
                      {!m.deletedAt &&
                        m.reactionCounts &&
                        Object.keys(m.reactionCounts).length > 0 && (
                          <div
                            style={{
                              color: COLORS.lightTextMuted,
                              marginTop: 4,
                              fontSize: 11,
                              fontWeight: 900,
                            }}
                          >
                            {Object.entries(m.reactionCounts)
                              .filter(([, count]) => Number(count) > 0)
                              .map(([reaction, count]) => `${reaction} ${count}`)
                              .join('  ')}
                          </div>
                        )}
                      {!m.deletedAt && (
                        <div
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            display: 'flex',
                            flexDirection: 'row',
                            justifyContent: mine ? 'flex-end' : 'flex-start',
                            gap: 6,
                            marginTop: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => void api.reactDmMessage(m.id, 'like')}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: 0,
                            }}
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            onClick={() => void api.reactDmMessage(m.id, 'love')}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: 0,
                            }}
                          >
                            ❤️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleForward(m)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 800,
                              color: COLORS.lightTextMuted,
                              padding: 0,
                            }}
                          >
                            Forward
                          </button>
                          {mine && (
                            <button
                              type="button"
                              onClick={() => handleEdit(m)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 800,
                                color: COLORS.lightTextMuted,
                                padding: 0,
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {mine && (
                            <button
                              type="button"
                              onClick={() => handleDelete(m)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 800,
                                color: '#dc2626',
                                padding: 0,
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {typingUserId ? (
            <div
              style={{
                color: COLORS.lightTextMuted,
                marginBottom: 8,
                marginLeft: 2,
                fontSize: 12,
                fontWeight: 800,
                paddingTop: 4,
              }}
            >
              {contacts.find((c) => c.id === typingUserId)?.name ?? 'Someone'} is typing...
            </div>
          ) : null}

          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              backgroundColor: COLORS.lightSurface,
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 12,
              paddingRight: 12,
              borderTopWidth: 1,
              borderTopStyle: 'solid',
              borderTopColor: COLORS.lightBorderStrong,
              marginLeft: -16,
              marginRight: -16,
            }}
          >
            {!connected && (
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid #fde68a',
                  backgroundColor: '#fffbeb',
                  padding: '6px 10px',
                  fontSize: 11,
                  color: '#b45309',
                  fontWeight: 700,
                }}
              >
                You are offline. Reconnect to send new messages.
              </div>
            )}
            {pendingAttachment && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: COLORS.lightTextMuted,
                }}
              >
                {pendingAttachment.type === 'image' && (
                  <img
                    src={pendingAttachment.url}
                    alt="Preview"
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                  />
                )}
                {pendingAttachment.type === 'video' && (
                  <video src={pendingAttachment.url} style={{ width: 40, height: 40, borderRadius: 6 }} />
                )}
                {pendingAttachment.type === 'document' && (
                  <span
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: `1px solid ${COLORS.lightBorderStrong}`,
                    }}
                  >
                    DOC
                  </span>
                )}
                <span
                  style={{
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pendingAttachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    color: COLORS.lightTextMuted,
                    padding: 0,
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!conversationId || uploading}
                aria-label="Attach file"
                title="Attach image, video, or document"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: COLORS.lightBorderStrong,
                  backgroundColor: COLORS.cardSolid,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: !conversationId || uploading ? 0.6 : 1,
                  padding: 0,
                }}
              >
                <span
                  style={{
                    color: COLORS.lightTextMuted,
                    fontSize: 22,
                    lineHeight: '24px',
                    fontWeight: 700,
                  }}
                >
                  {uploading ? '…' : '+'}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,text/plain"
                onChange={handleFileChange}
              />
              <input
                placeholder={selectedContact ? 'Type message...' : 'Select a contact first'}
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  if (conversationId) triggerTyping();
                }}
                disabled={!conversationId}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: COLORS.lightBorderStrong,
                  borderRadius: 22,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 10,
                  paddingBottom: 10,
                  color: COLORS.lightText,
                  fontWeight: 700,
                  backgroundColor: COLORS.lightSurface,
                  outline: 'none',
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={
                  !conversationId ||
                  !connected ||
                  (!messageText.trim() && !pendingAttachment) ||
                  sendMessage.isLoading ||
                  uploading
                }
                aria-label="Send"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: COLORS.success,
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity:
                    !conversationId ||
                    !connected ||
                    (!messageText.trim() && !pendingAttachment) ||
                    sendMessage.isLoading ||
                    uploading
                      ? 0.5
                      : 1,
                  padding: 0,
                }}
              >
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>➤</span>
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
