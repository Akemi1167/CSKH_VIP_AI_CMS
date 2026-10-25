import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

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
};

type TaskDetail = TaskRow & {
  messages: { id: string; sender_type: string; body: string; created_at: string }[];
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

function chatInitial(name: string): string {
  const clean = name.replace(/^tg:/i, "").trim();
  return (clean.slice(0, 1) || "?").toUpperCase();
}

export function WorkBoard(props: {
  heading: string;
  lead: string;
  layout?: "table" | "chat";
  scope?: "own" | "staff";
  canUpdate: boolean;
  canCancel: boolean;
  canTransfer: boolean;
  canListStaff: boolean;
  selfId: string;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const staffScope = props.scope === "staff";
  const chatLayout = props.layout === "chat";
  const threadRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>(staffScope ? "all" : "open");
  const [assigneeId, setAssigneeId] = useState("");
  const [items, setItems] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [reply, setReply] = useState("");
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
    [props],
  );

  const load = useCallback(async (nextStatus: string, nextAssignee: string) => {
    const params = new URLSearchParams();
    if (staffScope) {
      params.set("scope", "staff");
    }
    if (nextStatus !== "open" && nextStatus !== "all") {
      params.set("status", nextStatus);
    }
    if (staffScope && nextAssignee) {
      params.set("assignee_id", nextAssignee);
    }
    const query = params.toString();
    const result = await api<{ items: TaskRow[] }>(`/api/v1/tasks${query ? `?${query}` : ""}`);
    setItems(result.items);
    setError(null);
  }, [staffScope]);

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
    if (!staffScope || !props.canListStaff) {
      return;
    }
    let ignore = false;
    api<{ items: Staff[] }>("/api/v1/admin/staff")
      .then((people) => {
        if (!ignore) {
          setRoster(people.items.filter((person) => person.status === "active"));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [props.canListStaff, staffScope]);

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
      if (!keepDraft) {
        setReply("");
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

  async function sendReply() {
    if (!detail || reply.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const text = reply.trim();
    const note = (careNote.trim() || text).slice(0, 200);
    try {
      await api(`/api/v1/tasks/${detail.id}/messages`, {
        method: "POST",
        body: { version: detail.version, body: text, care_label: "da_lien_he_lai", care_note: note },
      });
      await load(status, assigneeId);
      await openTask(detail.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gửi được câu trả lời", "");
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
    ...(staffScope ? [{ title: "Nhân viên", dataIndex: "assignee_name", width: 160, ellipsis: true, render: (value: string | null) => value || "—" } satisfies TableColumnsType<TaskRow>[number]] : []),
    { title: "Khách", dataIndex: "customer_ref", ellipsis: true },
    { title: "Kênh", dataIndex: "channel", width: 110, render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: "Tin cuối", ellipsis: true, render: (_, row) => row.last_message?.body || "—" },
    { title: "Trạng thái", dataIndex: "status", width: 130, render: (value: string) => STATUS_LABEL[value] ?? value },
    { title: "Hạn trả lời", width: 140, render: (_, row) => SLA_LABEL[row.first_response.state] ?? row.first_response.state },
    { title: "Nhận lúc", dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  const nextStatuses = detail ? (NEXT_STATUS[detail.status] ?? []) : [];
  const open = detail ? nextStatuses.length > 0 : false;

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
    if (!chatLayout || !detail) {
      return;
    }
    const id = detail.id;
    const timer = window.setInterval(() => {
      void api<TaskDetail>(`/api/v1/tasks/${id}`)
        .then((result) => setDetail((current) => (current?.id === id ? result : current)))
        .catch(() => undefined);
      void load(status, assigneeId).catch(() => undefined);
    }, 4000);
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
        </div>
        <Space>
          {staffScope && props.canListStaff ? (
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
              ...(staffScope ? [{ value: "all", label: "Mọi trạng thái" }] : [{ value: "open", label: "Đang mở" }]),
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
              return (
                <button key={row.id} type="button" className={detail?.id === row.id ? "chat-list__item chat-list__item--active" : "chat-list__item"} onClick={() => void openTask(row.id)}>
                  <span className="chat-avatar" aria-hidden="true">
                    {chatInitial(row.customer_ref)}
                  </span>
                  <span className="chat-list__body">
                    <span className="chat-list__top">
                      <strong>{row.customer_ref}</strong>
                      <time>{shortTime(when)}</time>
                    </span>
                    <span className="chat-list__preview">{row.last_message?.body || "Chưa có tin"}</span>
                    <small>
                      {row.channel === "telegram" ? "Telegram" : "Web"}
                      {row.assignee_name ? ` · ${row.assignee_name}` : ""} · {STATUS_LABEL[row.status] ?? row.status}
                    </small>
                  </span>
                </button>
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
                    <p>
                      {detail.channel === "telegram" ? "Telegram" : "Web"}
                      {detail.assignee_name ? ` · ${detail.assignee_name}` : ""} · {STATUS_LABEL[detail.status] ?? detail.status}
                    </p>
                    </div>
                  </div>
                  <Space wrap>
                    {props.canUpdate && open
                      ? nextStatuses.map((next) => (
                          <Button key={next} size="small" loading={busy} onClick={() => void changeStatus(next)}>
                            {STATUS_LABEL[next]}
                          </Button>
                        ))
                      : null}
                    {props.canUpdate && open && props.canCancel ? (
                      <Button size="small" danger loading={busy} onClick={() => void changeStatus("CANCELLED")}>
                        Hủy
                      </Button>
                    ) : null}
                    {props.canUpdate && open && props.canTransfer && props.canListStaff ? (
                      <Button size="small" loading={busy} onClick={() => void openTransfer()}>
                        Chuyển
                      </Button>
                    ) : null}
                  </Space>
                </header>
                <div className="chat-thread" ref={threadRef}>
                  {detail.messages.map((message) => {
                    const mine = message.sender_type !== "customer";
                    return (
                      <article key={message.id} className={mine ? "chat-bubble chat-bubble--agent" : "chat-bubble chat-bubble--customer"}>
                        <p>{message.body}</p>
                        <time>{message.created_at ? formatStamp(message.created_at) : ""}</time>
                      </article>
                    );
                  })}
                </div>
                {error ? <p className="chat-compose__error">{error.message}</p> : null}
                {warning ? <p className="chat-note">{warning}</p> : null}
                {props.canUpdate && open ? (
                  <Form className="chat-compose" onFinish={() => void sendReply()}>
                    <Input.TextArea
                      value={reply}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      placeholder={detail.channel === "telegram" ? "Nhắn khách trên Telegram" : "Nhắn khách"}
                      onChange={(event) => setReply(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendReply();
                        }
                      }}
                    />
                    <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                      Gửi
                    </Button>
                  </Form>
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
              {detail.channel === "telegram" ? "Telegram" : "Web"}
              {detail.campaign_name ? ` · ${detail.campaign_name}` : ""}
              {detail.assignee_name ? ` · ${detail.assignee_name}` : ""} · {STATUS_LABEL[detail.status] ?? detail.status}
            </p>
            <div className="task-thread">
              {detail.messages.map((message) => (
                <p key={message.id} className={message.sender_type === "agent" ? "task-line task-line--agent" : "task-line"}>
                  <span>{message.sender_type === "customer" ? "Khách" : staffScope ? detail.assignee_name || "Nhân viên" : "Bạn"}</span>
                  {message.body}
                </p>
              ))}
            </div>
            {props.canUpdate && open ? (
              <Form layout="vertical" requiredMark={false} onFinish={() => void sendReply()}>
                <Form.Item label="Câu trả lời">
                  <Input.TextArea rows={3} value={reply} onChange={(event) => setReply(event.target.value)} />
                </Form.Item>
                <Form.Item label="Ghi chú liên hệ" help="Bắt buộc khi hội thoại đã gắn hội viên.">
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                    Gửi
                  </Button>
                  {nextStatuses.map((next) => (
                    <Button key={next} loading={busy} onClick={() => void changeStatus(next)}>
                      {STATUS_LABEL[next]}
                    </Button>
                  ))}
                  {props.canCancel ? (
                    <Button danger loading={busy} onClick={() => void changeStatus("CANCELLED")}>
                      Hủy
                    </Button>
                  ) : null}
                  {props.canTransfer && props.canListStaff ? (
                    <Button loading={busy} onClick={() => void openTransfer()}>
                      Chuyển
                    </Button>
                  ) : null}
                </Space>
              </Form>
            ) : (
              <Tag>{STATUS_LABEL[detail.status] ?? detail.status}</Tag>
            )}
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
              options={staff.map((person) => ({ value: person.id, label: person.display_name }))}
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
