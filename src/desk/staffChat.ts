export type ReplyAck = {
  message_id: string;
  task_id: string;
  task_status: string;
  version: number;
};

export type LiveChatMessage = {
  message_id: string;
  task_id: string;
  task_status: string;
  version: number;
  sender_type: string;
  body: string;
  created_at: string;
  customer_ref: string;
  channel: string;
};

export type LiveChatTask = {
  task_id: string;
  status: string;
  version: number;
  customer_ref: string;
  channel: string;
};

type Handlers = {
  onStatus: (status: "connecting" | "live" | "down") => void;
  onMessage: (message: LiveChatMessage) => void;
  onTask: (task: LiveChatTask) => void;
};

type Pending = {
  resolve: (ack: ReplyAck) => void;
  reject: (error: Error) => void;
  timer: number;
};

export class StaffChat {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retry = 0;
  private pending: Pending | null = null;

  constructor(private readonly handlers: Handlers) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retry);
    this.failPending(new Error("Đã ngắt chat"));
    this.socket?.close();
    this.socket = null;
  }

  get live(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendReply(input: { task_id: string; version: number; body: string; care_note: string }): Promise<ReplyAck> {
    if (!this.live || !this.socket) {
      return Promise.reject(new Error("offline"));
    }
    if (this.pending) {
      return Promise.reject(new Error("Đang gửi tin trước"));
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.failPending(new Error("Hết giờ chờ xác nhận"));
      }, 8000);
      this.pending = { resolve, reject, timer };
      this.socket?.send(
        JSON.stringify({
          type: "reply",
          task_id: input.task_id,
          version: input.version,
          body: input.body,
          care_label: "da_lien_he_lai",
          care_note: input.care_note,
        }),
      );
    });
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.handlers.onStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/chat/socket`);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      this.receive(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.failPending(new Error("Mất kết nối chat"));
      this.handlers.onStatus("down");
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.retry = window.setTimeout(() => this.connect(), delay);
  }

  private receive(raw: string): void {
    const frame = readFrame(raw);
    if (!frame) {
      return;
    }
    if (frame.type === "ready") {
      this.attempt = 0;
      this.handlers.onStatus("live");
      return;
    }
    if (frame.type === "ack") {
      const pending = this.pending;
      if (!pending || !frame.message_id || !frame.task_id) {
        return;
      }
      window.clearTimeout(pending.timer);
      this.pending = null;
      pending.resolve({
        message_id: frame.message_id,
        task_id: frame.task_id,
        task_status: frame.task_status ?? "",
        version: frame.version ?? 0,
      });
      return;
    }
    if (frame.type === "error") {
      this.failPending(new Error(frame.message || "Không gửi được tin"));
      return;
    }
    if (frame.type === "message" && frame.message_id && frame.task_id && frame.body && frame.created_at) {
      this.handlers.onMessage({
        message_id: frame.message_id,
        task_id: frame.task_id,
        task_status: frame.task_status ?? "",
        version: frame.version ?? 0,
        sender_type: frame.sender_type ?? "customer",
        body: frame.body,
        created_at: frame.created_at,
        customer_ref: frame.customer_ref ?? "",
        channel: frame.channel ?? "web_chat",
      });
      return;
    }
    if (frame.type === "task" && frame.task_id && frame.customer_ref) {
      this.handlers.onTask({
        task_id: frame.task_id,
        status: frame.status ?? "",
        version: frame.version ?? 0,
        customer_ref: frame.customer_ref,
        channel: frame.channel ?? "web_chat",
      });
    }
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(error);
  }
}

type Frame = {
  type?: string;
  message_id?: string;
  task_id?: string;
  task_status?: string;
  status?: string;
  version?: number;
  sender_type?: string;
  body?: string;
  created_at?: string;
  customer_ref?: string;
  channel?: string;
  message?: string;
};

function readFrame(raw: string): Frame | undefined {
  try {
    const parsed = JSON.parse(raw) as Frame;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
