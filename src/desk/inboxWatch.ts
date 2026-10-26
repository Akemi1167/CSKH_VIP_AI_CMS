import { useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { StaffChat, type LiveChatMessage, type LiveChatTask, type ReplyAck } from "./staffChat.ts";

export type UnreadChat = {
  taskId: string;
  customerRef: string;
  body: string;
  count: number;
};

type Snapshot = {
  count: number;
  byId: ReadonlyMap<string, UnreadChat>;
};

type BoardHandlers = {
  onStatus: (status: "connecting" | "live" | "down") => void;
  onMessage: (message: LiveChatMessage) => void;
  onTask: (task: LiveChatTask) => void;
  onRefresh: () => void;
};

type TaskListItem = {
  id: string;
  customer_ref: string;
  last_message: { body: string; sender_type: string; created_at: string | null } | null;
};

const SEEN_KEY = "cskh.inbox-seen";
const BASE_TITLE = "CSKH VIP";

const unread = new Map<string, UnreadChat>();
const seenAt = new Map<string, number>();
const seenIds = new Set<string>();
const listeners = new Set<() => void>();
const boards = new Set<BoardHandlers>();

let snapshot: Snapshot = { count: 0, byId: unread };
let chat: StaffChat | null = null;
let status: "connecting" | "live" | "down" = "down";
let watchScope: "own" | "staff" = "own";
let catchUpTimer = 0;
let flashTimer = 0;
let flashOn = false;
let audio: AudioContext | null = null;
let originalIcon = "";
let focusVisible = false;
let focusTaskId: string | null = null;

export function useInboxUnread(): Snapshot {
  return useSyncExternalStore(subscribeInbox, getInboxSnapshot, getInboxSnapshot);
}

export function subscribeInbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInboxSnapshot(): Snapshot {
  return snapshot;
}

export function staffChatLive(): boolean {
  return chat?.live ?? false;
}

export function sendStaffReply(input: { task_id: string; version: number; body: string; care_note: string }): Promise<ReplyAck> {
  if (!chat) {
    return Promise.reject(new Error("offline"));
  }
  return chat.sendReply(input);
}

export function bindInboxBoard(handlers: BoardHandlers): () => void {
  boards.add(handlers);
  handlers.onStatus(status);
  return () => boards.delete(handlers);
}

export function setInboxFocus(visible: boolean, taskId: string | null): void {
  focusVisible = visible;
  focusTaskId = taskId;
  if (visible && taskId && document.hasFocus() && !document.hidden) {
    markInboxRead(taskId);
  }
}

export function markInboxRead(taskId: string): void {
  seenAt.set(taskId, Math.max(seenAt.get(taskId) ?? 0, Date.now()));
  saveSeen();
  if (!unread.delete(taskId)) {
    paintChrome();
    return;
  }
  publish();
}

export function askChatNotification(): void {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }
  void Notification.requestPermission();
}

export function armAlertSound(): void {
  const Context = window.AudioContext;
  if (!Context) {
    return;
  }
  audio ??= new Context();
  void audio.resume();
}

