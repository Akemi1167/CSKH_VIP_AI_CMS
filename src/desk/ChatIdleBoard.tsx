import { Button, InputNumber, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type IdlePolicy = {
  idle_minutes: number;
};

export function ChatIdleBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
    [props.onUnauthorized, props.onMfaSetup],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được thời gian chat", "无法加载聊天时长"), "");
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
      setNotice(result.idle_minutes === 0 ? tr("Đã tắt tự kết thúc.", "已关闭自动结束。") : tr(`Đã lưu. Khách im lặng ${result.idle_minutes} phút thì hội thoại kết thúc.`, `已保存。客户 ${result.idle_minutes} 分钟没有发消息，会话即结束。`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được thời gian chat", "无法保存聊天时长"), "");
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
            {tr("Thời gian chat", "聊天时长")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {tr("Sau câu trả lời của nhân viên, khách không nhắn lại trong khoảng này thì hội thoại kết thúc và chỗ đó được trả cho người khác. Khách nhắn lại thì hội thoại mở lại. Nhập 0 để tắt.", "员工回复后，如果客户在此时长内没有再发消息，会话会结束，名额会交给其他人。客户再次发消息时会话会重新打开。输入 0 即可关闭。")}
          </Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            {tr("Lưu", "保存")}
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
        addonAfter={tr("phút", "分钟")}
        onChange={(value) => {
          setNotice(null);
          setMinutes(typeof value === "number" ? value : 0);
        }}
      />
    </section>
  );
}
