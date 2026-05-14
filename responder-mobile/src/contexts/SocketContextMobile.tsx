import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { useAuthMobile } from "./AuthContextMobile";
import { getCadToken } from "../lib/storage";
import { disconnectSocket, getOrCreateSocket } from "../lib/socket";

type SocketContextValue = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function SocketProviderMobile({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthMobile();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!isAuthenticated) {
        disconnectSocket();
        if (mounted) {
          setSocket(null);
          setConnected(false);
        }
        return;
      }
      const token = await getCadToken();
      if (!token) return;

      const s = getOrCreateSocket(token);
      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);
      s.on("connect", onConnect);
      s.on("disconnect", onDisconnect);
      if (!s.connected) s.connect();
      if (mounted) {
        setSocket(s);
        setConnected(s.connected);
      }

      return () => {
        s.off("connect", onConnect);
        s.off("disconnect", onDisconnect);
      };
    };

    const cleanupPromise = run();
    return () => {
      mounted = false;
      Promise.resolve(cleanupPromise).then((cleanup) => cleanup?.());
    };
  }, [isAuthenticated]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocketMobile() {
  return useContext(SocketContext);
}