export function startInboxWatch(scope: "own" | "staff" = "own"): void {
  watchScope = scope;
  if (chat) {
    return;
  }
  loadSeen();
  chat = new StaffChat({
    onStatus: (next) => {
      status = next;
      for (const board of boards) {
        board.onStatus(next);
      }
    },
    onMessage: (event) => {
      noteCustomerMessage(event);
      for (const board of boards) {
        board.onMessage(event);
      }
    },
    onTask: (event) => {
      for (const board of boards) {
        board.onTask(event);
      }
    },
  });
  chat.start();
  void catchUp();
  catchUpTimer = window.setInterval(() => void catchUp(), 5_000);
  flashTimer = window.setInterval(paintChrome, 1_200);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

export function noteInboxRows(items: TaskListItem[]): void {
  if (items.length === 0) {
    return;
  }
  absorb(items);
}

export function stopInboxWatch(): void {
  chat?.stop();
  chat = null;
  window.clearInterval(catchUpTimer);
  window.clearInterval(flashTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  document.title = BASE_TITLE;
  restoreIcon();
}

function onVisible(): void {
  if (document.hidden || !document.hasFocus()) {
    return;
  }
  if (focusVisible && focusTaskId) {
    markInboxRead(focusTaskId);
  }
  paintChrome();
}

function noteCustomerMessage(event: LiveChatMessage): void {
  if (event.sender_type !== "customer") {
    return;
  }
  const at = moment(event.created_at);
  if (seenIds.has(event.message_id) || at <= (seenAt.get(event.task_id) ?? 0)) {
    seenIds.add(event.message_id);
    return;
  }
  seenIds.add(event.message_id);
  seenAt.set(event.task_id, at);
  saveSeen();
  const looking = focusVisible && focusTaskId === event.task_id && document.hasFocus() && !document.hidden;
  if (looking) {
    return;
  }
  const previous = unread.get(event.task_id);
  unread.set(event.task_id, {
    taskId: event.task_id,
    customerRef: event.customer_ref || previous?.customerRef || "Khách",
    body: event.body,
    count: (previous?.count ?? 0) + 1,
  });
  publish();
  alertStaff(event.customer_ref || "Khách", event.body, event.task_id);
}

function absorb(items: TaskListItem[]): void {
  let changed = false;
  let alert: { name: string; body: string; taskId: string } | null = null;
  for (const row of items) {
    const at = moment(row.last_message?.created_at);
    const stored = seenAt.get(row.id);
    const customer = row.last_message?.sender_type === "customer" && Boolean(row.last_message.created_at);
    if (stored === undefined) {
      seenAt.set(row.id, at);
      if (!customer || Date.now() - at > 90_000) {
        continue;
      }
    } else if (!customer || at <= stored) {
      continue;
    } else {
      seenAt.set(row.id, at);
    }
    if (focusVisible && focusTaskId === row.id && document.hasFocus() && !document.hidden) {
      continue;
    }
    const previous = unread.get(row.id);
    unread.set(row.id, {
      taskId: row.id,
      customerRef: row.customer_ref || previous?.customerRef || "Khách",
      body: row.last_message?.body || "Có hội thoại mới",
      count: (previous?.count ?? 0) + 1,
    });
    changed = true;
    alert = {
      name: row.customer_ref || "Khách",
      body: row.last_message?.body || "Có hội thoại mới",
      taskId: row.id,
    };
  }
  saveSeen();
  if (changed) {
    publish();
  }
  if (alert) {
    alertStaff(alert.name, alert.body, alert.taskId);
  }
}

async function catchUp(): Promise<void> {
  let result: { items: TaskListItem[] };
  try {
    const path = watchScope === "staff" ? "/api/v1/tasks?scope=staff" : "/api/v1/tasks";
    result = await api<{ items: TaskListItem[] }>(path);
  } catch {
    return;
  }
  const before = unread.size;
  absorb(result.items);
  if (unread.size > before) {
    for (const board of boards) {
      board.onRefresh();
    }
  }
}

function alertStaff(name: string, body: string, taskId: string): void {
  const title = "Chat mới";
  const text = `${name}: ${body}`.slice(0, 140);
  if ("Notification" in window && Notification.permission === "granted" && (document.hidden || !focusVisible)) {
    const notice = new Notification(title, { body: text, tag: taskId });
    notice.onclick = () => {
      window.focus();
      window.dispatchEvent(new Event("cskh-open-inbox"));
      notice.close();
    };
  }
  ping();
}

function ping(): void {
  if (!audio || audio.state !== "running") {
    return;
  }
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.05, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.18);
}

function publish(): void {
  snapshot = { count: unread.size, byId: new Map(unread) };
  paintChrome();
  for (const listener of listeners) {
    listener();
  }
}

function paintChrome(): void {
  const count = unread.size;
  flashOn = !flashOn;
  if (count === 0) {
    document.title = BASE_TITLE;
    restoreIcon();
    return;
  }
  const marked = `(${count}) ${BASE_TITLE}`;
  document.title = document.hidden && flashOn ? `(${count}) Chat mới` : marked;
  paintIcon();
}

function paintIcon(): void {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    return;
  }
  if (!originalIcon) {
    originalIcon = link.href;
  }
  link.href =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2316a34a'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-size='15' fill='white' font-family='sans-serif'%3EC%3C/text%3E%3Ccircle cx='25' cy='7' r='6' fill='%23ef4444'/%3E%3C/svg%3E";
}

function restoreIcon(): void {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link && originalIcon) {
    link.href = originalIcon;
  }
}

function moment(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function loadSeen(): void {
  const raw = sessionStorage.getItem(SEEN_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "number") {
        seenAt.set(id, at);
      }
    }
  } catch {
    sessionStorage.removeItem(SEEN_KEY);
  }
}

function saveSeen(): void {
  const record: Record<string, number> = {};
  for (const [id, at] of seenAt) {
    record[id] = at;
  }
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(record));
}
