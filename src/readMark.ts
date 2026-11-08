export function showReadMark<T extends { read_at?: string | null }>(messages: T[], index: number, mine: (message: T) => boolean): boolean {
  const message = messages[index];
  if (!message || !mine(message) || !message.read_at) {
    return false;
  }
  for (let later = index + 1; later < messages.length; later += 1) {
    const item = messages[later];
    if (item && mine(item) && item.read_at) {
      return false;
    }
  }
  return true;
}

export function withRead<T extends { id: string; read_at?: string | null }>(messages: T[], ids: string[], readAt: string): T[] {
  const chosen = new Set(ids);
  let changed = false;
  const next = messages.map((message) => {
    if (!chosen.has(message.id) || message.read_at) {
      return message;
    }
    changed = true;
    return { ...message, read_at: readAt };
  });
  return changed ? next : messages;
}
