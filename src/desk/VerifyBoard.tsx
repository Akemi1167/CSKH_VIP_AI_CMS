import { PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { imageFromPaste } from "../clipboardImage.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { ChatBody } from "./ChatBody.tsx";
import { useTr } from "./language.tsx";

type VerifyStatus = "QUEUED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_CUSTOMER";

type VerifyItem = {
  id: string;
  version: number;
  status: VerifyStatus;
  received_at: string;
  channel: string;
  reason: "account_unknown" | "account_forgotten" | "web_direct";
  attempted_account: string | null;
  last_message_body: string | null;
};

type VerifyMessage = {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
  has_image?: boolean;
};

type VerifyDetail = VerifyItem & {
  messages: VerifyMessage[];
};

function reasonText(reason: VerifyItem["reason"], tr: (vi: string, zh: string) => string): string {
  if (reason === "account_unknown") {
    return tr("Sai tên", "名称错误");
  }
  if (reason === "account_forgotten") {
    return tr("Không nhớ tài khoản", "不记得账号");
  }
  return tr("Chat web không có link", "网页聊天没有链接");
}

function asStatus(value: string): VerifyStatus {
  if (value === "ASSIGNED" || value === "IN_PROGRESS" || value === "WAITING_CUSTOMER") {
    return value;
  }
  return "QUEUED";
}

export function VerifyBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [items, setItems] = useState<VerifyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerifyDetail | null>(null);
  const [reply, setReply] = useState("");
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<VerifyItem | null>(null);
  const [account, setAccount] = useState("");
  const [site, setSite] = useState("");
  const [saving, setSaving] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef("");
  const detailId = useRef<string | null>(null);
  detailId.current = detail?.id ?? null;

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

  const load = useCallback(async () => {
    const result = await api<{ items: VerifyItem[] }>("/api/v1/tasks/verify");
    const next = [...result.items]
      .map((item) => ({ ...item, status: asStatus(item.status) }))
      .sort((left, right) => Date.parse(right.received_at) - Date.parse(left.received_at));
    setItems(next);
    setError(null);
    return next;
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được hàng xác minh", "无法加载验证队列"), "");
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
  }, [failAuth, load]);

  const readChat = useCallback(async (taskId: string) => {
    const task = await api<{ version: number; status: string; messages: VerifyMessage[] }>(`/api/v1/tasks/${taskId}`);
    if (detailId.current !== taskId) {
      return;
    }
    const status = asStatus(task.status);
    setDetail((current) => (current && current.id === taskId ? { ...current, version: task.version, status, messages: task.messages } : current));
    setItems((current) => current.map((item) => (item.id === taskId ? { ...item, version: task.version, status } : item)));
  }, []);

  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [detail?.messages]);

  useEffect(() => {
    if (!detail?.id) {
      return;
    }
    const taskId = detail.id;
    const timer = window.setInterval(() => {
      void readChat(taskId).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [detail?.id, readChat]);

  async function openChat(row: VerifyItem) {
    setOpening(true);
    setError(null);
    setNotice(null);
    detailId.current = row.id;
    setDetail({ ...row, messages: [] });
    try {
      const claimed = await api<{ version: number }>(`/api/v1/tasks/${row.id}/verify-claim`, { method: "POST", body: { version: row.version } });
      detailId.current = row.id;
      await readChat(row.id);
      setItems((current) => current.map((item) => (item.id === row.id ? { ...item, version: claimed.version, status: item.status === "QUEUED" ? "ASSIGNED" : item.status } : item)));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở được hội thoại", "无法打开会话"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
      if (detailId.current === row.id) {
        setDetail(null);
        detailId.current = null;
      }
    } finally {
      setOpening(false);
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
    setSending(true);
    setError(null);
    const taskId = detail.id;
    try {
      await api(`/api/v1/tasks/${taskId}/messages`, {
        method: "POST",
        body: { version: detail.version, body: text, care_label: "da_lien_he_lai", care_note: text.slice(0, 200) },
      });
      writeReply("");
      await readChat(taskId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gửi được tin", "无法发送消息"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSending(false);
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
    setSending(true);
    setError(null);
    const taskId = detail.id;
    const caption = replyRef.current.trim();
    const params = new URLSearchParams({ version: String(detail.version) });
    if (caption) {
      params.set("caption", caption);
    }
    try {
      await api(`/api/v1/tasks/${taskId}/images?${params}`, { method: "POST", body: file });
      writeReply("");
      await readChat(taskId);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gửi được ảnh", "无法发送图片"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSending(false);
    }
  }

  async function finish(work: () => Promise<void>) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setDetail(null);
      detailId.current = null;
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không xử lý được hội thoại", "无法处理会话"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="chat-board">
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Xác minh tài khoản", "账户验证")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {tr("Chat với khách để xác minh danh tính. Gắn đúng tài khoản thì hội thoại được chia cho nhân viên đài đó.", "先与客户聊天核验身份。绑定正确账号后，会话会分给该站点的员工。")}
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() =>
            void load().catch((caught: unknown) => {
              const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được hàng xác minh", "无法加载验证队列"), "");
              if (!failAuth(problem)) {
                setError(problem);
              }
            })
          }
        >
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      <div className="chat-shell">
        <aside className="chat-list">
          {loading ? <p className="chat-empty">{tr("Đang tải…", "加载中…")}</p> : null}
          {!loading && items.length === 0 ? <p className="chat-empty">{tr("Không có hội thoại cần xác minh.", "没有需要验证的会话。")}</p> : null}
          {items.map((row) => (
            <button key={row.id} type="button" className={detail?.id === row.id ? "chat-list__item chat-list__item--active" : "chat-list__item"} onClick={() => void openChat(row)}>
              <span className="chat-list__body">
                <span className="chat-list__top">
                  <strong>{reasonText(row.reason, tr)}</strong>
                  <time>{formatStamp(row.received_at)}</time>
                </span>
                <span className="chat-list__preview">{row.last_message_body || row.attempted_account || "—"}</span>
                <span className="chat-list__preview">{row.status === "QUEUED" ? tr("Chưa nhận", "未领取") : tr("Đang xác minh", "正在核验")} · {row.channel === "telegram" ? "Telegram" : "Web"}</span>
              </span>
            </button>
          ))}
        </aside>
        <div className="chat-pane">
          {detail ? (
            <>
              <header className="chat-pane__head">
                <div>
                  <strong>{reasonText(detail.reason, tr)}</strong>
                  <p className="chat-list__preview">{detail.attempted_account ? tr(`Tên đã nhập: ${detail.attempted_account}`, `填写的名称：${detail.attempted_account}`) : tr("Khách chưa nhập tên", "客户还没有填写名称")}</p>
                </div>
              </header>
              <div className="chat-thread" ref={threadRef}>
                {opening && detail.messages.length === 0 ? <p className="chat-empty">{tr("Đang mở hội thoại…", "正在打开会话…")}</p> : null}
                {detail.messages.map((message) => {
                  const kind = message.sender_type === "customer" ? "customer" : message.sender_type === "bot" ? "bot" : "agent";
                  return (
                    <article key={message.id} className={`chat-bubble chat-bubble--${kind}`}>
                      {kind === "bot" ? <span className="chat-who">Bot</span> : null}
                      <ChatBody taskId={detail.id} message={message} />
                      <time>{formatStamp(message.created_at)}</time>
                    </article>
                  );
                })}
              </div>
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
                onPaste={(event) => {
                  const file = imageFromPaste(event.clipboardData);
                  if (!file || sending) {
                    return;
                  }
                  event.preventDefault();
                  void sendImage(file);
                }}
              >
                <Input.TextArea
                  value={reply}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  placeholder={tr("Nhắn khách để xác minh", "给客户发消息以核验")}
                  onChange={(event) => writeReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                      return;
                    }
                    event.preventDefault();
                    void sendReply();
                  }}
                />
                <label className="chat-photo-send" title={tr("Gửi ảnh hoặc dán ảnh đã copy", "发送图片或粘贴已复制的图片")}>
                  <PictureOutlined />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={sending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) {
                        void sendImage(file);
                      }
                    }}
                  />
                </label>
                <Button type="primary" htmlType="submit" disabled={sending || reply.trim().length === 0}>
                  {tr("Gửi", "发送")}
                </Button>
              </form>
              <div className="verify-actions">
                <Button
                  type="primary"
                  disabled={saving}
                  onClick={() => {
                    setTarget(detail);
                    setAccount(detail.attempted_account ?? "");
                    setSite("");
                  }}
                >
                  {tr("Gắn tài khoản", "绑定账号")}
                </Button>
                <Button
                  danger
                  disabled={saving}
                  onClick={() =>
                    void finish(async () => {
                      await api(`/api/v1/tasks/${detail.id}/verify-reject`, { method: "POST", body: { version: detail.version } });
                      setNotice(tr("Đã báo khách không nằm trong danh sách khuyến mãi.", "已告知客户不在优惠名单中。"));
                    })
                  }
                >
                  {tr("Không thuộc KM", "不属于优惠")}
                </Button>
              </div>
            </>
          ) : (
            <p className="chat-empty">{tr("Chọn một hội thoại để chat xác minh danh tính.", "选择一个会话，先聊天核验身份。")}</p>
          )}
        </div>
      </div>
      <Modal
        title={tr("Gắn tài khoản", "绑定账号")}
        open={target !== null}
        okText={tr("Chuyển cho nhân viên đài", "交给站点员工")}
        confirmLoading={saving}
        okButtonProps={{ disabled: account.trim().length < 3 }}
        onOk={() => {
          if (!target) {
            return;
          }
          const row = target;
          void finish(async () => {
            const result = await api<{ game_account: string; site: string }>(`/api/v1/tasks/${row.id}/verify-account`, {
              method: "POST",
              body: { version: detail?.id === row.id ? detail.version : row.version, account: account.trim(), site: site.trim() || undefined },
            });
            setTarget(null);
            setNotice(tr(`Đã gắn ${result.game_account} tại đài ${result.site}. Hội thoại sẽ về nhân viên đài đó.`, `已绑定 ${result.game_account}，站点 ${result.site}。会话将交给该站点的员工。`));
          });
        }}
        onCancel={() => setTarget(null)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label={tr("Tài khoản game", "游戏账号")}>
            <Input value={account} maxLength={32} onChange={(event) => setAccount(event.target.value)} />
          </Form.Item>
          <Form.Item label={tr("Đài", "站点")} help={tr("Chỉ cần khi tài khoản có ở nhiều đài. Ví dụ J88.", "仅当账号存在于多个站点时填写。例如 J88。")}>
            <Input value={site} maxLength={16} onChange={(event) => setSite(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
