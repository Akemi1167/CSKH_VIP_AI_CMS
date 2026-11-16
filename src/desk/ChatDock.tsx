import { CloseOutlined, MinusOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api } from "../api.ts";
import { imageFromPaste } from "../clipboardImage.ts";
import { formatStamp } from "../copy.ts";
import { ChatBody } from "./ChatBody.tsx";
import { bindInboxBoard, markInboxRead, reportTaskRead, sendStaffReply, staffChatLive } from "./inboxWatch.ts";
import { applyDockLiveMessage, applyDockLiveTask, applyDockRead, closeDockChat, noteDockFocus, replaceDockTask, seedDockBubble, setDockDraft, setDockExpanded, useChatDock, type DockMessage, type DockTask } from "./chatDock.ts";
import { showReadMark } from "../readMark.ts";
import { useTr } from "./language.tsx";

const OPEN_STATUS = new Set(["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER"]);

const NEXT_STATUS: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_CUSTOMER", "COMPLETED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "COMPLETED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "COMPLETED"],
};

function statusText(status: string, tr: (vi: string, zh: string) => string): string {
  switch (status) {
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

function guestName(task: DockTask, tr: (vi: string, zh: string) => string): string {
  const account = task.member?.game_account?.trim();
  if (account) {
    return account;
  }
  const display = task.member?.display_name?.trim();
  if (display) {
    return display;
  }
  return task.customer_ref.replace(/^tg:/i, "").trim() || tr("Khách", "客户");
}

function guestFacts(task: DockTask, tr: (vi: string, zh: string) => string): string {
  const channel = task.channel === "telegram" ? "Telegram" : "Web";
  const site = task.member?.site ? `${tr("Đài", "站点")} ${task.member.site}` : "";
  const status = statusText(task.status, tr);
  return [site, channel, status].filter(Boolean).join(" · ");
}

function guestPlace(task: DockTask): string {
  return [task.client_ip?.trim(), task.client_country?.trim()].filter((part) => Boolean(part)).join(" · ");
}

function guestWhere(task: DockTask, tr: (vi: string, zh: string) => string): string {
  return [guestFacts(task, tr), guestPlace(task)].filter(Boolean).join(" · ");
}

function initial(name: string): string {
  return (name.trim().slice(0, 1) || "?").toUpperCase();
}

export function ChatDock(props: {
  page: string;
  scope: "own" | "staff" | "team";
  canUpdate: boolean;
  canManageAny: boolean;
  selfId: string;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const windows = useChatDock();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pageRef = useRef(props.page);
  const scopeRef = useRef(props.scope);
  const caretRef = useRef<{ el: HTMLTextAreaElement; start: number; end: number } | null>(null);
  pageRef.current = props.page;
  scopeRef.current = props.scope;

  useLayoutEffect(() => {
    const caret = caretRef.current;
    caretRef.current = null;
    if (!caret?.el.isConnected || document.activeElement === caret.el) {
      return;
    }
    caret.el.focus({ preventScroll: true });
    caret.el.setSelectionRange(caret.start, caret.end);
  });

  useEffect(() => {
    return bindInboxBoard({
      onStatus: () => undefined,
      onMessage: (event) => {
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement) {
          caretRef.current = { el: active, start: active.selectionStart ?? active.value.length, end: active.selectionEnd ?? active.value.length };
        }
        if (scopeRef.current === "own" && pageRef.current !== "inbox" && event.sender_type === "customer") {
          seedDockBubble(event);
          return;
        }
        applyDockLiveMessage(event);
      },
      onRead: (event) => applyDockRead(event.task_id, event.message_ids, event.read_at),
      onTask: (event) => applyDockLiveTask(event),
      onRefresh: () => undefined,
    });
  }, []);

  if (windows.length === 0) {
    return null;
  }

  function fail(id: string, caught: unknown) {
    const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", caught instanceof Error ? caught.message : tr("Không gửi được", "无法发送"), "");
    if (problem.status === 401) {
      props.onUnauthorized();
      return;
    }
    if (problem.code === "mfa_setup_required") {
      props.onMfaSetup();
      return;
    }
    setErrors((current) => ({ ...current, [id]: problem.message }));
  }

  async function setStatus(id: string, version: number, status: string) {
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      await api(`/api/v1/tasks/${id}`, { method: "PATCH", body: { version, status } });
      await refresh(id);
    } catch (caught) {
      fail(id, caught);
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(id: string, version: number) {
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      await api(`/api/v1/tasks/${id}/reopen`, { method: "POST", body: { version } });
      await refresh(id);
    } catch (caught) {
      fail(id, caught);
    } finally {
      setBusyId(null);
    }
  }

  async function refresh(id: string) {
    try {
      const task = await api<DockTask>(`/api/v1/tasks/${id}`);
      replaceDockTask(task);
    } catch (caught) {
      fail(id, caught);
    }
  }

  async function send(id: string, task: DockTask, draft: string) {
    const text = draft.trim();
    if (text.length === 0 || busyId) {
      return;
    }
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    const note = text.slice(0, 200);
    try {
      if (staffChatLive()) {
        const ack = await sendStaffReply({ task_id: id, version: task.version, body: text, care_note: note });
        setDockDraft(id, "");
        replaceDockTask({
          ...task,
          version: ack.version || task.version,
          status: ack.task_status || task.status,
          messages: task.messages.some((message) => message.id === ack.message_id)
            ? task.messages
            : [...task.messages, { id: ack.message_id, sender_type: "agent", body: text, created_at: new Date().toISOString() }],
        });
        return;
      }
      await api(`/api/v1/tasks/${id}/messages`, {
        method: "POST",
        body: { version: task.version, body: text, care_label: "da_lien_he_lai", care_note: note },
      });
      setDockDraft(id, "");
      await refresh(id);
    } catch (caught) {
      fail(id, caught);
    } finally {
      setBusyId(null);
    }
  }

  async function sendImage(id: string, task: DockTask, file: File, caption: string) {
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setErrors((current) => ({ ...current, [id]: tr("Ảnh tối đa 5 MB", "图片不能超过 5 MB") }));
      return;
    }
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    const params = new URLSearchParams({ version: String(task.version) });
    if (caption.trim()) {
      params.set("caption", caption.trim());
    }
    try {
      const saved = await api<{ message_id: string; version: number; status: string; body: string }>(`/api/v1/tasks/${id}/images?${params}`, {
        method: "POST",
        body: file,
      });
      setDockDraft(id, "");
      replaceDockTask({
        ...task,
        version: saved.version || task.version,
        status: saved.status || task.status,
        messages: task.messages.some((message) => message.id === saved.message_id)
          ? task.messages
          : [...task.messages, { id: saved.message_id, sender_type: "agent", body: saved.body, created_at: new Date().toISOString(), has_image: true }],
      });
    } catch (caught) {
      fail(id, caught);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="chat-dock">
      {windows.map((chat) => {
        const open = OPEN_STATUS.has(chat.task.status);
        const canHandle = props.canUpdate && open && (props.canManageAny || chat.task.assignee_user_id === props.selfId);
        const canReopen = props.canUpdate && chat.task.channel === "telegram" && chat.task.status === "COMPLETED" && (props.canManageAny || !chat.task.assignee_user_id || chat.task.assignee_user_id === props.selfId);
        const name = guestName(chat.task, tr);
        const nextStatuses = NEXT_STATUS[chat.task.status] ?? [];
        if (!chat.expanded) {
          return (
            <button
              key={chat.task.id}
              type="button"
              className={chat.alert ? "chat-dock__bubble chat-dock__bubble--alert" : "chat-dock__bubble"}
              title={chat.alert ? `${tr("Tin mới", "新消息")} · ${guestWhere(chat.task, tr)}` : guestWhere(chat.task, tr)}
              onClick={() => {
                setDockExpanded(chat.task.id, true);
                markInboxRead(chat.task.id);
                reportTaskRead(chat.task.id);
                void refresh(chat.task.id);
              }}
            >
              <span className="chat-avatar" aria-hidden="true">
                {initial(name)}
              </span>
              <strong>{name}</strong>
              {chat.unread > 0 ? <span className="chat-dock__badge">{chat.unread}</span> : null}
            </button>
          );
        }
        return (
          <section key={chat.task.id} className={chat.alert ? "chat-dock__window chat-dock__window--alert" : "chat-dock__window"}>
            <header className="chat-dock__head">
              <div className="chat-dock__who">
                <span className="chat-avatar" aria-hidden="true">
                  {initial(name)}
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>
                    {guestFacts(chat.task, tr)}
                    {guestPlace(chat.task) ? <span className="chat-dock__place">{guestPlace(chat.task)}</span> : null}
                  </small>
                  {chat.alert ? <em className="chat-dock__new">{tr("Tin mới", "新消息")}</em> : null}
                </span>
              </div>
              <div className="chat-dock__tools">
                <button type="button" title={tr("Thu nhỏ", "最小化")} onClick={() => setDockExpanded(chat.task.id, false)}>
                  <MinusOutlined />
                </button>
                <button type="button" title={tr("Đóng", "关闭")} onClick={() => closeDockChat(chat.task.id)}>
                  <CloseOutlined />
                </button>
              </div>
            </header>
            {canHandle && nextStatuses.length > 0 ? (
              <div className="chat-dock__actions">
                {nextStatuses.map((status) => (
                  <Button key={status} size="small" disabled={busyId === chat.task.id} onClick={() => void setStatus(chat.task.id, chat.task.version, status)}>
                    {statusText(status, tr)}
                  </Button>
                ))}
              </div>
            ) : null}
            <DockThread taskId={chat.task.id} messages={chat.task.messages} />
            {errors[chat.task.id] ? <p className="chat-dock__error">{errors[chat.task.id]}</p> : null}
            {canHandle ? (
              <form
                className="chat-dock__compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(chat.task.id, chat.task, chat.draft);
                }}
                onPaste={(event) => {
                  const file = imageFromPaste(event.clipboardData);
                  if (!file) {
                    return;
                  }
                  event.preventDefault();
                  if (busyId !== chat.task.id) {
                    void sendImage(chat.task.id, chat.task, file, chat.draft);
                  }
                }}
              >
                <Input.TextArea
                  value={chat.draft}
                  rows={2}
                  placeholder={chat.task.channel === "telegram" ? tr("Nhắn khách trên Telegram hoặc dán ảnh", "通过 Telegram 给客户发消息，或粘贴图片") : tr("Nhắn khách hoặc dán ảnh", "给客户发消息或粘贴图片")}
                  onFocus={() => noteDockFocus(chat.task.id)}
                  onBlur={() => noteDockFocus(null)}
                  onChange={(event) => setDockDraft(chat.task.id, event.target.value)}
                  onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                      return;
                    }
                    event.preventDefault();
                    void send(chat.task.id, chat.task, chat.draft);
                  }}
                />
                <label className="chat-photo-send" title={tr("Gửi ảnh hoặc dán ảnh đã copy", "发送图片或粘贴已复制的图片")} aria-label={tr("Gửi ảnh", "发送图片")}>
                  <PictureOutlined />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={busyId === chat.task.id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) {
                        void sendImage(chat.task.id, chat.task, file, chat.draft);
                      }
                    }}
                  />
                </label>
                <Button type="primary" htmlType="submit" loading={busyId === chat.task.id} disabled={chat.draft.trim().length === 0}>
                  {tr("Gửi", "发送")}
                </Button>
              </form>
            ) : (
              <>
                {canReopen ? (
                  <div className="chat-dock__actions">
                    <Button size="small" type="primary" loading={busyId === chat.task.id} onClick={() => void reopen(chat.task.id, chat.task.version)}>
                      {tr("Mở lại", "重新打开")}
                    </Button>
                  </div>
                ) : null}
                <p className="chat-dock__note">{open ? tr("Hội thoại đang của nhân viên khác.", "会话目前由其他员工负责。") : canReopen ? tr("Hội thoại Telegram đã đóng. Mở lại để nhắn tiếp.", "Telegram 会话已关闭。重新打开后可继续发送。") : tr("Hội thoại đã đóng.", "会话已关闭。")}</p>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DockThread(props: { taskId: string; messages: DockMessage[] }) {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);
  const last = props.messages.at(-1)?.id;
  useEffect(() => {
    const node = ref.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [last, props.messages.length]);
  return (
    <div className="chat-dock__thread" ref={ref}>
      {props.messages.map((message, index) => {
        const kind = message.sender_type === "customer" ? "customer" : message.sender_type === "bot" ? "bot" : "agent";
        return (
          <article key={message.id} className={`chat-bubble chat-bubble--${kind}`}>
            {kind === "bot" ? <span className="chat-who">Bot</span> : null}
            <ChatBody taskId={props.taskId} message={message} />
            <time>{message.created_at ? formatStamp(message.created_at) : ""}</time>
            {showReadMark(props.messages, index, (item) => item.sender_type === "agent") ? <span className="chat-read">{tr("Đã đọc", "已读")}</span> : null}
          </article>
        );
      })}
    </div>
  );
}
