import { Alert, Button, Form, Input, Switch, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type Bot = {
  configured: boolean;
  username: string | null;
  status: "active" | "disabled";
  webhook_set: boolean;
  webhook_path: string;
};

const TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;

export function TelegramBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được cấu hình Telegram", "");
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
      setTokenError("Dán token từ BotFather, dạng 123456789:AA...");
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
      setNotice(savedMessage(saved));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được bot Telegram", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const name = bot?.username ? `@${bot.username}` : "Chưa có bot";

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Telegram
          </Typography.Title>
          <Typography.Text type="secondary">Một bot để khách nhắn trực tiếp với CSKH. Token không hiện lại sau khi lưu.</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <div className="shift-grid">
        <article className="shift-card">
          <p className="shift-card__label">Bot</p>
          <p className="shift-card__hours">{loading && !bot ? "…" : name}</p>
          {bot?.configured ? (
            <Tag color={bot.status === "active" ? "green" : "default"}>{bot.status === "active" ? "Đang nhận tin" : "Đã tắt"}</Tag>
          ) : (
            <p className="page-note">Chưa cấu hình.</p>
          )}
        </article>
        <article className="shift-card">
          <p className="shift-card__label">Webhook</p>
          <p className="shift-card__hours">{bot?.webhook_set ? "Đã gắn" : "Chưa gắn"}</p>
          <p className="page-note">{bot?.webhook_path ?? "/api/v1/integrations/telegram/webhook"}</p>
        </article>
      </div>
      <div className="shift-form">
        <Form layout="vertical" requiredMark={false} onFinish={() => void save()}>
          <Form.Item label="Token BotFather" validateStatus={tokenError ? "error" : ""} help={tokenError || "Dán lại token mỗi lần lưu. Trình duyệt không giữ token."}>
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
          <Form.Item label="Nhận tin từ khách">
            <Switch checked={enabled} checkedChildren="Bật" unCheckedChildren="Tắt" onChange={setEnabled} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={token.trim().length === 0}>
            Lưu bot
          </Button>
        </Form>
        <p className="page-note">
          Bật bot cần địa chỉ https công khai của API thì Telegram mới gửi tin vào. Tắt bot sẽ gỡ webhook. Khách nhắn bot thì hội thoại vào cùng hàng chờ với chat web.
        </p>
      </div>
    </section>
  );
}

function savedMessage(bot: Bot): string {
  const name = bot.username ? `@${bot.username}` : "bot";
  if (bot.status === "disabled") {
    return `Đã tắt ${name} và gỡ webhook.`;
  }
  if (bot.webhook_set) {
    return `Đã lưu ${name} và gắn webhook.`;
  }
  return `Đã lưu ${name}. Webhook chưa gắn vì server chưa có địa chỉ https công khai.`;
}
