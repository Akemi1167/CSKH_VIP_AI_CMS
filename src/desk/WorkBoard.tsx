import { MessageOutlined, PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { ChatBody } from "./ChatBody.tsx";
import { openDockChat, rememberDockChat } from "./chatDock.ts";
import { bindInboxBoard, markInboxRead, noteInboxRows, reportTaskRead, sendStaffReply, setInboxFocus, staffChatLive, useInboxUnread } from "./inboxWatch.ts";
import { showReadMark, withRead } from "../readMark.ts";
import type { LiveChatMessage } from "./staffChat.ts";

type TaskStatus = "ASSIGNED" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "COMPLETED" | "CANCELLED";

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
  first_response: { state: string; due_at: string | null };
  last_message: { body: string; sender_type: string; created_at: string | null } | null;
  member?: { site: string | null } | null;
};

type TaskDetail = TaskRow & {
  messages: { id: string; sender_type: string; body: string; created_at: string; has_image?: boolean; read_at?: string | null }[];
};

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Đã giao",
  IN_PROGRESS: "Đang xử lý",
  WAITING_CUSTOMER: "Chờ khách",
  COMPLETED: "Xong",
  CANCELLED: "Đã hủy",
};

const NEXT_STATUS: Record<string, TaskStatus[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_CUSTOMER", "COMPLETED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "COMPLETED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "COMPLETED"],
};

const SLA_LABEL: Record<string, string> = {
  open: "Đang tính giờ",
  paused: "Tạm dừng",
  met: "Đúng hạn",
  breached: "Trễ",
  unscheduled: "Ngoài ca",
};

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
  if (value === "ASSIGNED" || value === "IN_PROGRESS" || value === "WAITING_CUSTOMER" || value === "COMPLETED" || value === "CANCELLED") {
    return value;
  }
  return fallback;
}

