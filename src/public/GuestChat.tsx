import { PictureOutlined } from "@ant-design/icons";
import { Button, Input, Select } from "antd";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api, toApiUrl, toWsUrl } from "../api.ts";
import { imageFromPaste } from "../clipboardImage.ts";
import { formatStamp } from "../copy.ts";
import { showReadMark, withRead } from "../readMark.ts";
import { UiFrame } from "../uiFrame.tsx";

type Bubble = {
  id: string;
  sender: "customer" | "agent";
  body: string;
  created_at: string;
  image_url?: string;
  read_at?: string | null;
};

type GuestSession = {
  conversationId: string;
  account: string;
  site: string;
  invite?: string;
};

type GuestAgent = {
  display_name: string;
  avatar_url?: string | null;
};

type GuestTicket = {
  ticket: string;
  upload_token: string;
  conversation_id: string;
  messages: Bubble[];
  agent?: GuestAgent | null;
};

const STORAGE = "cskh.guest-chat";
const LANG_STORAGE = "cskh.guest-lang";
const stationCode = readStation();

type GuestLang = "vi" | "zh";

const COPY = {
  vi: {
    title: "Liên hệ",
    contact: "Liên hệ nhân viên",
    greeting: "Nhập tài khoản game và đài. Khớp hồ sơ thì nhân viên nhận việc. Không khớp thì hội thoại vào mục xác minh tài khoản.",
    account: "Tài khoản game",
    accountError: "Nhập tài khoản game, từ 3 đến 32 ký tự.",
    site: "Đài",
    siteError: "Chọn đài.",
    start: "Xác minh và chat",
    matched: "Đã xác minh tài khoản {account} tại đài {site}. Nhân viên sẽ hỗ trợ bạn.",
    unknown: "Chưa thấy tài khoản này tại đài đã chọn. Hội thoại được chuyển tới mục xác minh tài khoản.",
    welcome: "Nhân viên sẽ trả lời bạn trong khung này.",
    placeholder: "Nhắn nhân viên hoặc dán ảnh",
    connecting: "Đang nối…",
    live: "Đang nối",
    chatting: "Đang chat với {name}",
    joined: "{name} đã kết nối",
    down: "Mất kết nối",
    retry: "Nối lại",
    send: "Gửi",
    photo: "Gửi ảnh hoặc dán ảnh đã copy",
    imageError: "Không gửi được ảnh",
    closed: "Hội thoại cũ đã đóng. Đây là cuộc chat mới.",
    connectError: "Không nối được chat",
    read: "Đã đọc",
  },
  zh: {
    title: "联系客服",
    contact: "联系客服",
    greeting: "请输入游戏账号和站点。资料匹配后客服会接单。不匹配则进入账号核实。",
    account: "游戏账号",
    accountError: "请输入 3 到 32 位游戏账号。",
    site: "站点",
    siteError: "请选择站点。",
    start: "核实并开始",
    matched: "已核实账号 {account}，站点 {site}。客服将为您处理。",
    unknown: "所选站点未找到该账号。会话已转入账号核实。",
    welcome: "客服会在此窗口回复您。",
    placeholder: "给客服发消息或粘贴图片",
    connecting: "连接中…",
    live: "已连接",
    chatting: "正在与 {name} 聊天",
    joined: "{name} 已接入",
    down: "连接已断开",
    retry: "重新连接",
    send: "发送",
    photo: "发送图片或粘贴已复制的图片",
    imageError: "图片发送失败",
    closed: "旧会话已关闭。这是一次新的聊天。",
    connectError: "无法连接聊天",
    read: "已读",
  },
} as const;

