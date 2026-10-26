import { Button, Form, Input, Typography } from "antd";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";

type Draft = {
  title: string;
  greeting: string;
  customerRef: string;
  conversationId: string;
};

type Bubble = {
  id: string;
  sender: "customer" | "agent" | "system";
  body: string;
  created_at: string;
};

const STORAGE = "cskh.embed-chat";

const SNIPPET = `POST /api/v1/oauth/token
{"grant_type":"client_credentials","client_id":"<client>","client_secret":"<secret>"}

POST /api/v1/integrations/chat/tickets
Authorization: Bearer <access_token>
{"source_conversation_id":"<mã hội thoại>","customer_ref":"<mã khách>"}

WebSocket /api/v1/chat/socket?ticket=<ticket>
{"type":"message","source_message_id":"<mã tin>","body":"Mình cần hỗ trợ"}`;

export function EmbedBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft());
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "down">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string[]>([]);
  const textRef = useRef("");
  const composingRef = useRef(false);
  const lastSentRef = useRef({ body: "", at: 0 });

  useEffect(() => {
    sessionStorage.setItem(STORAGE, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

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

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function newConversation() {
    socketRef.current?.close();
    socketRef.current = null;
    pendingRef.current = [];
    setStatus("idle");
    setMessages([]);
    setError(null);
    patch({ conversationId: newConversationId() });
  }

  async function connect() {
    const customerRef = draft.customerRef.trim();
    const conversationId = draft.conversationId.trim();
    if (customerRef.length === 0 || conversationId.length === 0) {
      setError("Cần mã khách và mã hội thoại.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("connecting");
    pendingRef.current = [];
    socketRef.current?.close();
    try {
      const issued = await api<{ ticket: string }>("/api/v1/admin/chat/tickets", {
        method: "POST",
        body: { source_conversation_id: conversationId, customer_ref: customerRef },
      });
      openCustomer(issued.ticket);
    } catch (caught) {
      setStatus("down");
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không nối được chat", "");
      if (!failAuth(problem)) {
        setError(problem.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function openCustomer(ticket: string) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/chat/socket?ticket=${encodeURIComponent(ticket)}`);
    socketRef.current = socket;
    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket || typeof event.data !== "string") {
        return;
      }
      const frame = readFrame(event.data);
      if (!frame) {
        return;
      }
      if (frame.type === "ready") {
        setStatus("live");
        return;
      }
      if (frame.type === "ack" && frame.message_id) {
        confirmCustomerMessage(frame.message_id, frame.created_at);
        return;
      }
      if (frame.type === "error") {
        const sourceId = pendingRef.current.shift();
        if (sourceId) {
          setMessages((current) => current.filter((item) => item.id !== sourceId));
        }
        setError(frame.message || "Chat từ chối tin");
        return;
      }
      if (frame.type === "message" && frame.message_id && frame.body) {
        const id = frame.message_id;
        const body = frame.body;
        const createdAt = frame.created_at || new Date().toISOString();
        if (frame.sender_type === "agent") {
          setMessages((current) => (current.some((item) => item.id === id) ? current : [...current, { id, sender: "agent", body, created_at: createdAt }]));
          return;
        }
        confirmCustomerMessage(id, createdAt, body);
      }
    });
    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) {
        return;
      }
      socketRef.current = null;
      setStatus("down");
    });
  }

  function confirmCustomerMessage(serverId: string, createdAt?: string, body?: string) {
    setMessages((current) => {
      if (current.some((item) => item.id === serverId)) {
        return current;
      }
      const sourceId = pendingRef.current[0];
      if (sourceId && current.some((item) => item.id === sourceId)) {
        pendingRef.current = pendingRef.current.slice(1);
        return current.map((item) =>
          item.id === sourceId ? { ...item, id: serverId, body: body || item.body, created_at: createdAt || item.created_at } : item,
        );
      }
      if (!body) {
        return current;
      }
      return [...current, { id: serverId, sender: "customer", body, created_at: createdAt || new Date().toISOString() }];
    });
  }

  function writeText(value: string) {
    textRef.current = value;
    setText(value);
  }

  function send() {
    const body = textRef.current.trim();
    const socket = socketRef.current;
    if (!body || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const now = Date.now();
    const previous = lastSentRef.current;
    if (now - previous.at < 500 && (body === previous.body || previous.body.endsWith(` ${body}`))) {
      writeText("");
      return;
    }
    lastSentRef.current = { body, at: now };
    const id = crypto.randomUUID();
    pendingRef.current = [...pendingRef.current, id];
    socket.send(JSON.stringify({ type: "message", source_message_id: id, body }));
    setMessages((current) => [...current, { id, sender: "customer", body, created_at: new Date().toISOString() }]);
    writeText("");
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current) {
      return;
    }
    event.preventDefault();
    send();
  }

  const live = status === "live";

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Chat nhúng
          </Typography.Title>
          <Typography.Text type="secondary">Cấu hình thử hộp thoại khách. Mở Hộp thư hỗ trợ ở tab khác để trả lời.</Typography.Text>
        </div>
      </div>
      <div className="embed-layout">
        <div className="shift-form">
          <Form layout="vertical" requiredMark={false} onFinish={() => void connect()}>
            <Form.Item label="Tiêu đề hộp thoại">
              <Input value={draft.title} maxLength={40} onChange={(event) => patch({ title: event.target.value })} />
            </Form.Item>
            <Form.Item label="Lời chào">
              <Input.TextArea rows={2} value={draft.greeting} maxLength={200} onChange={(event) => patch({ greeting: event.target.value })} />
            </Form.Item>
            <Form.Item label="Mã khách">
              <Input value={draft.customerRef} maxLength={128} onChange={(event) => patch({ customerRef: event.target.value })} />
            </Form.Item>
            <Form.Item label="Mã hội thoại">
              <Input
                value={draft.conversationId}
                maxLength={128}
                onChange={(event) => patch({ conversationId: event.target.value })}
                addonAfter={
                  <button type="button" className="embed-link" onClick={newConversation}>
                    Mã mới
                  </button>
                }
              />
            </Form.Item>
            {error ? <p className="chat-compose__error">{error}</p> : null}
            <Button type="primary" htmlType="submit" loading={busy}>
              {live ? "Nối lại" : "Bắt đầu thử"}
            </Button>
            <Form.Item label="Site nhúng gọi ba bước này">
              <Input.TextArea rows={10} readOnly value={SNIPPET} />
            </Form.Item>
          </Form>
          <p className="page-note">Vé do API cấp từ phiên đang đăng nhập. Vé sống 60 giây và dùng một lần. Mất kết nối thì bấm nối lại, cùng mã hội thoại.</p>
        </div>
        <aside className="embed-widget">
          <header className="embed-widget__head">
            <strong>{draft.title.trim() || "CSKH VIP"}</strong>
            <p>{statusLabel(status)}</p>
          </header>
          <div className="chat-thread" ref={threadRef}>
            {draft.greeting.trim() ? (
              <article className="chat-bubble chat-bubble--agent">
                <p>{draft.greeting.trim()}</p>
              </article>
            ) : null}
            {messages.map((message) => (
              <article key={message.id} className={message.sender === "customer" ? "chat-bubble chat-bubble--customer" : "chat-bubble chat-bubble--agent"}>
                <p>{message.body}</p>
                <time>{formatStamp(message.created_at)}</time>
              </article>
            ))}
          </div>
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Input.TextArea
              value={text}
              disabled={!live}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={live ? "Nhắn nhân viên" : "Bấm Bắt đầu thử trước"}
              onChange={(event) => writeText(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                writeText(event.currentTarget.value);
              }}
              onKeyDown={sendOnEnter}
            />
            <Button type="primary" htmlType="submit" disabled={!live || text.trim().length === 0}>
              Gửi
            </Button>
          </form>
        </aside>
      </div>
    </section>
  );
}

function statusLabel(status: "idle" | "connecting" | "live" | "down"): string {
  if (status === "live") {
    return "Đang nối";
  }
  if (status === "connecting") {
    return "Đang lấy vé…";
  }
  if (status === "down") {
    return "Mất kết nối";
  }
  return "Chưa bắt đầu";
}

function newConversationId(): string {
  return `web-${crypto.randomUUID().slice(0, 8)}`;
}

function loadDraft(): Draft {
  const fallback: Draft = {
    title: "CSKH VIP",
    greeting: "Xin chào, nhân viên sẽ trả lời bạn trong khung này.",
    customerRef: "web-test",
    conversationId: newConversationId(),
  };
  try {
    const raw = sessionStorage.getItem(STORAGE);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : fallback.title,
      greeting: typeof parsed.greeting === "string" ? parsed.greeting : fallback.greeting,
      customerRef: typeof parsed.customerRef === "string" ? parsed.customerRef : fallback.customerRef,
      conversationId: typeof parsed.conversationId === "string" && parsed.conversationId.length > 0 ? parsed.conversationId : fallback.conversationId,
    };
  } catch {
    return fallback;
  }
}

function readFrame(raw: string): { type?: string; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as { type?: string; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string };
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
