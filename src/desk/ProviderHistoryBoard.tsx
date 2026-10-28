import { Button, Modal, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";

type Channel = "sms" | "ai_voice";

type VoiceFacts = {
  duration_seconds: number | null;
  call_status: string | null;
  call_description: string | null;
  termination_reason: string | null;
  answer_at: string | null;
  hangup_at: string | null;
  intent: string | null;
  task_id: string | null;
  dialogue_count: number | null;
  recording_id: string | null;
  display_num: string | null;
  task_name: string | null;
  progress: string | null;
  number_count: number | null;
  called_count: number | null;
  answered_count: number | null;
  failed_count: number | null;
  script_id: string | null;
  answer_rate: string | null;
  dialogue: DialogueTurn[] | null;
};

type DialogueTurn = { role: string; text: string; at: string | null };

type HistoryItem = {
  provider_ref: string;
  phone_mask: string;
  status_label: string;
  result_code: string | null;
  happened_at: string | null;
  detail: string | null;
  facts: VoiceFacts | null;
};

export function ProviderHistoryBoard(props: {
  channel: Channel;
  title: string;
  lead: string;
  canSync: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const result = await api<{ items: HistoryItem[] }>(`/api/v1/admin/laaffic/history?channel=${props.channel}`);
    setItems(result.items);
    setError(null);
  }, [props.channel]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được lịch sử", "");
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

  async function sync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ pulled: number; recordings?: number }>("/api/v1/admin/laaffic/history/sync", {
        method: "POST",
        body: { channel: props.channel },
      });
      setNotice(
        props.channel === "ai_voice" && !result.recordings
          ? `Đã đồng bộ ${result.pulled} task. Danh sách này không có mã file ghi âm.`
          : `Đã đồng bộ ${result.pulled} dòng từ Laaffic.`,
      );
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đồng bộ được", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSyncing(false);
    }
  }

  const columns: TableColumnsType<HistoryItem> =
    props.channel === "sms"
      ? [
          { title: "Lúc", dataIndex: "happened_at", width: 160, render: (value: string | null) => stamp(value) },
          { title: "Số", dataIndex: "phone_mask", width: 140 },
          { title: "Trạng thái", dataIndex: "status_label", width: 140 },
          { title: "Mã Laaffic", dataIndex: "provider_ref", ellipsis: true },
        ]
      : [
          { title: "Lúc gọi", dataIndex: "happened_at", width: 160, render: (value: string | null) => stamp(value) },
          { title: "Task", width: 180, ellipsis: true, render: (_value, row) => row.facts?.task_name || row.detail || row.facts?.task_id || "—" },
          { title: "Trạng thái", width: 140, render: (_value, row) => callStatus(row) },
          { title: "Tiến độ", width: 90, render: (_value, row) => (row.facts?.progress ? `${row.facts.progress}%` : "—") },
          { title: "Số lượng", width: 100, render: (_value, row) => countCell(row.facts?.number_count) },
          { title: "Đã gọi", width: 90, render: (_value, row) => countCell(row.facts?.called_count) },
          { title: "Đã nghe", width: 90, render: (_value, row) => countCell(row.facts?.answered_count) },
          { title: "Lỗi", width: 80, render: (_value, row) => countCell(row.facts?.failed_count) },
          { title: "Tỷ lệ nghe", width: 110, render: (_value, row) => (row.facts?.answer_rate ? `${row.facts.answer_rate}%` : "—") },
          { title: "Agent", width: 90, render: (_value, row) => row.facts?.script_id || "—" },
          { title: "Số", dataIndex: "phone_mask", width: 130 },
          { title: "Thời lượng", width: 110, render: (_value, row) => (row.facts?.duration_seconds ? `${row.facts.duration_seconds} giây` : "—") },
          { title: "Mô tả", width: 140, render: (_value, row) => callDescription(row.facts?.call_description) },
          { title: "Lý do", width: 160, ellipsis: true, render: (_value, row) => row.facts?.termination_reason || "—" },
          { title: "Lượt thoại", width: 110, render: (_value, row) => row.facts?.dialogue_count ?? "—" },
          { title: "Ý định", width: 100, render: (_value, row) => row.facts?.intent || "—" },
          { title: "Hội thoại", width: 120, render: (_value, row) => <DialogueCell turns={row.facts?.dialogue ?? null} /> },
          {
            title: "Nghe lại",
            width: 280,
            render: (_value, row) => (
              <RecordingCell
                providerRef={row.provider_ref}
                canTry={Boolean(row.facts?.recording_id) || (row.phone_mask !== "—" && /^\d{10,}$/.test(row.provider_ref))}
                onFail={(problem) => {
                  if (!failAuth(problem)) {
                    setError(problem);
                  }
                }}
              />
            ),
          },
        ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.title}
          </Typography.Title>
          <Typography.Text type="secondary">{props.lead}</Typography.Text>
        </div>
        {props.canSync ? (
          <Button type="primary" loading={syncing} onClick={() => void sync()}>
            Đồng bộ Laaffic
          </Button>
        ) : null}
      </div>
      <p className="page-note" style={{ marginTop: 0 }}>
        {props.channel === "sms"
          ? "Lấy 7 ngày gần nhất. Số được che. Không lưu nội dung tin."
          : "Danh sách task không có file nghe. Mã file nằm trong báo cáo Laaffic đẩy về webhook Gọi AI. Khi báo cáo tới, dòng cuộc gọi có nút Nghe."}
      </p>
      {props.channel === "ai_voice" ? <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <p className="page-note">{notice}</p> : null}
      <Table
        rowKey="provider_ref"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={false}
        scroll={props.channel === "ai_voice" ? { x: 1800 } : undefined}
        locale={{ emptyText: "Chưa có lịch sử. Bấm đồng bộ để lấy từ Laaffic." }}
      />
    </section>
  );
}

