import { Button, InputNumber, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type IdlePolicy = {
  idle_minutes: number;
};

export function ChatIdleBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [minutes, setMinutes] = useState(15);
  const [baseline, setBaseline] = useState(15);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = minutes !== baseline;

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
    const result = await api<IdlePolicy>("/api/v1/admin/chat-idle");
    setMinutes(result.idle_minutes);
    setBaseline(result.idle_minutes);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thời gian chat", "");
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
      const result = await api<IdlePolicy>("/api/v1/admin/chat-idle", { method: "PUT", body: { idle_minutes: minutes } });
      setMinutes(result.idle_minutes);
      setBaseline(result.idle_minutes);
      setNotice(result.idle_minutes === 0 ? "Đã tắt tự kết thúc." : `Đã lưu. Khách im lặng ${result.idle_minutes} phút thì hội thoại kết thúc.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được thời gian chat", "");
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
            Thời gian chat
          </Typography.Title>
          <Typography.Text type="secondary">
            Sau câu trả lời của nhân viên, khách không nhắn lại trong khoảng này thì hội thoại kết thúc và chỗ đó được trả cho người khác. Khách nhắn lại thì hội thoại mở lại. Nhập 0 để tắt.
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
        min={0}
        max={240}
        precision={0}
        value={minutes}
        disabled={!props.canWrite || loading}
        addonAfter="phút"
        onChange={(value) => {
          setNotice(null);
          setMinutes(typeof value === "number" ? value : 0);
        }}
      />
    </section>
  );
}
