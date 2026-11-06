import { useSyncExternalStore } from "react";
import type { LiveChatMessage, LiveChatTask } from "./staffChat.ts";

export type DockMessage = { id: string; sender_type: string; body: string; created_at: string; has_image?: boolean };

export type DockTask = {
  id: string;
  status: string;
  version: number;
  customer_ref: string;
  channel: string;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  member?: { game_account?: string | null; display_name?: string | null; site?: string | null } | null;
  messages: DockMessage[];
};

export type DockWindow = {
  task: DockTask;
  expanded: boolean;
  draft: string;
  unread: number;
};

const MAX_WINDOWS = 6;
const MAX_EXPANDED = 3;

let snapshot: DockWindow[] = [];
const listeners = new Set<() => void>();

function commit(next: DockWindow[]): void {
  snapshot = fit(next).slice(0, MAX_WINDOWS);
  for (const listener of listeners) {
    listener();
  }
}

function fit(next: DockWindow[]): DockWindow[] {
  let kept = 0;
  return next.map((window) => {
    if (!window.expanded) {
      return window;
    }
    kept += 1;
    if (kept <= MAX_EXPANDED) {
      return window;
    }
    return { ...window, expanded: false };
  });
}

export function useChatDock(): DockWindow[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function openDockChat(task: DockTask, expanded = true): void {
  const current = snapshot.find((window) => window.task.id === task.id);
  const rest = snapshot.filter((window) => window.task.id !== task.id);
  commit([
    {
      task,
      expanded,
      draft: current?.draft ?? "",
      unread: expanded ? 0 : (current?.unread ?? 0),
    },
    ...rest,
  ]);
}

export function seedDockBubble(event: LiveChatMessage): void {
  if (snapshot.some((window) => window.task.id === event.task_id)) {
    applyDockLiveMessage(event);
    return;
  }
  const rest = snapshot;
  commit([
    {
      task: {
        id: event.task_id,
        status: event.task_status,
        version: event.version,
        customer_ref: event.customer_ref || "Khách",
        channel: event.channel || "web_chat",
        messages: [{ id: event.message_id, sender_type: event.sender_type, body: event.body, created_at: event.created_at, has_image: event.has_image }],
      },
      expanded: false,
      draft: "",
      unread: event.sender_type === "customer" ? 1 : 0,
    },
    ...rest,
  ]);
}

export function rememberDockChat(task: DockTask): void {
  if (snapshot.some((window) => window.task.id === task.id)) {
    replaceDockTask(task);
    return;
  }
  openDockChat(task, false);
}

export function closeDockChat(id: string): void {
  commit(snapshot.filter((window) => window.task.id !== id));
}

export function setDockExpanded(id: string, expanded: boolean): void {
  commit(
    snapshot.map((window) => (window.task.id === id ? { ...window, expanded, unread: expanded ? 0 : window.unread } : window)),
  );
}

export function setDockDraft(id: string, draft: string): void {
  snapshot = snapshot.map((window) => (window.task.id === id ? { ...window, draft } : window));
  for (const listener of listeners) {
    listener();
  }
}

export function replaceDockTask(task: DockTask): void {
  commit(
    snapshot.map((window) => {
      if (window.task.id !== task.id) {
        return window;
      }
      const seen = new Set(task.messages.map((message) => message.id));
      const extra = window.task.messages.filter((message) => !seen.has(message.id));
      return { ...window, task: { ...task, messages: [...task.messages, ...extra] } };
    }),
  );
}

export function applyDockLiveMessage(event: LiveChatMessage): void {
  const index = snapshot.findIndex((window) => window.task.id === event.task_id);
  if (index < 0) {
    return;
  }
  const window = snapshot[index];
  if (!window) {
    return;
  }
  const exists = window.task.messages.some((message) => message.id === event.message_id);
  const messages = exists
    ? window.task.messages
    : [...window.task.messages, { id: event.message_id, sender_type: event.sender_type, body: event.body, created_at: event.created_at, has_image: event.has_image }];
  const unread = window.expanded || event.sender_type !== "customer" || exists ? window.unread : window.unread + 1;
  const next = snapshot.slice();
  next[index] = {
    ...window,
    unread: window.expanded ? 0 : unread,
    task: {
      ...window.task,
      status: event.task_status || window.task.status,
      version: event.version || window.task.version,
      customer_ref: event.customer_ref || window.task.customer_ref,
      channel: event.channel || window.task.channel,
      messages,
    },
  };
  commit(next);
}

export function applyDockLiveTask(event: LiveChatTask): void {
  commit(
    snapshot.map((window) =>
      window.task.id === event.task_id
        ? {
            ...window,
            task: {
              ...window.task,
              status: event.status || window.task.status,
              version: event.version || window.task.version,
              customer_ref: event.customer_ref || window.task.customer_ref,
              channel: event.channel || window.task.channel,
            },
          }
        : window,
    ),
  );
}