function stamp(value: string | null): string {
  return value ? formatStamp(value) : "—";
}

function countCell(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function callStatus(row: HistoryItem): string {
  const code = row.facts?.call_status;
  if (code === "1") {
    return "Đã nối máy";
  }
  if (code === "2") {
    return "Nối máy lỗi";
  }
  if (code === "3") {
    return "Không nghe máy";
  }
  if (code === "4") {
    return "Không nghe, lỗi";
  }
  return row.status_label;
}

function callDescription(code: string | null | undefined): string {
  switch (code) {
    case "1":
      return "Hợp lệ";
    case "2":
      return "Thư thoại";
    case "3":
      return "Cúp nhanh";
    case "4":
      return "Im lặng";
    case "5":
      return "AI cúp";
    case "6":
      return "Khách từ chối";
    case "7":
      return "Ngoài vùng";
    case "8":
      return "Không bắt máy";
    case "10":
      return "Lỗi đường truyền";
    default:
      return "—";
  }
}

function DialogueCell(props: { turns: DialogueTurn[] | null }) {
  const [open, setOpen] = useState(false);
  if (!props.turns?.length) {
    return <span>—</span>;
  }
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        Xem thoại
      </Button>
      <Modal open={open} title="Hội thoại" footer={null} onCancel={() => setOpen(false)}>
        {props.turns.map((turn, index) => (
          <p key={`${turn.role}-${index}`}>
            <strong>{turn.role}.</strong> {turn.text}
          </p>
        ))}
      </Modal>
    </>
  );
}

function RecordingCell(props: { providerRef: string; canTry: boolean; onFail: (error: ApiError) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!props.canTry) {
    return <span>Chưa có file</span>;
  }
  if (url) {
    return <audio controls autoPlay preload="none" src={url} />;
  }
  return (
    <Button
      size="small"
      loading={busy}
      onClick={() => {
        setBusy(true);
        api<{ url: string }>(`/api/v1/admin/laaffic/history/${encodeURIComponent(props.providerRef)}/recording`)
          .then((result) => setUrl(result.url))
          .catch((caught: unknown) => {
            props.onFail(caught instanceof ApiError ? caught : new ApiError(0, "network", "Không mở được file nghe", ""));
          })
          .finally(() => setBusy(false));
      }}
    >
      Nghe
    </Button>
  );
}
