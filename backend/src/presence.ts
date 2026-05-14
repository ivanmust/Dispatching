const onlineUsers = new Set<string>();

export function setUserOnline(userId: string) {
  onlineUsers.add(String(userId));
}

export function setUserOffline(userId: string) {
  onlineUsers.delete(String(userId));
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(String(userId));
}

export function getOnlineUsers(): Set<string> {
  return new Set(onlineUsers);
}

