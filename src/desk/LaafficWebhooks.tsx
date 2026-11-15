import { Button } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { copyText } from "../password.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type Hooks = {
  sms_url: string | null;
  voice_url: string | null;
  sms_path: string;
  voice_path: string;
};

export function LaafficWebhooks(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [hooks, setHooks] = useState<Hooks | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState<"sms" | "voice" | null>(null);

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

  useEffect(() => {
    let ignore = false;
    api<Hooks>("/api/v1/admin/laaffic/webhooks")
      .then((result) => {
        if (!ignore) {
          setHooks(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được địa chỉ webhook", "无法加载 webhook 地址"), "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      });
    return () => {
      ignore = true;
    };
  }, [failAuth]);

  async function copy(kind: "sms" | "voice", value: string) {
    const ok = await copyText(value);
    if (!ok) {
      return;
    }
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1600);
  }

  const ready = Boolean(hooks?.sms_url && hooks.voice_url);

  return (
    <div className="shift-form webhook-card">
      <p className="shift-card__label">{tr("Webhook Laaffic", "Laaffic Webhook")}</p>
      <p className="page-note" style={{ marginTop: 0 }}>
        {tr("Chép địa chỉ rồi dán vào callback của ứng dụng SMS và ứng dụng gọi AI trên Laaffic.", "复制地址，粘贴到 Laaffic 上短信应用和 AI 呼叫应用的回调。")}
      </p>
      <ErrorAlert error={error} />
      <div className="webhook-list">
        <WebhookRow label="SMS" value={hooks?.sms_url ?? hooks?.sms_path ?? ""} copied={copied === "sms"} disabled={!hooks?.sms_url} onCopy={() => void copy("sms", hooks?.sms_url ?? "")} />
        <WebhookRow label={tr("Gọi AI", "AI呼叫")} value={hooks?.voice_url ?? hooks?.voice_path ?? ""} copied={copied === "voice"} disabled={!hooks?.voice_url} onCopy={() => void copy("voice", hooks?.voice_url ?? "")} />
      </div>
      {hooks && !ready ? <p className="page-note">{tr("Máy API chưa có địa chỉ https công khai, nên chưa chép được đường đầy đủ.", "API 服务器还没有公网 https 地址，因此还不能复制完整路径。")}</p> : null}
    </div>
  );
}

function WebhookRow(props: { label: string; value: string; copied: boolean; disabled: boolean; onCopy: () => void }) {
  const tr = useTr();
  return (
    <div className="webhook-row">
      <span>{props.label}</span>
      <code>{props.value || "…"}</code>
      <Button size="small" disabled={props.disabled || props.value.length === 0} onClick={props.onCopy}>
        {props.copied ? tr("Đã chép", "已复制") : tr("Chép", "复制")}
      </Button>
    </div>
  );
}
