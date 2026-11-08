import { Button, InputNumber, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type VoicePolicy = {
  max_call_seconds: number;
  saved: boolean;
};

export function VoiceCallBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [seconds, setSeconds] = useState(300);
  const [baseline, setBaseline] = useState(300);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = seconds !== baseline;

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
    const result = await api<VoicePolicy>("/api/v1/admin/voice-call");
    setSeconds(result.max_call_seconds);
    setBaseline(result.max_call_seconds);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thời lượng cuộc gọi", "");
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
      const result = await api<VoicePolicy>("/api/v1/admin/voice-call", { method: "PUT", body: { max_call_seconds: seconds } });
      setSeconds(result.max_call_seconds);
      setBaseline(result.max_call_seconds);
      setNotice(`Đã lưu. Cuộc gọi sau khi nối máy sẽ cắt sau ${result.max_call_seconds} giây.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được thời lượng cuộc gọi", "");
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
            Thời lượng cuộc gọi
          </Typography.Title>
          <Typography.Text type="secondary">
            Tính từ lúc khách nghe máy. Hết số giây này thì cuộc gọi bị cắt, kể cả khách còn đang nói. Lần gọi kế tiếp dùng số vừa lưu.
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
      <InputNumber
        min={1}
        max={999}
        precision={0}
        value={seconds}
        disabled={!props.canWrite || loading}
        addonAfter="giây"
        onChange={(value) => {
          setNotice(null);
          if (typeof value === "number") {
            setSeconds(value);
          }
        }}
      />
    </section>
  );
}
