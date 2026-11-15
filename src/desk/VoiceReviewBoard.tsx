import { Button, Drawer, Segmented, Select, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type ReviewRow = {
  provider_ref: string;
  phone_mask: string;
  status_label: string;
  happened_at: string | null;
  score: number | null;
};

type Turn = { role: string; text: string };

type MessageRow = {
  id: string;
  created_at: string;
  customer_ref: string | null;
  game_account: string | null;
  site: string | null;
  body: string;
  score: number | null;
};

export function VoiceReviewBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [score, setScore] = useState("3");
  const [audio, setAudio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"calls" | "messages">("calls");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [message, setMessage] = useState<MessageRow | null>(null);
  const [messageScore, setMessageScore] = useState("3");

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
    const [calls, bots] = await Promise.all([
      api<{ sample_percent: number; items: ReviewRow[] }>("/api/v1/admin/voice/reviews"),
      api<{ sample_percent: number; items: MessageRow[] }>("/api/v1/admin/message-reviews"),
    ]);
    setItems(calls.items);
    setMessages(bots.items);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được mẫu chấm", "无法加载评分样本"), "");
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

  async function open(row: ReviewRow) {
    setSelected(row);
    setScore(String(row.score ?? 3));
    setTurns([]);
    setAudio(null);
    setBusy(true);
    setError(null);
    try {
      const detail = await api<{ turns: Turn[] }>(`/api/v1/admin/voice/reviews/${encodeURIComponent(row.provider_ref)}`);
      setTurns(detail.turns);
      try {
        const file = await api<{ url: string }>(`/api/v1/admin/laaffic/history/${encodeURIComponent(row.provider_ref)}/recording`);
        setAudio(file.url);
      } catch {
        setAudio(null);
      }
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở được cuộc gọi", "无法打开通话"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/voice/reviews/${encodeURIComponent(selected.provider_ref)}`, {
        method: "POST",
        body: { score: Number(score) },
      });
      setSelected(null);
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được điểm", "无法保存分数"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveMessage() {
    if (!message) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/message-reviews/${message.id}`, {
        method: "POST",
        body: { score: Number(messageScore) },
      });
      setMessage(null);
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được điểm", "无法保存分数"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<ReviewRow> = [
    { title: tr("Lúc gọi", "呼叫时间"), width: 170, dataIndex: "happened_at", render: (value: string | null) => (value ? formatStamp(value) : "—") },
    { title: tr("Số", "号码"), dataIndex: "phone_mask", width: 140 },
    { title: tr("Trạng thái", "状态"), dataIndex: "status_label", ellipsis: true },
    { title: tr("Điểm", "分数"), width: 90, dataIndex: "score", render: (value: number | null) => (value ?? "—") },
  ];

  const messageColumns: TableColumnsType<MessageRow> = [
    { title: tr("Lúc gửi", "发送时间"), width: 170, dataIndex: "created_at", render: (value: string) => formatStamp(value) },
    { title: tr("Tài khoản", "账号"), width: 160, ellipsis: true, render: (_, row) => row.game_account || row.customer_ref || "—" },
    { title: tr("Đài", "站点"), width: 110, dataIndex: "site", render: (value: string | null) => value || "—" },
    { title: tr("Nội dung", "内容"), dataIndex: "body", ellipsis: true },
    { title: tr("Điểm", "分数"), width: 90, dataIndex: "score", render: (value: number | null) => (value ?? "—") },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Chấm điểm", "评分")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Mẫu 20% cuộc gọi đã có file ghi âm và 20% tin bot Telegram. Cho điểm từ 1 đến 5.", "抽取 20% 已有录音的通话和 20% Telegram 机器人消息。打 1 到 5 分。")}</Typography.Text>
        </div>
        <Button loading={loading} onClick={() => void load().catch(() => undefined)}>
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <Segmented
        style={{ marginBottom: 16 }}
        value={kind}
        onChange={(value) => setKind(value === "messages" ? "messages" : "calls")}
        options={[
          { value: "calls", label: tr("Cuộc gọi", "通话") },
          { value: "messages", label: tr("Tin bot", "机器人消息") },
        ]}
      />
      {kind === "messages" ? (
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={messageColumns}
          dataSource={messages}
          pagination={false}
          locale={{ emptyText: tr("Chưa có tin bot trong mẫu.", "样本中还没有机器人消息。") }}
          onRow={(row) => ({ onClick: () => { setMessage(row); setMessageScore(String(row.score ?? 3)); } })}
        />
      ) : (
      <Table
        rowKey="provider_ref"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: tr("Chưa có cuộc gọi trong mẫu.", "样本中还没有通话。") }}
        onRow={(row) => ({ onClick: () => void open(row) })}
      />
      )}
      <Drawer title={tr("Chấm tin bot", "评分机器人消息")} open={message !== null} width={480} onClose={() => setMessage(null)}>
        <p>{message?.body}</p>
        <Select
          style={{ width: 120, marginTop: 8 }}
          value={messageScore}
          onChange={setMessageScore}
          options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: tr(`${value} điểm`, `${value} 分`) }))}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="primary" loading={busy} onClick={() => void saveMessage()}>
            {tr("Lưu điểm", "保存分数")}
          </Button>
        </div>
      </Drawer>
      <Drawer title={tr("Chấm cuộc gọi", "评分通话")} open={selected !== null} width={480} onClose={() => setSelected(null)}>
        {audio ? <audio controls src={audio} style={{ width: "100%" }} /> : <p className="page-note">{tr("Chưa lấy được file nghe.", "还没有拿到录音。")}</p>}
        <div style={{ marginTop: 16 }}>
          {turns.length === 0 ? <p className="page-note">{tr("Chưa có hội thoại.", "还没有对话。")}</p> : turns.map((turn, index) => (
            <p key={`${turn.role}-${index}`}>
              <strong>{turn.role}: </strong>
              {turn.text}
            </p>
          ))}
        </div>
        <Select
          style={{ width: 120, marginTop: 8 }}
          value={score}
          onChange={setScore}
          options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: tr(`${value} điểm`, `${value} 分`) }))}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="primary" loading={busy} onClick={() => void save()}>
            {tr("Lưu điểm", "保存分数")}
          </Button>
        </div>
      </Drawer>
    </section>
  );
}
