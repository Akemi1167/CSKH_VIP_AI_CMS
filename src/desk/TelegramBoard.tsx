import { Alert, Button, Form, Input, Switch, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type Bot = {
  configured: boolean;
  username: string | null;
  status: "active" | "disabled";
  webhook_set: boolean;
  webhook_path: string;
};

const TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;

export function TelegramBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [bot, setBot] = useState<Bot | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    const result = await api<Bot>("/api/v1/admin/telegram");
    setBot(result);
    setEnabled(result.configured ? result.status === "active" : true);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được cấu hình Telegram", "无法加载 Telegram 配置"), "");
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

  async function save() {
    const value = token.trim();
    if (!TOKEN_PATTERN.test(value)) {
      setTokenError(tr("Dán token từ BotFather, dạng 123456789:AA...", "请粘贴 BotFather 的 token，格式如 123456789:AA..."));
      return;
    }
    setTokenError(null);
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api<Bot>("/api/v1/admin/telegram", { method: "PUT", body: { token: value, enabled } });
      setBot(saved);
      setToken("");
      setEnabled(saved.status === "active");
      setNotice(savedMessage(saved, tr));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được bot Telegram", "无法保存 Telegram 机器人"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const name = bot?.username ? `@${bot.username}` : tr("Chưa có bot", "还没有机器人");

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Telegram
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Một bot để khách nhắn trực tiếp với CSKH. Token không hiện lại sau khi lưu.", "一个机器人，供客户直接联系客服。Token 保存后不再显示。")}</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <div className="shift-grid">
        <article className="shift-card">
          <p className="shift-card__label">{tr("Bot", "机器人")}</p>
          <p className="shift-card__hours">{loading && !bot ? "…" : name}</p>
          {bot?.configured ? (
            <Tag color={bot.status === "active" ? "green" : "default"}>{bot.status === "active" ? tr("Đang nhận tin", "正在接收消息") : tr("Đã tắt", "已关闭")}</Tag>
          ) : (
            <p className="page-note">{tr("Chưa cấu hình.", "尚未配置。")}</p>
          )}
        </article>
        <article className="shift-card">
          <p className="shift-card__label">Webhook</p>
          <p className="shift-card__hours">{bot?.webhook_set ? tr("Đã gắn", "已绑定") : tr("Chưa gắn", "未绑定")}</p>
          <p className="page-note">{bot?.webhook_path ?? "/api/v1/integrations/telegram/webhook"}</p>
        </article>
      </div>
      <div className="shift-form">
        <Form layout="vertical" requiredMark={false} onFinish={() => void save()}>
          <Form.Item label="Token BotFather" validateStatus={tokenError ? "error" : ""} help={tokenError || tr("Dán lại token mỗi lần lưu. Trình duyệt không giữ token.", "每次保存都需要重新粘贴 token。浏览器不会保留 token。")}>
            <Input.Password
              value={token}
              autoComplete="off"
              placeholder="123456789:AA..."
              onChange={(event) => {
                setToken(event.target.value);
                setTokenError(null);
              }}
            />
          </Form.Item>
          <Form.Item label={tr("Nhận tin từ khách", "接收客户消息")}>
            <Switch checked={enabled} checkedChildren={tr("Bật", "开")} unCheckedChildren={tr("Tắt", "关")} onChange={setEnabled} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={token.trim().length === 0}>
            {tr("Lưu bot", "保存机器人")}
          </Button>
        </Form>
        <p className="page-note">
          {tr("Bật bot cần địa chỉ https công khai của API thì Telegram mới gửi tin vào. Tắt bot sẽ gỡ webhook. Khách nhắn bot thì hội thoại vào cùng hàng chờ với chat web.", "开启机器人需要 API 的公网 https 地址，Telegram 才能把消息发进来。关闭机器人会移除 webhook。客户给机器人发消息后，会话会进入与网页聊天相同的队列。")}
        </p>
      </div>
    </section>
  );
}

function savedMessage(bot: Bot, tr: (vi: string, zh: string) => string): string {
  const viName = bot.username ? `@${bot.username}` : "bot";
  const zhName = bot.username ? `@${bot.username}` : "机器人";
  if (bot.status === "disabled") {
    return tr(`Đã tắt ${viName} và gỡ webhook.`, `已关闭 ${zhName} 并移除 webhook。`);
  }
  if (bot.webhook_set) {
    return tr(`Đã lưu ${viName} và gắn webhook.`, `已保存 ${zhName} 并绑定 webhook。`);
  }
  return tr(`Đã lưu ${viName}. Webhook chưa gắn vì server chưa có địa chỉ https công khai.`, `已保存 ${zhName}。服务器没有公网 https 地址，因此 webhook 尚未绑定。`);
}
