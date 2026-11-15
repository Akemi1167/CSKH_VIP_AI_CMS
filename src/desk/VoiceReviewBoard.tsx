import { Button, Drawer, Select, Table, Typography } from "antd";
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
    const result = await api<{ sample_percent: number; items: ReviewRow[] }>("/api/v1/admin/voice/reviews");
    setItems(result.items);
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

  const columns: TableColumnsType<ReviewRow> = [
    { title: tr("Lúc gọi", "呼叫时间"), width: 170, dataIndex: "happened_at", render: (value: string | null) => (value ? formatStamp(value) : "—") },
    { title: tr("Số", "号码"), dataIndex: "phone_mask", width: 140 },
    { title: tr("Trạng thái", "状态"), dataIndex: "status_label", ellipsis: true },
    { title: tr("Điểm", "分数"), width: 90, dataIndex: "score", render: (value: number | null) => (value ?? "—") },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Chấm điểm cuộc gọi", "通话评分")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Mẫu 20% cuộc gọi đã có file ghi âm. Nghe và đọc hội thoại rồi cho điểm từ 1 đến 5.", "抽取 20% 已有录音的通话。听录音、看对话后打 1 到 5 分。")}</Typography.Text>
        </div>
        <Button loading={loading} onClick={() => void load().catch(() => undefined)}>
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
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
