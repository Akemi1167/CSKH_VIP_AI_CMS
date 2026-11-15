import { Button, Input, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

const TEXT_KEYS = ["text1", "text2", "text3", "text4", "text5", "text6", "text7", "text8", "text9", "text10"] as const;

type TextKey = (typeof TEXT_KEYS)[number];

type HangupSms = {
  content: string;
  saved: boolean;
  app_ready: boolean;
} & Record<TextKey, string>;

const EMPTY: HangupSms = {
  content: "",
  text1: "",
  text2: "",
  text3: "",
  text4: "",
  text5: "",
  text6: "",
  text7: "",
  text8: "",
  text9: "",
  text10: "",
  saved: false,
  app_ready: false,
};

export function HangupSmsBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [draft, setDraft] = useState<HangupSms>(EMPTY);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = fingerprint(draft) !== baseline;

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
    const result = await api<HangupSms>("/api/v1/admin/hangup-sms");
    const next = normalize(result);
    setDraft(next);
    setBaseline(fingerprint(next));
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được tin nhắn sau cuộc gọi", "");
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
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api<HangupSms>("/api/v1/admin/hangup-sms", { method: "PUT", body: payload(draft) });
      const next = normalize(result);
      setDraft(next);
      setBaseline(fingerprint(next));
      setNotice(next.content ? "Đã lưu. Cuộc gọi AI kế tiếp sẽ gửi tin này khi khách nghe máy." : "Đã lưu. Tin sau cuộc gọi đang tắt.");
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được tin nhắn sau cuộc gọi", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Tin sau cuộc gọi
          </Typography.Title>
          <Typography.Text type="secondary">
            Laaffic gửi tin khi cuộc gọi đã nối máy và là cuộc gọi hiệu quả. Viết {"${text1}"} đến {"${text10}"} trong nội dung để lấy giá trị bên dưới. Mỗi biến tối đa 30 ký tự.
          </Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            Lưu
          </Button>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      {draft.app_ready ? null : <Typography.Paragraph type="warning">Máy chủ chưa có mã app SMS marketing, tin sẽ chưa được gửi.</Typography.Paragraph>}
      <Space direction="vertical" size="middle" style={{ display: "flex", maxWidth: 720 }}>
        <Input.TextArea
          rows={5}
          maxLength={1024}
          value={draft.content}
          disabled={!props.canWrite || loading}
          placeholder="Ví dụ: Liên hệ Telegram ${text1}. Trang hỗ trợ ${text2}."
          onChange={(event) => {
            setNotice(null);
            setDraft({ ...draft, content: event.target.value });
          }}
        />
        {TEXT_KEYS.map((key) => (
          <Input
            key={key}
            maxLength={30}
            addonBefore={key}
            value={draft[key]}
            disabled={!props.canWrite || loading}
            placeholder={`Giá trị thay cho \${${key}}`}
            onChange={(event) => {
              setNotice(null);
              setDraft({ ...draft, [key]: event.target.value });
            }}
          />
        ))}
      </Space>
    </section>
  );
}

function normalize(value: HangupSms): HangupSms {
  const next = { ...EMPTY, saved: value.saved, app_ready: value.app_ready, content: value.content ?? "" };
  for (const key of TEXT_KEYS) {
    next[key] = value[key] ?? "";
  }
  return next;
}

function payload(value: HangupSms): Record<string, string> {
  const body: Record<string, string> = { content: value.content };
  for (const key of TEXT_KEYS) {
    body[key] = value[key];
  }
  return body;
}

function fingerprint(value: HangupSms): string {
  return JSON.stringify(payload(value));
}