function liveLabel(status: "connecting" | "live" | "down"): string {
  if (status === "live") {
    return "Chat trực tiếp đang mở. Tin của khách giao cho bạn tới ngay.";
  }
  if (status === "connecting") {
    return "Đang nối chat trực tiếp…";
  }
  return "Chưa nối socket. Vẫn gửi được bằng API.";
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
  const oversight = props.scope === "staff" || props.scope === "team";
  const chatLayout = props.layout === "chat";
  const threadRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>(oversight ? "all" : "open");
  const [assigneeId, setAssigneeId] = useState("");
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
  const [reason, setReason] = useState("Chuyển việc");
  const [warning, setWarning] = useState<string | null>(null);
  const [reminders, setReminders] = useState<{ id: string; customer_ref: string; site: string | null; due_on: string }[]>([]);
  const [logos, setLogos] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<"connecting" | "live" | "down">("down");
  const listRef = useRef({ status, assigneeId, ids: new Set<string>() });
  listRef.current = { status, assigneeId, ids: new Set(items.map((row) => row.id)) };
  const unread = useInboxUnread();
  const detailRef = useRef<TaskDetail | null>(null);
  detailRef.current = detail;

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
    const query = params.toString();
    const result = await api<{ items: TaskRow[] }>(`/api/v1/tasks${query ? `?${query}` : ""}`);
    setItems(result.items);
    setError(null);
  }, [props.scope]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(status, assigneeId)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được task", "");
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
  }, [assigneeId, failAuth, load, status]);

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
    setError(null);
    try {
      const result = await api<TaskDetail>(`/api/v1/tasks/${id}`);
      setDetail(result);
      markInboxRead(id);
      reportTaskRead(id);
      if (!keepDraft) {
        writeReply("");
        setCareNote("");
      }
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không mở được task", "");
      if (!failAuth(problem)) {
        setError(problem);
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đổi được trạng thái", "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không mở lại được hội thoại", "");
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
      if (current.messages.some((message) => message.id === event.message_id)) {
        return { ...current, version: event.version || current.version, status: statusNext };
      }
      return {
        ...current,
        version: event.version || current.version,
        status: statusNext,
        messages: [...current.messages, { id: event.message_id, sender_type: event.sender_type, body: event.body, created_at: event.created_at, has_image: event.has_image }],
      };
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", caught instanceof Error ? caught.message : "Không gửi được câu trả lời", "");
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
      setError(new ApiError(400, "validation_error", "Ảnh tối đa 5 MB", ""));
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", "Không gửi được ảnh", "");
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
    setReason("Chuyển việc");
    if (props.scope === "team") {
      if (staff.length > 0) {
        return;
      }
      try {
        const people = await api<{ items: Staff[] }>("/api/v1/team/staff");
        setStaff(people.items);
        setStaffLoaded(true);
      } catch (caught) {
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được nhân viên", "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được nhân viên", "");
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
    setReason("Thu về xử lý");
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await api<AssignResult>(`/api/v1/tasks/${detail.id}/transfer`, {
        method: "POST",
        body: { version: detail.version, to_user_id: props.selfId, reason_code: "Thu về xử lý" },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push("Bạn đang ngoài ca.");
      }
      if (result.over_capacity) {
        notes.push("Bạn đã đủ 8 hội thoại mở.");
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setDetail(null);
      await load(status, assigneeId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không thu được task", "");
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
      const result = await api<AssignResult>(`/api/v1/tasks/${detail.id}/transfer`, {
        method: "POST",
        body: { version: detail.version, to_user_id: userId, reason_code: reason.trim() },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push("Người nhận đang ngoài ca.");
      }
      if (result.over_capacity) {
        notes.push("Người nhận đã đủ 8 hội thoại mở.");
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setTransferOpen(false);
      setDetail(null);
      await load(status, assigneeId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không chuyển được task", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<TaskRow> = [
    ...(oversight ? [{ title: "Nhân viên", dataIndex: "assignee_name", width: 160, ellipsis: true, render: (value: string | null) => value || "—" } satisfies TableColumnsType<TaskRow>[number]] : []),
    ...(oversight ? [{ title: "Đài", width: 120, render: (_, row) => (row.member?.site ? <StationMark code={row.member.site} logos={logos} /> : "—") } satisfies TableColumnsType<TaskRow>[number]] : []),
    { title: "Kênh", dataIndex: "channel", width: 110, render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: "Tin cuối", ellipsis: true, render: (_, row) => row.last_message?.body || "—" },
    { title: "Trạng thái", dataIndex: "status", width: 130, render: (value: string) => STATUS_LABEL[value] ?? value },
    { title: "Hạn trả lời", width: 140, render: (_, row) => SLA_LABEL[row.first_response.state] ?? row.first_response.state },
    { title: "Nhận lúc", dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  const nextStatuses = detail ? (NEXT_STATUS[detail.status] ?? []) : [];
  const open = detail ? nextStatuses.length > 0 : false;
  const canHandle = Boolean(detail && props.canUpdate && (props.canManageAny || detail.assignee_user_id === props.selfId));
  const canReopen = Boolean(detail && props.canUpdate && detail.channel === "telegram" && detail.status === "COMPLETED");
  const canMove = Boolean(props.canTransfer && open && (props.scope === "team" || props.canListStaff));
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
      onStatus: setLive,
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
        .then((result) => setDetail((current) => (current?.id === id ? result : current)))
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
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.heading}
          </Typography.Title>
          <Typography.Text type="secondary">{props.lead}</Typography.Text>
          {chatLayout ? <p className="page-note">{liveLabel(live)}</p> : null}
        </div>
        <Space>
          {oversight && (props.scope === "team" || props.canListStaff) ? (
            <Select
              showSearch
              optionFilterProp="label"
              value={assigneeId || "all"}
              style={{ width: 200 }}
              options={[{ value: "all", label: "Mọi nhân viên" }, ...roster.map((person) => ({ value: person.id, label: person.display_name }))]}
              onChange={(value: string) => setAssigneeId(value === "all" ? "" : value)}
            />
          ) : null}
          <Select
            value={status}
            style={{ width: 160 }}
            onChange={setStatus}
            options={[
              ...(oversight ? [{ value: "all", label: "Mọi trạng thái" }] : [{ value: "open", label: "Đang mở" }]),
              { value: "ASSIGNED", label: "Đã giao" },
              { value: "IN_PROGRESS", label: "Đang xử lý" },
              { value: "WAITING_CUSTOMER", label: "Chờ khách" },
              { value: "COMPLETED", label: "Xong" },
              { value: "CANCELLED", label: "Đã hủy" },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(status, assigneeId).catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được task", ""); if (!failAuth(problem)) setError(problem); })}>
            Tải lại
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
          message="Việc hẹn"
          description={reminders.map((item) => `${item.customer_ref}${item.site ? ` · ${item.site}` : ""} · ${item.due_on.split("-").reverse().join("/")}`).join("\n")}
        />
      ) : null}
      {chatLayout ? (
        <div className="chat-shell">
          <aside className="chat-list">
            {loading && items.length === 0 ? <p className="chat-empty">Đang tải hội thoại…</p> : null}
            {!loading && items.length === 0 ? <p className="chat-empty">Chưa có hội thoại.</p> : null}
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
                      <span className="chat-list__preview">{pending?.body || row.last_message?.body || "Chưa có tin"}</span>
                      <ChatFacts site={row.member?.site} channel={row.channel} assignee={row.assignee_name} status={row.status} logos={logos} oversight={oversight} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-list__pin"
                    title="Mở cửa sổ chat"
                    onClick={() => {
                      void api<TaskDetail>(`/api/v1/tasks/${row.id}`)
                        .then((result) => openDockChat(result, true))
                        .catch((caught: unknown) => {
                          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không mở được cửa sổ chat", "");
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
                    <ChatFacts site={detail.member?.site} channel={detail.channel} assignee={detail.assignee_name} status={detail.status} logos={logos} oversight={oversight} />
                    </div>
                  </div>
                  <Space wrap>
                    <Button size="small" onClick={() => openDockChat(detail, true)}>
                      Cửa sổ
                    </Button>
                    {canHandle && open
                      ? nextStatuses.map((next) => (
                          <Button key={next} size="small" disabled={busy} onClick={() => void changeStatus(next)}>
                            {STATUS_LABEL[next]}
                          </Button>
                        ))
                      : null}
                    {canHandle && open && props.canCancel ? (
                      <Button size="small" danger disabled={busy} onClick={() => void changeStatus("CANCELLED")}>
                        Hủy
                      </Button>
                    ) : null}
                    {canPull ? (
                      <Button size="small" disabled={busy} onClick={() => void takeBack()}>
                        Thu về
                      </Button>
                    ) : null}
                    {canMove ? (
                      <Button size="small" disabled={busy} onClick={() => void openTransfer()}>
                        Chuyển
                      </Button>
                    ) : null}
                  </Space>
                </header>
                <div className="chat-thread" ref={threadRef}>
                  {detail.messages.map((message, index) => {
                    const mine = message.sender_type === "agent";
                    const kind = message.sender_type === "customer" ? "customer" : message.sender_type === "bot" ? "bot" : "agent";
                    return (
                      <article key={message.id} className={`chat-bubble chat-bubble--${kind}`}>
                        {kind === "bot" ? <span className="chat-who">Bot</span> : null}
                        <ChatBody taskId={detail.id} message={message} />
                        <time>{message.created_at ? formatStamp(message.created_at) : ""}</time>
                        {showReadMark(detail.messages, index, (item) => item.sender_type === "agent") && mine ? <span className="chat-read">Đã đọc</span> : null}
                      </article>
                    );
                  })}
                </div>
                {error ? <p className="chat-compose__error">{error.message}</p> : null}
                {warning ? <p className="chat-note">{warning}</p> : null}
                {canHandle && open ? (
                  <Form className="chat-compose" onFinish={() => void sendReply()}>
                    <Input.TextArea
                      value={reply}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      placeholder={detail.channel === "telegram" ? "Nhắn khách trên Telegram" : "Nhắn khách"}
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
                    <label className="chat-photo-send" title="Gửi ảnh" aria-label="Gửi ảnh">
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
                      Gửi
                    </Button>
                  </Form>
                ) : canReopen ? (
                  <div className="chat-compose">
                    <p className="chat-note">Hội thoại Telegram đã đóng. Mở lại để nhắn tiếp.</p>
                    <Button type="primary" loading={busy} onClick={() => void reopenChat()}>
                      Mở lại
                    </Button>
                  </div>
                ) : canPull ? (
                  <p className="chat-note">Hội thoại đang của nhân viên. Thu về nếu bạn muốn trả lời.</p>
                ) : (
                  <p className="chat-closed">Hội thoại đã đóng.</p>
                )}
              </>
            ) : (
              <p className="chat-empty">Chọn một hội thoại để chat với khách.</p>
            )}
          </div>
        </div>
      ) : (
        <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "Không có task." }} onRow={(row) => ({ onClick: () => void openTask(row.id) })} />
      )}
      {chatLayout ? null : (
      <Drawer title={detail ? detail.customer_ref : "Task"} open={detail !== null} width={480} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <p className="page-note">
              {oversight ? "Đài " : null}
              {detail.member?.site ? <StationMark code={detail.member.site} logos={logos} /> : oversight ? "chưa gắn" : null}
              {detail.member?.site || oversight ? " · " : ""}
              {detail.channel === "telegram" ? "Telegram" : "Web"}
              {detail.campaign_name ? ` · ${detail.campaign_name}` : ""}
              {oversight ? ` · ${detail.assignee_name ? `Đang chăm ${detail.assignee_name}` : "Chưa giao"}` : detail.assignee_name ? ` · ${detail.assignee_name}` : ""} · {STATUS_LABEL[detail.status] ?? detail.status}
            </p>
            <div className="task-thread">
              {detail.messages.map((message) => (
                <div key={message.id} className={message.sender_type === "customer" ? "task-line" : "task-line task-line--agent"}>
                  <span>{message.sender_type === "customer" ? "Khách" : message.sender_type === "bot" ? "Bot" : oversight ? detail.assignee_name || "Nhân viên" : "Bạn"}</span>
                  <ChatBody taskId={detail.id} message={message} />
                </div>
              ))}
            </div>
            {canHandle && open ? (
              <Form layout="vertical" requiredMark={false} onFinish={() => void sendReply()}>
                <Form.Item label="Câu trả lời">
                  <Input.TextArea rows={3} value={reply} onChange={(event) => writeReply(event.target.value)} />
                </Form.Item>
                <Form.Item label="Ghi chú liên hệ" help="Bắt buộc khi hội thoại đã gắn hội viên.">
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                    Gửi
                  </Button>
                  {nextStatuses.map((next) => (
                    <Button key={next} disabled={busy} onClick={() => void changeStatus(next)}>
                      {STATUS_LABEL[next]}
                    </Button>
                  ))}
                  {props.canCancel ? (
                    <Button danger disabled={busy} onClick={() => void changeStatus("CANCELLED")}>
                      Hủy
                    </Button>
                  ) : null}
                </Space>
              </Form>
            ) : canReopen ? (
              <Button type="primary" loading={busy} onClick={() => void reopenChat()}>
                Mở lại
              </Button>
            ) : open && !canHandle ? (
              <p className="page-note">Hội thoại đang của nhân viên. Thu về nếu bạn muốn trả lời.</p>
            ) : (
              <Tag>{STATUS_LABEL[detail.status] ?? detail.status}</Tag>
            )}
            {canMove ? (
              <Space wrap style={{ marginTop: 12 }}>
                {canPull ? (
                  <Button disabled={busy} onClick={() => void takeBack()}>
                    Thu về
                  </Button>
                ) : null}
                <Button disabled={busy} onClick={() => void openTransfer()}>
                  Chuyển
                </Button>
              </Space>
            ) : null}
          </>
        ) : null}
      </Drawer>
      )}
      <Modal
        title="Chuyển task"
        open={transferOpen}
        okText="Chuyển"
        confirmLoading={busy}
        okButtonProps={{ disabled: !userId || reason.trim().length === 0 }}
        onOk={() => void transfer()}
        onCancel={() => setTransferOpen(false)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Người nhận" help={staffLoaded && staff.length === 0 ? "Không có nhân viên CSKH hoặc tổ trưởng đang làm." : undefined}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn nhân viên"
              value={userId}
              onChange={setUserId}
              options={staff.map((person) => ({
                value: person.id,
                label: person.id === props.selfId ? `${person.display_name} — thu về mình` : person.display_name,
              }))}
            />
          </Form.Item>
          <Form.Item label="Lý do">
            <Input value={reason} maxLength={64} onChange={(event) => setReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function ChatFacts(props: { site?: string | null; channel: string; assignee?: string | null; status: string; logos: Set<string>; oversight: boolean }) {
  const channel = props.channel === "telegram" ? "Telegram" : "Web";
  return (
    <span className="chat-meta">
      <span className="chat-meta__station">
        {props.oversight ? "Đài " : null}
        {props.site ? <StationMark code={props.site} logos={props.logos} /> : props.oversight ? "chưa gắn" : channel}
      </span>
      {props.oversight ? <span className="chat-meta__who">{props.assignee ? `Đang chăm ${props.assignee}` : "Chưa giao"}</span> : null}
      <span>
        {props.site || props.oversight ? `${channel} · ` : ""}
        {STATUS_LABEL[props.status] ?? props.status}
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
