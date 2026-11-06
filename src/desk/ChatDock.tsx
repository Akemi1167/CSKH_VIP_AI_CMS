import { CloseOutlined, MinusOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ChatBody } from "./ChatBody.tsx";
import { bindInboxBoard, markInboxRead, sendStaffReply, staffChatLive } from "./inboxWatch.ts";
import { applyDockLiveMessage, applyDockLiveTask, closeDockChat, replaceDockTask, seedDockBubble, setDockDraft, setDockExpanded, useChatDock, type DockMessage, type DockTask } from "./chatDock.ts";

const OPEN_STATUS = new Set(["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER"]);

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Đã giao",
  IN_PROGRESS: "Đang xử lý",
  WAITING_CUSTOMER: "Chờ khách",
  COMPLETED: "Xong",
  CANCELLED: "Đã hủy",
};

const NEXT_STATUS: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_CUSTOMER", "COMPLETED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "COMPLETED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "COMPLETED"],
};

function guestName(task: DockTask): string {
  const account = task.member?.game_account?.trim();
  if (account) {
    return account;
  }
  const display = task.member?.display_name?.trim();
  if (display) {
    return display;
  }
  return task.customer_ref.replace(/^tg:/i, "").trim() || "Khách";
}

function guestFacts(task: DockTask): string {
  const channel = task.channel === "telegram" ? "Telegram" : "Web";
  const site = task.member?.site ? `Đài ${task.member.site}` : "";
  const status = STATUS_LABEL[task.status] ?? task.status;
  return [site, channel, status].filter(Boolean).join(" · ");
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
  const windows = useChatDock();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pageRef = useRef(props.page);
  const scopeRef = useRef(props.scope);
  pageRef.current = props.page;
  scopeRef.current = props.scope;

  useEffect(() => {
    return bindInboxBoard({
      onStatus: () => undefined,
      onMessage: (event) => {
        if (scopeRef.current === "own" && pageRef.current !== "inbox" && event.sender_type === "customer") {
          seedDockBubble(event);
          return;
        }
        applyDockLiveMessage(event);
      },
      onTask: (event) => applyDockLiveTask(event),
      onRefresh: () => undefined,
    });
  }, []);

  if (windows.length === 0) {
    return null;
  }

  function fail(id: string, caught: unknown) {
    const problem = caught instanceof ApiError ? caught : new ApiError(0, "chat", caught instanceof Error ? caught.message : "Không gửi được", "");
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

  return (
    <div className="chat-dock">
      {windows.map((chat) => {
        const open = OPEN_STATUS.has(chat.task.status);
        const canHandle = props.canUpdate && open && (props.canManageAny || chat.task.assignee_user_id === props.selfId);
        const name = guestName(chat.task);
        const nextStatuses = NEXT_STATUS[chat.task.status] ?? [];
        if (!chat.expanded) {
          return (
            <button
              key={chat.task.id}
              type="button"
              className="chat-dock__bubble"
              title={guestFacts(chat.task)}
              onClick={() => {
                setDockExpanded(chat.task.id, true);
                markInboxRead(chat.task.id);
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
          <section key={chat.task.id} className="chat-dock__window">
            <header className="chat-dock__head">
              <div className="chat-dock__who">
                <span className="chat-avatar" aria-hidden="true">
                  {initial(name)}
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{guestFacts(chat.task)}</small>
                </span>
              </div>
              <div className="chat-dock__tools">
                <button type="button" title="Thu nhỏ" onClick={() => setDockExpanded(chat.task.id, false)}>
                  <MinusOutlined />
                </button>
                <button type="button" title="Đóng" onClick={() => closeDockChat(chat.task.id)}>
                  <CloseOutlined />
                </button>
              </div>
            </header>
            {canHandle && nextStatuses.length > 0 ? (
              <div className="chat-dock__actions">
                {nextStatuses.map((status) => (
                  <Button key={status} size="small" loading={busyId === chat.task.id} onClick={() => void setStatus(chat.task.id, chat.task.version, status)}>
                    {STATUS_LABEL[status] ?? status}
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
              >
                <Input.TextArea
                  value={chat.draft}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  placeholder={chat.task.channel === "telegram" ? "Nhắn khách trên Telegram" : "Nhắn khách"}
                  onChange={(event) => setDockDraft(chat.task.id, event.target.value)}
                  onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                      return;
                    }
                    event.preventDefault();
                    void send(chat.task.id, chat.task, chat.draft);
                  }}
                />
                <Button type="primary" htmlType="submit" loading={busyId === chat.task.id} disabled={chat.draft.trim().length === 0}>
                  Gửi
                </Button>
              </form>
            ) : (
              <p className="chat-dock__note">{open ? "Hội thoại đang của nhân viên khác." : "Hội thoại đã đóng."}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DockThread(props: { taskId: string; messages: DockMessage[] }) {
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
      {props.messages.map((message) => {
        const mine = message.sender_type !== "customer";
        return (
          <article key={message.id} className={mine ? "chat-bubble chat-bubble--agent" : "chat-bubble chat-bubble--customer"}>
            <ChatBody taskId={props.taskId} message={message} />
            <time>{message.created_at ? formatStamp(message.created_at) : ""}</time>
          </article>
        );
      })}
    </div>
  );
}
