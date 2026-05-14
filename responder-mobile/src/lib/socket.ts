import { io, type Socket } from "socket.io-client";
import { API_BASE } from "../config";

let socket: Socket | null = null;

function getSocketBaseUrl() {
  // API_BASE is like http://host:3003/api; Socket.IO endpoint is same host/port root.
  return API_BASE.replace(/\/api\/?$/, "");
}

export function getOrCreateSocket(token: string): Socket {
  if (!socket) {
    socket = io(getSocketBaseUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  } else {
    socket.auth = { token };
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
