import { MessageOutlined, PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { imageFromPaste } from "../clipboardImage.ts";
import { formatStamp } from "../copy.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { ChatBody } from "./ChatBody.tsx";
import { useTr } from "./language.tsx";
import { openDockChat, rememberDockChat } from "./chatDock.ts";
import { bindInboxBoard, markInboxRead, noteInboxRows, reportTaskRead, sendStaffReply, setInboxFocus, staffChatLive, useInboxUnread } from "./inboxWatch.ts";
import { showReadMark, withRead } from "../readMark.ts";
import type { LiveChatMessage } from "./staffChat.ts";

type TaskStatus = "QUEUED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "COMPLETED" | "CANCELLED";

type TaskRow = {
  id: string;
  status: TaskStatus;
  version: number;
  received_at: string;
  customer_ref: string;
  channel: string;
  campaign_name: string | null;
  note: string | null;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  hold?: boolean;
  first_response: { state: string; due_at: string | null };
  last_message: { body: string; sender_type: string; created_at: string | null } | null;
  member?: { site: string | null } | null;
  client_ip?: string | null;
  client_country?: string | null;
};

type TaskDetail = TaskRow & {
  messages: { id: string; sender_type: string; body: string; created_at: string; has_image?: boolean; read_at?: string | null }[];
};

function statusText(status: string, tr: (vi: string, zh: string) => string, hold?: boolean): string {
  if (hold) {
    return tr("Chờ xử lý", "待处理");
  }
  switch (status) {
    case "QUEUED":
      return tr("Chưa giao", "未分配");
    case "ASSIGNED":
      return tr("Đã giao", "已分配");
    case "IN_PROGRESS":
      return tr("Đang xử lý", "处理中");
    case "WAITING_CUSTOMER":
      return tr("Chờ khách", "等待客户");
    case "COMPLETED":
      return tr("Xong", "完成");
    case "CANCELLED":
      return tr("Đã hủy", "已取消");
    default:
      return status;
  }
}

const NEXT_STATUS: Record<string, TaskStatus[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_CUSTOMER", "COMPLETED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "COMPLETED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "COMPLETED"],
};

function slaText(state: string, tr: (vi: string, zh: string) => string): string {
  switch (state) {
    case "open":
      return tr("Đang tính giờ", "计时中");
    case "paused":
      return tr("Tạm dừng", "已暂停");
    case "met":
      return tr("Đúng hạn", "准时");
    case "breached":
      return tr("Trễ", "超时");
    case "unscheduled":
      return tr("Ngoài ca", "班次外");
    default:
      return state;
  }
}

type AssignResult = {
  outside_shift: boolean;
  over_capacity: boolean;
};

function chatMoment(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function newestFirst(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((left, right) => {
    const leftTime = chatMoment(left.last_message?.created_at) || chatMoment(left.received_at);
    const rightTime = chatMoment(right.last_message?.created_at) || chatMoment(right.received_at);
    return rightTime - leftTime;
  });
}

function previewDetail(row: TaskRow): TaskDetail {
  const last = row.last_message;
  return {
    ...row,
    messages: last?.created_at
      ? [{ id: `preview-${row.id}`, sender_type: last.sender_type, body: last.body, created_at: last.created_at }]
      : [],
  };
}

function shortTime(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("vi-VN", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date);
}

function asStatus(value: string, fallback: TaskStatus): TaskStatus {
  if (value === "QUEUED" || value === "ASSIGNED" || value === "IN_PROGRESS" || value === "WAITING_CUSTOMER" || value === "COMPLETED" || value === "CANCELLED") {
    return value;
  }
  return fallback;
}

function chatCount(shown: number, total: number, query: string, tr: (vi: string, zh: string) => string): string {
  if (query && total === 0) {
    return tr("Không có hội thoại khớp.", "没有匹配的会话。");
  }
  if (shown < total) {
    return tr(`Đang hiện ${shown} / ${total} hội thoại mới nhất.`, `正在显示最新 ${shown} / ${total} 个会话。`);
  }
  if (query) {
    return tr(`${total} hội thoại khớp.`, `匹配 ${total} 个会话。`);
  }
  return tr(`${total} hội thoại.`, `${total} 个会话。`);
}

function chatInitial(name: string): string {
  const clean = name.replace(/^tg:/i, "").trim();
  return (clean.slice(0, 1) || "?").toUpperCase();
}

export function WorkBoard(props: {
  heading: string;
  lead: string;
  layout?: "table" | "chat";
  scope?: "own" | "staff" | "team";
  canUpdate: boolean;
  canManageAny?: boolean;
  canCancel: boolean;
  canTransfer: boolean;
  canListStaff: boolean;
  selfId: string;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const oversight = props.scope === "staff" || props.scope === "team";
  const chatLayout = props.layout === "chat";
  const threadRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>(oversight ? "all" : "open");
  const [assigneeId, setAssigneeId] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const queryRef = useRef("");
  queryRef.current = query;
  const [items, setItems] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [reply, setReply] = useState("");
  const replyRef = useRef("");
  const composingRef = useRef(false);
  const lastSentRef = useRef({ body: "", at: 0 });
  const [careNote, setCareNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roster, setRoster] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const [reason, setReason] = useState(() => tr("Chuyển việc", "转交工作"));
  const [warning, setWarning] = useState<string | null>(null);
  const [reminders, setReminders] = useState<{ id: string; customer_ref: string; site: string | null; due_on: string }[]>([]);
  const [logos, setLogos] = useState<Set<string>>(new Set());
  const listRef = useRef({ status, assigneeId, ids: new Set<string>() });
  const listFlight = useRef(false);
  listRef.current = { status, assigneeId, ids: new Set(items.map((row) => row.id)) };
  const unread = useInboxUnread();
  const detailRef = useRef<TaskDetail | null>(null);
  detailRef.current = detail;
  const opened = useRef(new Map<string, TaskDetail>());
  const openToken = useRef(0);
  const [threadLoading, setThreadLoading] = useState<string | null>(null);

  function rememberDetail(next: TaskDetail) {
    const cache = opened.current;
    cache.delete(next.id);
    cache.set(next.id, next);
    while (cache.size > 40) {
      const oldest = cache.keys().next().value;
      if (!oldest) {
        break;
      }
      cache.delete(oldest);
    }
  }

  useEffect(() => {
    if (!chatLayout) {
      return;
    }
    return () => {
      const current = detailRef.current;
      if (current) {
        rememberDockChat(current);
      }
    };
  }, [chatLayout]);

  const failAuth = useCallback(
    (caught: ApiError) => {
      if (caught.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (caught.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props.onUnauthorized, props.onMfaSetup],
  );

  useEffect(() => {
    let ignore = false;
    api<{ items: { code: string; has_logo?: boolean }[] }>("/api/v1/stations")
      .then((result) => {
        if (!ignore) {
          setLogos(new Set(result.items.filter((item) => item.has_logo).map((item) => item.code)));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  const load = useCallback(async (nextStatus: string, nextAssignee: string) => {
    if (listFlight.current) {
      return;
    }
    listFlight.current = true;
    const params = new URLSearchParams();
    if (props.scope === "staff" || props.scope === "team") {
      params.set("scope", props.scope);
    }
    if (nextStatus !== "open" && nextStatus !== "all") {
      params.set("status", nextStatus);
    }
    if ((props.scope === "staff" || props.scope === "team") && nextAssignee) {
      params.set("assignee_id", nextAssignee);
    }
    const needle = queryRef.current.trim();
    if (needle) {
      params.set("q", needle);
    }
    const queryText = params.toString();
    try {
      const result = await api<{ items: TaskRow[]; total?: number }>(`/api/v1/tasks${queryText ? `?${queryText}` : ""}`);
      setItems(result.items);
      setTotal(typeof result.total === "number" ? result.total : result.items.length);
      setError(null);
    } finally {
      listFlight.current = false;
    }
  }, [props.scope]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(status, assigneeId)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được task", "无法加载任务"), "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [assigneeId, failAuth, load, query, status]);

  useEffect(() => {
    const next = draft.trim();
    const timer = window.setTimeout(() => {
      setQuery((current) => (current === next ? current : next));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (props.scope !== "team" && (!oversight || !props.canListStaff)) {
      return;
    }
    let ignore = false;
    const path = props.scope === "team" ? "/api/v1/team/staff" : "/api/v1/admin/staff";
    api<{ items: Staff[] }>(path)
      .then((people) => {
        if (!ignore) {
          setRoster(people.items.filter((person) => person.status === "active" || props.scope === "team"));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [oversight, props.canListStaff, props.scope]);

  useEffect(() => {
    let ignore = false;
    api<{ items: { id: string; customer_ref: string; site: string | null; due_on: string }[] }>("/api/v1/care/callbacks")
      .then((result) => {
        if (!ignore) {
          setReminders(result.items);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  async function openTask(id: string, keepDraft = false) {
    const cached = opened.current.get(id);
    if (!keepDraft && detailRef.current?.id === id && (cached?.messages.length ?? 0) > 0) {
      markInboxRead(id);
      return;
    }
    const token = ++openToken.current;
    setError(null);
    const row = items.find((item) => item.id === id);
    const known = cached ?? (row ? previewDetail(row) : null);
    if (known) {
      setDetail(known);
    }
    if (!keepDraft) {
      writeReply("");
      setCareNote("");
    }
    markInboxRead(id);
    reportTaskRead(id);
    setThreadLoading(cached?.messages.length ? null : id);
    try {
      const result = await api<TaskDetail>(`/api/v1/tasks/${id}`);
      if (token !== openToken.current) {
        return;
      }
      rememberDetail(result);
      setDetail(result);
    } catch (caught) {
      if (token !== openToken.current) {
        return;
      }
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở được task", "无法打开任务"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      if (token === openToken.current) {
        setThreadLoading(null);
      }
    }
  }

  async function changeStatus(next: TaskStatus) {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/tasks/${detail.id}`, { method: "PATCH", body: { version: detail.version, status: next } });
      await load(status, assigneeId);
      await openTask(detail.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không đổi được trạng thái", "无法更改状态"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reopenChat() {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/tasks/${detail.id}/reopen`, { method: "POST", body: { version: detail.version } });
      const nextFilter = status === "COMPLETED" ? (oversight ? "all" : "open") : status;
      if (nextFilter !== status) {
        setStatus(nextFilter);
      }
      await load(nextFilter, assigneeId);
      await openTask(detail.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở lại được hội thoại", "无法重新打开会话"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  function applyLiveMessage(event: LiveChatMessage) {
    const known = listRef.current.ids.has(event.task_id);
    setItems((current) => {
      if (!current.some((row) => row.id === event.task_id)) {
        return current;
      }
      return current.map((row) =>
        row.id === event.task_id
          ? {
              ...row,
              version: event.version || row.version,
              status: asStatus(event.task_status, row.status),
              client_ip: event.client_ip || row.client_ip,
              client_country: event.client_country || row.client_country,
              last_message: { body: event.body, sender_type: event.sender_type, created_at: event.created_at },
            }
          : row,
      );
    });
    setDetail((current) => {
      if (!current || current.id !== event.task_id) {
        return current;
      }
      const statusNext = asStatus(event.task_status, current.status);
      const place = { client_ip: event.client_ip || current.client_ip, client_country: event.client_country || current.client_country };
      if (current.messages.some((message) => message.id === event.message_id)) {
        return { ...current, version: event.version || current.version, status: statusNext, ...place };
      }
      const next = {
        ...current,
        version: event.version || current.version,
        status: statusNext,
        ...place,
        messages: [...current.messages, { id: event.message_id, sender_type: event.sender_type, body: event.body, created_at: event.created_at, has_image: event.has_image }],
      };
      rememberDetail(next);
      return next;
    });
    if (!known) {
      const view = listRef.current;
      void load(view.status, view.assigneeId).catch(() => undefined);
    }
  }

  function writeReply(value: string) {
    replyRef.current = value;
    setReply(value);
  }

  async function sendReply() {
    if (!detail) {
      return;
    }
    const text = replyRef.current.trim();
    if (text.length === 0) {
      return;
    }
    const now = Date.now();
    const previous = lastSentRef.current;
    if (now - previous.at < 500 && (text === previous.body || previous.body.endsWith(` ${text}`))) {
      writeReply("");
      return;
    }
    lastSentRef.current = { body: text, at: now };
    setBusy(true);
    setError(null);
    const note = (careNote.trim() || text).slice(0, 200);
    const taskId = detail.id;
    const version = detail.version;
    try {
      const chatLive = staffChatLive();
      if (chatLayout && chatLive) {
        const ack = await sendStaffReply({ task_id: taskId, version, body: text, care_note: note });
        writeReply("");
        setDetail((current) => {
          if (!current || current.id !== taskId) {
            return current;
          }
          const message = { id: ack.message_id, sender_type: "agent", body: text, created_at: new Date().toISOString() };
          const messages = current.messages.some((item) => item.id === ack.message_id) ? current.messages : [...current.messages, message];
          return { ...current, version: ack.version || current.version, status: asStatus(ack.task_status, current.status), messages };
        });
        await load(status, assigneeId);
        return;
      }
      await api(`/api/v1/tasks/${taskId}/messages`, {
        method: "POST",
        body: { version, body: text, care_label: "da_lien_he_lai", care_note: note },
      });
      writeReply("");
      await load(status, assigneeId);
      await openTask(taskId, true);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", caught instanceof Error ? caught.message : tr("Không gửi được câu trả lời", "无法发送回复"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendImage(file: File) {
    if (!detail) {
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError(new ApiError(400, "validation_error", tr("Ảnh tối đa 5 MB", "图片不能超过 5 MB"), ""));
      return;
    }
    setBusy(true);
    setError(null);
    const caption = replyRef.current.trim();
    const params = new URLSearchParams({ version: String(detail.version) });
    if (caption) {
      params.set("caption", caption);
    }
    const taskId = detail.id;
    try {
      const saved = await api<{ message_id: string; version: number; status: string; body: string }>(`/api/v1/tasks/${taskId}/images?${params}`, {
        method: "POST",
        body: file,
      });
      writeReply("");
      setDetail((current) => {
        if (!current || current.id !== taskId) {
          return current;
        }
        const message = { id: saved.message_id, sender_type: "agent", body: saved.body, created_at: new Date().toISOString(), has_image: true };
        const messages = current.messages.some((item) => item.id === saved.message_id) ? current.messages : [...current.messages, message];
        return { ...current, version: saved.version || current.version, status: asStatus(saved.status, current.status), messages };
      });
      await load(status, assigneeId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", tr("Không gửi được ảnh", "无法发送图片"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function openTransfer() {
    setTransferOpen(true);
    setUserId(undefined);
    setReason(detail?.status === "QUEUED" ? tr("Giao chăm sóc", "分配关怀") : tr("Chuyển việc", "转交工作"));
    if (props.scope === "team") {
      if (staff.length > 0) {
        return;
      }
      try {
        const people = await api<{ items: Staff[] }>("/api/v1/team/staff");
        setStaff(people.items);
        setStaffLoaded(true);
      } catch (caught) {
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được nhân viên", "无法加载员工"), "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      }
      return;
    }
    if (!props.canListStaff || staff.length > 0) {
      return;
    }
    try {
      const people = await api<{ items: Staff[] }>("/api/v1/admin/staff");
      setStaff(people.items.filter((person) => person.status === "active" && person.id !== props.selfId && person.roles.some((role) => role === "agent" || role === "team_lead")));
      setStaffLoaded(true);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được nhân viên", "无法加载员工"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  async function takeBack() {
    if (!detail) {
      return;
    }
    setUserId(props.selfId);
    const pullReason = tr("Thu về xử lý", "收回处理");
    setReason(pullReason);
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await api<AssignResult>(`/api/v1/tasks/${detail.id}/transfer`, {
        method: "POST",
        body: { version: detail.version, to_user_id: props.selfId, reason_code: pullReason },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push(tr("Bạn đang ngoài ca.", "您当前不在班次内。"));
      }
      if (result.over_capacity) {
        notes.push(tr("Bạn đã đủ 8 hội thoại mở.", "您的未完成会话已满 8 个。"));
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setDetail(null);
      await load(status, assigneeId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không thu được task", "无法收回任务"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!detail || !userId || reason.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await api<AssignResult>(detail.status === "QUEUED" ? `/api/v1/admin/queues/${detail.id}/assign` : `/api/v1/tasks/${detail.id}/transfer`, {
        method: "POST",
        body: { version: detail.version, to_user_id: userId, reason_code: reason.trim() },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push(tr("Người nhận đang ngoài ca.", "接收人当前不在班次内。"));
      }
      if (result.over_capacity) {
        notes.push(tr("Người nhận đã đủ 8 hội thoại mở.", "接收人的未完成会话已满 8 个。"));
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setTransferOpen(false);
      setDetail(null);
      await load(status, assigneeId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không chuyển được task", "无法转交任务"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<TaskRow> = [
    ...(oversight ? [{ title: tr("Nhân viên", "员工"), dataIndex: "assignee_name", width: 160, ellipsis: true, render: (value: string | null) => value || "—" } satisfies TableColumnsType<TaskRow>[number]] : []),
    ...(oversight ? [{ title: tr("Đài", "站点"), width: 120, render: (_, row) => (row.member?.site ? <StationMark code={row.member.site} logos={logos} /> : "—") } satisfies TableColumnsType<TaskRow>[number]] : []),
    { title: tr("Kênh", "渠道"), dataIndex: "channel", width: 110, render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: tr("Vị trí", "位置"), width: 220, ellipsis: true, render: (_, row) => customerPlace(row.client_ip, row.client_country) || "—" },
    { title: tr("Tin cuối", "最后一条"), ellipsis: true, render: (_, row) => row.last_message?.body || "—" },
    { title: tr("Trạng thái", "状态"), dataIndex: "status", width: 130, render: (_value: string, row) => statusText(row.status, tr, row.hold) },
    { title: tr("Hạn trả lời", "回复时限"), width: 140, render: (_, row) => slaText(row.first_response.state, tr) },
    { title: tr("Nhận lúc", "接收时间"), dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  const nextStatuses = detail ? (NEXT_STATUS[detail.status] ?? []) : [];
  const open = detail ? nextStatuses.length > 0 : false;
  const canHandle = Boolean(detail && props.canUpdate && (props.canManageAny || detail.assignee_user_id === props.selfId));
  const canReopen = Boolean(detail && props.canUpdate && detail.channel === "telegram" && detail.status === "COMPLETED");
  const canMove = Boolean(props.canTransfer && open && (props.scope === "team" || props.canListStaff));
  const canGive = Boolean(detail?.status === "QUEUED" && props.canCancel && (props.scope === "team" || props.canListStaff));
  const canPull = Boolean(canMove && props.scope === "team" && detail && detail.assignee_user_id !== props.selfId);

  useEffect(() => {
    if (!chatLayout) {
      return;
    }
    noteInboxRows(items);
  }, [chatLayout, items]);

  useEffect(() => {
    if (!chatLayout || detail || items.length === 0) {
      return;
    }
    const newest = newestFirst(items)[0];
    if (newest) {
      void openTask(newest.id);
    }
  }, [chatLayout, detail, items]);

  useEffect(() => {
    if (!chatLayout) {
      return;
    }
    setInboxFocus(true, detail?.id ?? null);
    return () => setInboxFocus(false, null);
  }, [chatLayout, detail?.id]);

  useEffect(() => {
    if (!chatLayout) {
      return;
    }
    return bindInboxBoard({
      onStatus: () => undefined,
      onMessage: (event) => applyLiveMessage(event),
      onRead: (event) => {
        setDetail((current) => (current && current.id === event.task_id ? { ...current, messages: withRead(current.messages, event.message_ids, event.read_at) } : current));
      },
      onTask: () => {
        const view = listRef.current;
        void load(view.status, view.assigneeId).catch(() => undefined);
      },
      onRefresh: () => {
        const view = listRef.current;
        void load(view.status, view.assigneeId).catch(() => undefined);
      },
    });
  }, [chatLayout, load]);

  useEffect(() => {
    if (!chatLayout || !detail) {
      return;
    }
    const id = detail.id;
    const timer = window.setInterval(() => {
      void api<TaskDetail>(`/api/v1/tasks/${id}`)
        .then((result) => {
          rememberDetail(result);
          setDetail((current) => (current?.id === id ? result : current));
        })
        .catch(() => undefined);
      void load(status, assigneeId).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [assigneeId, chatLayout, detail?.id, load, status]);

  const lastMessageId = detail?.messages.at(-1)?.id;
  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lastMessageId]);

  return (
    <section className={chatLayout ? "chat-board" : undefined}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.heading}
          </Typography.Title>
          {chatLayout ? null : <Typography.Text type="secondary">{props.lead}</Typography.Text>}
          {loading && items.length === 0 ? null : <p className="page-note">{chatCount(items.length, total, query, tr)}</p>}
        </div>
        <Space>
          {oversight && (props.scope === "team" || props.canListStaff) ? (
            <Select
              showSearch
              optionFilterProp="label"
              value={assigneeId || "all"}
              style={{ width: 200 }}
              options={[{ value: "all", label: tr("Mọi nhân viên", "全部员工") }, ...roster.map((person) => ({ value: person.id, label: person.display_name }))]}
              onChange={(value: string) => setAssigneeId(value === "all" ? "" : value)}
            />
          ) : null}
          <Select
            value={status}
            style={{ width: 160 }}
            onChange={setStatus}
            options={[
              ...(oversight ? [{ value: "all", label: tr("Mọi trạng thái", "全部状态") }] : [{ value: "open", label: tr("Đang mở", "进行中") }]),
              ...(oversight ? [{ value: "QUEUED", label: tr("Chưa giao", "未分配") }] : []),
              { value: "ASSIGNED", label: tr("Đã giao", "已分配") },
              { value: "IN_PROGRESS", label: tr("Đang xử lý", "处理中") },
              { value: "WAITING_CUSTOMER", label: tr("Chờ khách", "等待客户") },
              { value: "COMPLETED", label: tr("Xong", "完成") },
              { value: "CANCELLED", label: tr("Đã hủy", "已取消") },
            ]}
          />
          <Input
            allowClear
            value={draft}
            placeholder={tr("Tìm mã chat, IP, đài, tin", "搜索会话号、IP、站点、消息")}
            style={{ width: 240 }}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(status, assigneeId).catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được task", "无法加载任务"), ""); if (!failAuth(problem)) setError(problem); })}>
            {tr("Tải lại", "刷新")}
          </Button>
        </Space>
      </div>
      {chatLayout || !error ? null : <ErrorAlert error={error} />}
      {chatLayout || !warning ? null : <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={warning} />}
      {!chatLayout && reminders.length > 0 ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={tr("Việc hẹn", "预约")}
          description={reminders.map((item) => `${item.customer_ref}${item.site ? ` · ${item.site}` : ""} · ${item.due_on.split("-").reverse().join("/")}`).join("\n")}
        />
      ) : null}
      {chatLayout ? (
        <div className="chat-shell">
          <aside className="chat-list">
            {loading && items.length === 0 ? <p className="chat-empty">{tr("Đang tải hội thoại…", "正在加载会话…")}</p> : null}
            {!loading && items.length === 0 ? <p className="chat-empty">{query ? tr("Không có hội thoại khớp.", "没有匹配的会话。") : tr("Chưa có hội thoại.", "还没有会话。")}</p> : null}
            {newestFirst(items).map((row) => {
              const when = row.last_message?.created_at || row.received_at;
              const pending = unread.byId.get(row.id);
              const active = detail?.id === row.id;
              const className = ["chat-list__item", active ? "chat-list__item--active" : "", pending ? "chat-list__item--unread" : ""].filter(Boolean).join(" ");
              return (
                <div key={row.id} className="chat-list__row">
                  <button type="button" className={className} onClick={() => void openTask(row.id)}>
                    <span className="chat-avatar" aria-hidden="true">
                      {chatInitial(row.customer_ref)}
                    </span>
                    <span className="chat-list__body">
                      <span className="chat-list__top">
                        <strong>{row.customer_ref}</strong>
                        {pending ? <span className="chat-unread">{pending.count}</span> : <time>{shortTime(when)}</time>}
                      </span>
                      <span className="chat-list__preview">{pending?.body || row.last_message?.body || tr("Chưa có tin", "暂无消息")}</span>
                      <ChatFacts site={row.member?.site} channel={row.channel} assignee={row.assignee_name} status={row.status} hold={row.hold} logos={logos} oversight={oversight} clientIp={row.client_ip} clientCountry={row.client_country} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-list__pin"
                    title={tr("Mở cửa sổ chat", "打开聊天窗口")}
                    onClick={() => {
                      void api<TaskDetail>(`/api/v1/tasks/${row.id}`)
                        .then((result) => openDockChat(result, true))
                        .catch((caught: unknown) => {
                          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở được cửa sổ chat", "无法打开聊天窗口"), "");
                          if (!failAuth(problem)) {
                            setError(problem);
                          }
                        });
                    }}
                  >
                    <MessageOutlined />
                  </button>
                </div>
              );
            })}
          </aside>
          <div className="chat-pane">
            {detail ? (
              <>
                <header className="chat-pane__head">
                  <div className="chat-pane__who">
                    <span className="chat-avatar" aria-hidden="true">
                      {chatInitial(detail.customer_ref)}
                    </span>
                    <div>
                    <strong>{detail.customer_ref}</strong>
                    <ChatFacts site={detail.member?.site} channel={detail.channel} assignee={detail.assignee_name} status={detail.status} hold={detail.hold} logos={logos} oversight={oversight} clientIp={detail.client_ip} clientCountry={detail.client_country} />
                    </div>
                  </div>
                  <Space wrap>
                    <Button size="small" onClick={() => openDockChat(detail, true)}>
                      {tr("Cửa sổ", "窗口")}
                    </Button>
                    {canHandle && open
                      ? nextStatuses.map((next) => (
                          <Button key={next} size="small" disabled={busy} onClick={() => void changeStatus(next)}>
                            {statusText(next, tr)}
                          </Button>
                        ))
                      : null}
                    {canHandle && open && props.canCancel ? (
                      <Button size="small" danger disabled={busy} onClick={() => void changeStatus("CANCELLED")}>
                        {tr("Hủy", "取消")}
                      </Button>
                    ) : null}
                    {canPull ? (
                      <Button size="small" disabled={busy} onClick={() => void takeBack()}>
                        {tr("Thu về", "收回")}
                      </Button>
                    ) : null}
                    {canGive ? (
                      <Button size="small" type="primary" disabled={busy} onClick={() => void openTransfer()}>
                        {tr("Giao", "分配")}
                      </Button>
                    ) : null}
                    {canMove ? (
                      <Button size="small" disabled={busy} onClick={() => void openTransfer()}>
                        {tr("Chuyển", "转交")}
                      </Button>
                    ) : null}
                  </Space>
                </header>
                <div className="chat-thread" ref={threadRef}>
                  {threadLoading === detail.id && detail.messages.length === 0 ? <p className="chat-empty">{tr("Đang tải tin…", "正在加载消息…")}</p> : null}
                  {detail.messages.map((message, index) => {
                    const mine = message.sender_type === "agent";
                    const kind = message.sender_type === "customer" ? "customer" : message.sender_type === "bot" ? "bot" : "agent";
                    return (
                      <article key={message.id} className={`chat-bubble chat-bubble--${kind}`}>
                        {kind === "bot" ? <span className="chat-who">Bot</span> : null}
                        <ChatBody taskId={detail.id} message={message} />
                        <time>{message.created_at ? formatStamp(message.created_at) : ""}</time>
                        {showReadMark(detail.messages, index, (item) => item.sender_type === "agent") && mine ? <span className="chat-read">{tr("Đã đọc", "已读")}</span> : null}
                      </article>
                    );
                  })}
                </div>
                {error ? <p className="chat-compose__error">{error.message}</p> : null}
                {warning ? <p className="chat-note">{warning}</p> : null}
                {canHandle && open ? (
                  <Form
                    className="chat-compose"
                    onFinish={() => void sendReply()}
                    onPaste={(event) => {
                      const file = imageFromPaste(event.clipboardData);
                      if (!file) {
                        return;
                      }
                      event.preventDefault();
                      if (!busy) {
                        void sendImage(file);
                      }
                    }}
                  >
                    <Input.TextArea
                      value={reply}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      placeholder={detail.channel === "telegram" ? tr("Nhắn khách trên Telegram hoặc dán ảnh", "通过 Telegram 给客户发消息，或粘贴图片") : tr("Nhắn khách hoặc dán ảnh", "给客户发消息或粘贴图片")}
                      onChange={(event) => writeReply(event.target.value)}
                      onCompositionStart={() => {
                        composingRef.current = true;
                      }}
                      onCompositionEnd={(event) => {
                        composingRef.current = false;
                        writeReply(event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) {
                          return;
                        }
                        if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current) {
                          return;
                        }
                        event.preventDefault();
                        void sendReply();
                      }}
                    />
                    <label className="chat-photo-send" title={tr("Gửi ảnh hoặc dán ảnh đã copy", "发送图片或粘贴已复制的图片")} aria-label={tr("Gửi ảnh", "发送图片")}>
                      <PictureOutlined />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) {
                            void sendImage(file);
                          }
                        }}
                      />
                    </label>
                    <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                      {tr("Gửi", "发送")}
                    </Button>
                  </Form>
                ) : canReopen ? (
                  <div className="chat-compose">
                    <p className="chat-note">{tr("Hội thoại Telegram đã đóng. Mở lại để nhắn tiếp.", "Telegram 会话已关闭。重新打开后可继续发送。")}</p>
                    <Button type="primary" loading={busy} onClick={() => void reopenChat()}>
                      {tr("Mở lại", "重新打开")}
                    </Button>
                  </div>
                ) : canPull ? (
                  <p className="chat-note">{tr("Hội thoại đang của nhân viên. Thu về nếu bạn muốn trả lời.", "会话目前由员工负责。如需回复请先收回。")}</p>
                ) : canGive ? (
                  <p className="chat-note">{tr("Chưa có người nhận. Bấm Giao để đưa hội thoại cho nhân viên chăm sóc.", "还没有接收人。点击「分配」，将会话交给关怀员工。")}</p>
                ) : (
                  <p className="chat-closed">{tr("Hội thoại đã đóng.", "会话已关闭。")}</p>
                )}
              </>
            ) : (
              <p className="chat-empty">{tr("Chọn một hội thoại để chat với khách.", "选择一个会话与客户聊天。")}</p>
            )}
          </div>
        </div>
      ) : (
        <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: tr("Không có task.", "没有任务。") }} onRow={(row) => ({ onClick: () => void openTask(row.id) })} />
      )}
      {chatLayout ? null : (
      <Drawer title={detail ? detail.customer_ref : tr("Task", "任务")} open={detail !== null} width={480} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <p className="page-note">
              {oversight ? tr("Đài ", "站点 ") : null}
              {detail.member?.site ? <StationMark code={detail.member.site} logos={logos} /> : oversight ? tr("chưa gắn", "未关联") : null}
              {detail.member?.site || oversight ? " · " : ""}
              {detail.channel === "telegram" ? "Telegram" : "Web"}
              {customerPlace(detail.client_ip, detail.client_country) ? ` · ${customerPlace(detail.client_ip, detail.client_country)}` : ""}
              {detail.campaign_name ? ` · ${detail.campaign_name}` : ""}
              {oversight ? ` · ${detail.assignee_name ? tr(`Đang chăm ${detail.assignee_name}`, `由 ${detail.assignee_name} 负责`) : tr("Chưa giao", "未分配")}` : detail.assignee_name ? ` · ${detail.assignee_name}` : ""} · {statusText(detail.status, tr, detail.hold)}
            </p>
            <div className="task-thread">
              {detail.messages.map((message) => (
                <div key={message.id} className={message.sender_type === "customer" ? "task-line" : "task-line task-line--agent"}>
                  <span>{message.sender_type === "customer" ? tr("Khách", "客户") : message.sender_type === "bot" ? "Bot" : oversight ? detail.assignee_name || tr("Nhân viên", "员工") : tr("Bạn", "我")}</span>
                  <ChatBody taskId={detail.id} message={message} />
                </div>
              ))}
            </div>
            {canHandle && open ? (
              <Form layout="vertical" requiredMark={false} onFinish={() => void sendReply()}>
                <Form.Item label={tr("Câu trả lời", "回复内容")}>
                  <Input.TextArea rows={3} value={reply} onChange={(event) => writeReply(event.target.value)} />
                </Form.Item>
                <Form.Item label={tr("Ghi chú liên hệ", "联系备注")} help={tr("Bắt buộc khi hội thoại đã gắn hội viên.", "会话已绑定会员时必填。")}>
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                    {tr("Gửi", "发送")}
                  </Button>
                  {nextStatuses.map((next) => (
                    <Button key={next} disabled={busy} onClick={() => void changeStatus(next)}>
                      {statusText(next, tr)}
                    </Button>
                  ))}
                  {props.canCancel ? (
                    <Button danger disabled={busy} onClick={() => void changeStatus("CANCELLED")}>
                      {tr("Hủy", "取消")}
                    </Button>
                  ) : null}
                </Space>
              </Form>
            ) : canReopen ? (
              <Button type="primary" loading={busy} onClick={() => void reopenChat()}>
                {tr("Mở lại", "重新打开")}
              </Button>
            ) : open && !canHandle ? (
              <p className="page-note">{tr("Hội thoại đang của nhân viên. Thu về nếu bạn muốn trả lời.", "会话目前由员工负责。如需回复请先收回。")}</p>
            ) : (
              <Tag>{statusText(detail.status, tr, detail.hold)}</Tag>
            )}
            {canGive ? (
              <Button style={{ marginTop: 12 }} disabled={busy} onClick={() => void openTransfer()}>
                {tr("Giao nhân viên", "分配员工")}
              </Button>
            ) : null}
            {canMove ? (
              <Space wrap style={{ marginTop: 12 }}>
                {canPull ? (
                  <Button disabled={busy} onClick={() => void takeBack()}>
                    {tr("Thu về", "收回")}
                  </Button>
                ) : null}
                <Button disabled={busy} onClick={() => void openTransfer()}>
                  {tr("Chuyển", "转交")}
                </Button>
              </Space>
            ) : null}
          </>
        ) : null}
      </Drawer>
      )}
      <Modal
        title={detail?.status === "QUEUED" ? tr("Giao nhân viên", "分配员工") : tr("Chuyển task", "转交任务")}
        open={transferOpen}
        okText={detail?.status === "QUEUED" ? tr("Giao", "分配") : tr("Chuyển", "转交")}
        confirmLoading={busy}
        okButtonProps={{ disabled: !userId || reason.trim().length === 0 }}
        onOk={() => void transfer()}
        onCancel={() => setTransferOpen(false)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label={tr("Người nhận", "接收人")} help={staffLoaded && staff.length === 0 ? tr("Không có nhân viên CSKH hoặc tổ trưởng đang làm.", "没有在岗的客服或组长。") : undefined}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={tr("Chọn nhân viên", "选择员工")}
              value={userId}
              onChange={setUserId}
              options={staff.map((person) => ({
                value: person.id,
                label: person.id === props.selfId ? tr(`${person.display_name} — thu về mình`, `${person.display_name} — 收回给自己`) : person.display_name,
              }))}
            />
          </Form.Item>
          <Form.Item label={tr("Lý do", "原因")}>
            <Input value={reason} maxLength={64} onChange={(event) => setReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function customerPlace(ip?: string | null, country?: string | null): string {
  return [ip?.trim(), country?.trim()].filter((part) => Boolean(part)).join(" · ");
}

function ChatFacts(props: {
  site?: string | null;
  channel: string;
  assignee?: string | null;
  status: string;
  hold?: boolean;
  logos: Set<string>;
  oversight: boolean;
  clientIp?: string | null;
  clientCountry?: string | null;
}) {
  const tr = useTr();
  const channel = props.channel === "telegram" ? "Telegram" : "Web";
  const place = customerPlace(props.clientIp, props.clientCountry);
  return (
    <span className="chat-meta">
      <span className="chat-meta__station">
        {props.oversight ? tr("Đài ", "站点 ") : null}
        {props.site ? <StationMark code={props.site} logos={props.logos} /> : props.oversight ? tr("chưa gắn", "未关联") : channel}
      </span>
      {props.oversight ? <span className="chat-meta__who">{props.assignee ? tr(`Đang chăm ${props.assignee}`, `由 ${props.assignee} 负责`) : tr("Chưa giao", "未分配")}</span> : null}
      {place ? <span className="chat-meta__place">{place}</span> : null}
      <span>
        {props.site || props.oversight ? `${channel} · ` : ""}
        {statusText(props.status, tr, props.hold)}
      </span>
    </span>
  );
}

function StationMark(props: { code: string; logos: Set<string> }) {
  return (
    <span className="station-mark">
      {props.logos.has(props.code) ? <img className="station-logo" src={toApiUrl(`/api/v1/stations/${encodeURIComponent(props.code)}/logo`)} alt="" /> : null}
      {props.code}
    </span>
  );
}
