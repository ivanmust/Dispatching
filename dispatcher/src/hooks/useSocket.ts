import { useEffect, useState, useCallback } from 'react';
import { connectSocket, getSocket } from '@/lib/socket';
import { toast } from '@/hooks/use-toast';
import type { ChatMessage, IncidentStatus } from '@/types/incident';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    const socket = connectSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = (reason: string) => {
      setConnected(false);
      if (reason === "io server disconnect" || reason === "transport close") {
        toast({ title: "Connection lost", description: "Reconnecting…", variant: "destructive" });
      }
    };
    const onConnectError = () => {
      setConnected(false);
      // Refresh auth token used by socket handshake and retry.
      socket.auth = { token: sessionStorage.getItem('cad_token') };
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  // Reconnect socket whenever authenticated user context changes.
  useEffect(() => {
    const token = sessionStorage.getItem('cad_token');
    if (!user?.id || !token) return;
    const socket = connectSocket();
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  }, [user?.id]);

  // Pop-up notifications (toast) when new notifications arrive
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    const handler = (n: { type?: string; title: string; body: string }) => {
      toast({ title: n.title, description: n.body });
      // Refresh unread count and list for the notifications badge/page
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] }).catch?.(() => {});
      qc.invalidateQueries({ queryKey: ['notifications'] }).catch?.(() => {});
      // Refresh DM contacts so unread badge updates when new DM arrives
      if (n.type === 'dm:new') {
        qc.invalidateQueries({ queryKey: ['dm-contacts'] }).catch?.(() => {});
      }
    };
    socket.on("notification:new", handler);
    return () => {
      socket.off("notification:new", handler);
    };
  }, [user?.id]);

  const onStatusChange = useCallback(
    (handler: (data: { incidentId: string; status: IncidentStatus }) => void) => {
      const socket = getSocket();
      const wrappedHandler = (data: { incidentId: string; status: IncidentStatus }) => {
        toast({
          title: 'Status Update',
          description: `Incident status changed to ${data.status}`,
        });
        handler(data);
      };
      socket.on('incident:statusChange', wrappedHandler);
      return () => {
        socket.off('incident:statusChange', wrappedHandler);
      };
    },
    []
  );

  const onNewMessage = useCallback(
    (handler: (msg: ChatMessage) => void) => {
      const socket = getSocket();
      const wrappedHandler = (msg: ChatMessage) => {
        toast({ title: 'New Message', description: `${msg.senderName}: ${msg.text.slice(0, 50)}` });
        handler(msg);
      };
      socket.on('chat:newMessage', wrappedHandler);
      return () => {
        socket.off('chat:newMessage', wrappedHandler);
      };
    },
    []
  );

  const onResponderLocation = useCallback(
    (handler: (data: { responderId: string; lat: number; lon: number }) => void) => {
      const socket = getSocket();
      socket.on('responder:location', handler);
      return () => {
        socket.off('responder:location', handler);
      };
    },
    []
  );

  const onResponderAvailability = useCallback(
    (handler: (data: { responderId: string; available: boolean }) => void) => {
      const socket = getSocket();
      socket.on('responder:availability', handler);
      return () => {
        socket.off('responder:availability', handler);
      };
    },
    []
  );

  const onIncidentAssigned = useCallback(
    (handler: () => void) => {
      const socket = getSocket();
      socket.on('incident:assigned', handler);
      return () => {
        socket.off('incident:assigned', handler);
      };
    },
    []
  );

  const onIncidentCreated = useCallback(
    (handler: (data: { incidentId: string; status?: IncidentStatus }) => void) => {
      const socket = getSocket();
      socket.on('incident:created', handler);
      return () => {
        socket.off('incident:created', handler);
      };
    },
    []
  );

  const socket = getSocket();

  return { socket, connected, onStatusChange, onNewMessage, onResponderLocation, onResponderAvailability, onIncidentAssigned, onIncidentCreated };
}