export function GuestChat() {
  const saved = useRef(loadSession());
  const [account, setAccount] = useState(saved.current?.account ?? "");
  const [site, setSite] = useState(saved.current?.site || stationCode);
  const [stations, setStations] = useState<string[]>(stationCode ? [stationCode] : []);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"form" | "connecting" | "live" | "down">(saved.current ? "connecting" : "form");
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<GuestAgent | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [avatarTick, setAvatarTick] = useState(0);
  const [lang, setLang] = useState<GuestLang>(loadLang);
  const threadRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string[]>([]);
  const textRef = useRef("");
  const composingRef = useRef(false);
  const lastSentRef = useRef({ body: "", at: 0 });
  const uploadTokenRef = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imageBusy = useRef(false);
  const agentNameRef = useRef("");

  const connect = useCallback(async (session: GuestSession) => {
    setStatus("connecting");
    setError(null);
    pendingRef.current = [];
    socketRef.current?.close();
    try {
      const issued = await api<GuestTicket & { verified?: boolean; account?: string; site?: string }>("/api/v1/chat/guest", {
        method: "POST",
        body: {
          account: session.account,
          site: session.site,
          conversation_id: session.conversationId || undefined,
          invite: session.invite || undefined,
        },
      });
      const next = {
        conversationId: issued.conversation_id,
        account: issued.account || session.account,
        site: issued.site || session.site,
        invite: session.invite,
      };
      const note = COPY[langRef.current];
      setCheckNote(
        (issued.verified ? note.matched : note.unknown)
          .replace("{account}", next.account)
          .replace("{site}", next.site),
      );
      saved.current = next;
      localStorage.setItem(STORAGE, JSON.stringify(next));
      uploadTokenRef.current = issued.upload_token;
      setMessages(issued.messages);
      setAgent(issued.agent?.display_name ? issued.agent : null);
      agentNameRef.current = issued.agent?.display_name ?? "";
      setJoined(null);
      openSocket(issued.ticket);
    } catch (caught) {
      setStatus(saved.current ? "down" : "form");
      setError(caught instanceof ApiError ? caught.message : COPY[langRef.current].connectError);
    }
  }, []);

  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    document.title = stationCode ? `${COPY[lang].title} · ${stationCode}` : `${COPY[lang].title} · CSKH VIP`;
  }, [lang]);

  useEffect(() => {
    if (saved.current) {
      void connect(saved.current);
    }
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    let ignore = false;
    api<{ stations: { code: string }[] }>("/api/v1/public/home")
      .then((result) => {
        if (!ignore) {
          setStations(result.stations.map((item) => item.code));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

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
        if (frame.code === "conversation_closed") {
          pendingRef.current = [];
          setAgent(null);
          setJoined(null);
          agentNameRef.current = "";
          const session = saved.current;
          if (session) {
            const fresh = { ...session, conversationId: "" };
            saved.current = fresh;
            localStorage.setItem(STORAGE, JSON.stringify(fresh));
            setMessages([]);
            void connect(fresh).then(() => setError(COPY[langRef.current].closed));
          }
          return;
        }
        const sourceId = pendingRef.current.shift();
        if (sourceId) {
          setMessages((current) => current.filter((item) => item.id !== sourceId));
        }
        setError(frame.message || "Chat từ chối tin");
        return;
      }
      if (frame.type === "read" && frame.read_at && frame.message_ids && frame.message_ids.length > 0) {
        const ids = frame.message_ids;
        const readAt = frame.read_at;
        setMessages((current) => withRead(current, ids, readAt));
        return;
      }
      if (frame.type === "agent" && frame.display_name) {
        const name = frame.display_name;
        if (agentNameRef.current !== name) {
          agentNameRef.current = name;
          setJoined(name);
        }
        setAgent({ display_name: name, avatar_url: frame.avatar_url ?? null });
        setAvatarTick(Date.now());
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
    if (imageBusy.current) {
      return;
    }
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
    imageBusy.current = true;
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
      setError(caught instanceof ApiError ? caught.message : COPY[lang].imageError);
    } finally {
      imageBusy.current = false;
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
    const nextAccount = account.trim();
    const nextSite = site.trim().toUpperCase();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(nextAccount)) {
      setError(COPY[lang].accountError);
      return;
    }
    if (!/^[A-Z0-9]{2,16}$/.test(nextSite)) {
      setError(COPY[lang].siteError);
      return;
    }
    void connect({ conversationId: "", account: nextAccount, site: nextSite, invite: readInvite() || undefined });
  }

  const live = status === "live";
  const started = status !== "form";
  const textCopy = COPY[lang];

  function chooseLang(next: GuestLang) {
    setLang(next);
    localStorage.setItem(LANG_STORAGE, next);
  }

  return (
    <UiFrame>
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
            <p className={agent ? "guest-agent" : undefined}>
              {agent?.avatar_url ? <img src={`${toApiUrl(agent.avatar_url)}${avatarTick ? `?v=${avatarTick}` : ""}`} alt="" /> : agent ? <span>{agent.display_name.slice(0, 1).toUpperCase()}</span> : null}
              {agent ? textCopy.chatting.replace("{name}", agent.display_name) : started ? statusLabel(status, lang) : textCopy.contact}
            </p>
          </div>
          <div className="guest-lang">
            <button type="button" className={lang === "vi" ? "is-on" : undefined} onClick={() => chooseLang("vi")}>
              VI
            </button>
            <button type="button" className={lang === "zh" ? "is-on" : undefined} onClick={() => chooseLang("zh")}>
              中文
            </button>
          </div>
        </header>
        {started ? (
          <>
            <div className="chat-thread" ref={threadRef}>
              <article className="chat-bubble chat-bubble--agent">
                <p>{textCopy.welcome}</p>
              </article>
              {checkNote ? (
                <article className="chat-bubble chat-bubble--agent">
                  <p>{checkNote}</p>
                </article>
              ) : null}
              {joined ? <p className="guest-join">{textCopy.joined.replace("{name}", joined)}</p> : null}
              {messages.map((message, index) => {
                const caption = message.image_url && (message.body === "Khách gửi ảnh." || message.body === "Đã gửi ảnh.") ? "" : message.body;
                return (
                  <article key={message.id} className={message.sender === "customer" ? "chat-bubble chat-bubble--customer" : "chat-bubble chat-bubble--agent"}>
                    {message.image_url ? <img className="chat-photo" alt="" src={message.image_url} /> : null}
                    {caption ? <p>{caption}</p> : null}
                    <time>{formatStamp(message.created_at)}</time>
                    {showReadMark(messages, index, (item) => item.sender === "customer") ? <span className="chat-read">{textCopy.read}</span> : null}
                  </article>
                );
              })}
            </div>
            {error ? <p className="chat-compose__error">{error}</p> : null}
            {status === "down" ? (
              <div className="guest-retry">
                <Button type="primary" onClick={() => saved.current && void connect(saved.current)}>
                  {textCopy.retry}
                </Button>
              </div>
            ) : (
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
                onPaste={(event) => {
                  if (!live) {
                    return;
                  }
                  const file = imageFromPaste(event.clipboardData);
                  if (!file) {
                    return;
                  }
                  event.preventDefault();
                  void sendImage(file);
                }}
              >
                <label className="chat-photo-send" title={textCopy.photo} aria-label={textCopy.photo}>
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
                  placeholder={live ? textCopy.placeholder : textCopy.connecting}
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
                  {textCopy.send}
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
            <p>{textCopy.greeting}</p>
            <Input value={account} maxLength={32} placeholder={textCopy.account} onChange={(event) => setAccount(event.target.value)} />
            <Select
              value={site || undefined}
              placeholder={textCopy.site}
              showSearch
              style={{ width: "100%" }}
              options={[...new Set([...(site ? [site] : []), ...stations])].map((code) => ({ value: code, label: code }))}
              onChange={(value: string) => setSite(value)}
            />
            {error ? <p className="chat-compose__error">{error}</p> : null}
            <Button type="primary" htmlType="submit">
              {textCopy.start}
            </Button>
          </form>
        )}
      </section>
    </div>
    </UiFrame>
  );
}

function statusLabel(status: "connecting" | "live" | "down", lang: GuestLang): string {
  const textCopy = COPY[lang];
  if (status === "live") {
    return textCopy.live;
  }
  if (status === "connecting") {
    return textCopy.connecting;
  }
  return textCopy.down;
}

function loadLang(): GuestLang {
  return localStorage.getItem(LANG_STORAGE) === "zh" ? "zh" : "vi";
}

function readStation(): string {
  const value = new URLSearchParams(window.location.search).get("dai")?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{2,16}$/.test(value) ? value : "";
}

function readInvite(): string {
  const value = new URLSearchParams(window.location.search).get("c")?.trim() ?? "";
  return value.length >= 8 && value.length <= 128 ? value : "";
}

function loadSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<GuestSession>;
    if (typeof parsed.account !== "string" || typeof parsed.site !== "string" || typeof parsed.conversationId !== "string") {
      return null;
    }
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(parsed.account) || !/^[A-Z0-9]{2,16}$/.test(parsed.site)) {
      return null;
    }
    const invite = typeof parsed.invite === "string" && parsed.invite.length >= 8 ? parsed.invite : readInvite();
    return { account: parsed.account, site: parsed.site, conversationId: parsed.conversationId, ...(invite ? { invite } : {}) };
  } catch {
    return null;
  }
}

function readFrame(raw: string): { type?: string; code?: string; display_name?: string; avatar_url?: string | null; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string; image_url?: string; message_ids?: string[]; read_at?: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as { type?: string; code?: string; display_name?: string; avatar_url?: string | null; message_id?: string; sender_type?: string; body?: string; created_at?: string; message?: string; image_url?: string; message_ids?: string[]; read_at?: string };
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
