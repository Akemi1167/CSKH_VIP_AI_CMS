import { PictureOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api, toApiUrl, toWsUrl } from "../api.ts";
import { formatStamp } from "../copy.ts";

type Bubble = {
  id: string;
  sender: "customer" | "agent";
  body: string;
  created_at: string;
  image_url?: string;
};

type GuestSession = {
  conversationId: string;
  name: string;
};

type GuestTicket = {
  ticket: string;
  upload_token: string;
  conversation_id: string;
  messages: Bubble[];
};

const STORAGE = "cskh.guest-chat";
const stationCode = readStation();
const GREETING = "Xin chào. Nhân viên sẽ trả lời bạn trong khung này.";

export function GuestChat() {
  const saved = useRef(loadSession());
  const [name, setName] = useState(saved.current?.name ?? "");
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"form" | "connecting" | "live" | "down">(saved.current ? "connecting" : "form");
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string[]>([]);
  const textRef = useRef("");
  const composingRef = useRef(false);
  const lastSentRef = useRef({ body: "", at: 0 });
  const uploadTokenRef = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);

  const connect = useCallback(async (session: GuestSession) => {
    setStatus("connecting");
    setError(null);
    pendingRef.current = [];
    socketRef.current?.close();
    try {
      const issued = await api<GuestTicket>("/api/v1/chat/guest", {
        method: "POST",
        body: { name: session.name, conversation_id: session.conversationId || undefined },
      });
      const next = { conversationId: issued.conversation_id, name: session.name };
      saved.current = next;
      localStorage.setItem(STORAGE, JSON.stringify(next));
      uploadTokenRef.current = issued.upload_token;
      setMessages(issued.messages);
      openSocket(issued.ticket);
    } catch (caught) {
      setStatus("down");
      setError(caught instanceof ApiError ? caught.message : "Không nối được chat");
    }
  }, []);

  useEffect(() => {
    document.title = stationCode ? `Liên hệ · ${stationCode}` : "Liên hệ · CSKH VIP";
    if (saved.current) {
      void connect(saved.current);
    }
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, status]);

  function openSocket(ticket: string) {
    const socket = new WebSocket(toWsUrl(`/api/v1/chat/socket?ticket=${encodeURIComponent(ticket)}`));
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
        confirmCustomerMessage(frame.message_id, frame.created_at, undefined, frame.image_url);
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
      if (frame.type === "message" && frame.message_id && frame.sender_type === "agent" && (frame.body || frame.image_url)) {
        const id = frame.message_id;
        const body = frame.body || "";
        const createdAt = frame.created_at || new Date().toISOString();
        const imageUrl = frame.image_url;
        setMessages((current) => (current.some((item) => item.id === id) ? current : [...current, { id, sender: "agent", body, created_at: createdAt, image_url: imageUrl }]));
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

  function confirmCustomerMessage(serverId: string, createdAt?: string, body?: string, imageUrl?: string) {
    setMessages((current) => {
      if (current.some((item) => item.id === serverId)) {
        return current;
      }
      const sourceId = pendingRef.current[0];
      if (sourceId && current.some((item) => item.id === sourceId)) {
        pendingRef.current = pendingRef.current.slice(1);
        return current.map((item) =>
          item.id === sourceId ? { ...item, id: serverId, body: body || item.body, image_url: imageUrl || item.image_url, created_at: createdAt || item.created_at } : item,
        );
      }
      if (!body && !imageUrl) {
        return current;
      }
      return [...current, { id: serverId, sender: "customer", body: body || "", created_at: createdAt || new Date().toISOString(), image_url: imageUrl }];
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

  async function sendImage(file: File) {
    const socket = socketRef.current;
    const token = uploadTokenRef.current;
    if (!token || !socket || socket.readyState !== WebSocket.OPEN) {
      setError("Chưa nối được chat.");
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      setError("Chỉ gửi ảnh PNG, JPEG, WEBP hoặc GIF, tối đa 5 MB.");
      return;
    }
    setError(null);
    try {
      const saved = await api<{ media_id: string; url: string }>("/api/v1/chat/guest/images", {
        method: "POST",
        body: file,
        headers: { "x-chat-upload": token },
      });
      const caption = textRef.current.trim();
      const id = crypto.randomUUID();
      pendingRef.current = [...pendingRef.current, id];
      socket.send(JSON.stringify({ type: "message", source_message_id: id, media_id: saved.media_id, ...(caption ? { body: caption } : {}) }));
      setMessages((current) => [...current, { id, sender: "customer", body: caption, created_at: new Date().toISOString(), image_url: saved.url }]);
      writeText("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Không gửi được ảnh");
    }
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

  function start() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Nhập tên của bạn.");
      return;
    }
    void connect({ conversationId: saved.current?.conversationId ?? "", name: trimmed });
  }

  const live = status === "live";
  const started = status !== "form";

  return (
    <div className="guest-page">
      <section className="guest-card">
        <header className="embed-widget__head">
          {stationCode ? (
            <img
              className="station-logo"
              src={toApiUrl(`/api/v1/stations/${encodeURIComponent(stationCode)}/logo`)}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <div>
            <strong>{stationCode || "CSKH VIP"}</strong>
            <p>{started ? statusLabel(status) : "Liên hệ nhân viên"}</p>
          </div>
        </header>
        {started ? (
          <>
            <div className="chat-thread" ref={threadRef}>
              <article className="chat-bubble chat-bubble--agent">
                <p>{GREETING}</p>
              </article>
              {messages.map((message) => {
                const caption = message.image_url && (message.body === "Khách gửi ảnh." || message.body === "Đã gửi ảnh.") ? "" : message.body;
                return (
                  <article key={message.id} className={message.sender === "customer" ? "chat-bubble chat-bubble--customer" : "chat-bubble chat-bubble--agent"}>
                    {message.image_url ? <img className="chat-photo" alt="" src={message.image_url} /> : null}
                    {caption ? <p>{caption}</p> : null}
                    <time>{formatStamp(message.created_at)}</time>
                  </article>
                );
              })}
            </div>
            {error ? <p className="chat-compose__error">{error}</p> : null}
            {status === "down" ? (
              <div className="guest-retry">
                <Button type="primary" onClick={() => saved.current && void connect(saved.current)}>
                  Nối lại
                </Button>
              </div>
            ) : (
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="chat-photo-send" title="Gửi ảnh" aria-label="Gửi ảnh">
                  <PictureOutlined />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={!live}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void sendImage(file);
                      }
                    }}
                  />
                </label>
                <Input.TextArea
                  value={text}
                  disabled={!live}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  placeholder={live ? "Nhắn nhân viên" : "Đang nối…"}
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
            )}
          </>
        ) : (
          <form
            className="guest-start"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <p>{GREETING}</p>
            <Input value={name} maxLength={40} placeholder="Tên của bạn" onChange={(event) => setName(event.target.value)} />
            {error ? <p className="chat-compose__error">{error}</p> : null}
            <Button type="primary" htmlType="submit">
              Bắt đầu chat
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: "connecting" | "live" | "down"): string {
  if (status === "live") {
    return "Đang nối";
  }
  if (status === "connecting") {
    return "Đang nối…";
  }
  return "Mất kết nối";
}

function readStation(): string {
  const value = new URLSearchParams(window.location.search).get("dai")?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{2,16}$/.test(value) ? value : "";
}

function loadSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<GuestSession>;
    if (typeof parsed.name !== "string" || typeof parsed.conversationId !== "string" || parsed.name.trim().length < 2) {
      return null;
    }
    return { name: parsed.name.trim(), conversationId: parsed.conversationId };
  } catch {
    return null;
  }
}

function readFrame(raw: string): { type?: string; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string; image_url?: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as { type?: string; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string; image_url?: string };
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
