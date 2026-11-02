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

  const smsColumns: TableColumnsType<HistoryItem> = [
    { title: "Lúc", dataIndex: "happened_at", width: 160, render: (value: string | null) => stamp(value) },
    { title: "Số", dataIndex: "phone_mask", width: 140 },
    { title: "Trạng thái", dataIndex: "status_label", width: 140 },
    { title: "Mã Laaffic", dataIndex: "provider_ref", ellipsis: true },
  ];
  const callColumns: TableColumnsType<HistoryItem> = [
    { title: "Lúc gọi", dataIndex: "happened_at", width: 168, render: (value: string | null) => stamp(value) },
    { title: "Số", dataIndex: "phone_mask", width: 140 },
    { title: "Trạng thái", width: 150, render: (_value, row) => callStatus(row) },
    { title: "Thời lượng", width: 120, render: (_value, row) => durationLabel(row.facts?.duration_seconds) },
    { title: "Kết quả", render: (_value, row) => <CallOutcome row={row} /> },
    { title: "Hội thoại", width: 120, render: (_value, row) => <DialogueCell turns={row.facts?.dialogue ?? null} /> },
    {
      title: "Nghe lại",
      width: 220,
      render: (_value, row) => (
        <RecordingCell
          providerRef={row.provider_ref}
          canTry={Boolean(row.facts?.recording_id)}
          onFail={(problem) => {
            if (!failAuth(problem)) {
              setError(problem);
            }
          }}
        />
      ),
    },
  ];
  const calls = items.filter((row) => !isTaskRow(row));
  const tasks = items.filter(isTaskRow);
  const taskColumns: TableColumnsType<HistoryItem> = [
    { title: "Task", ellipsis: true, render: (_value, row) => row.facts?.task_name || row.facts?.task_id || row.detail || "—" },
    { title: "Trạng thái", width: 140, dataIndex: "status_label" },
    { title: "Tiến độ", width: 100, render: (_value, row) => percent(row.facts?.progress) },
    { title: "Kết quả", width: 280, render: (_value, row) => taskSummary(row) },
    { title: "Số đã gọi", render: (_value, row) => reportedNumbers(callsFor(row, calls)) },
    { title: "Tỷ lệ nghe", width: 120, render: (_value, row) => percent(row.facts?.answer_rate) },
  ];
  const attached = new Set(tasks.flatMap((task) => callsFor(task, calls).map((call) => call.provider_ref)));
  const looseCalls = calls.filter((call) => !attached.has(call.provider_ref));

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
          : "Bấm một task để xem từng số đã gọi. Số và file nghe chỉ có khi Laaffic gửi báo cáo cuộc gọi về."}
      </p>
      {props.channel === "ai_voice" ? <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <p className="page-note">{notice}</p> : null}
      {props.channel === "sms" ? (
        <Table rowKey="provider_ref" size="middle" columns={smsColumns} dataSource={items} loading={loading} pagination={false} locale={{ emptyText: "Chưa có lịch sử. Bấm đồng bộ để lấy từ Laaffic." }} />
      ) : (
        <>
          <Typography.Title level={5}>Task gọi nhóm</Typography.Title>
          <Table
            rowKey="provider_ref"
            size="middle"
            columns={taskColumns}
            dataSource={tasks}
            loading={loading}
            pagination={false}
            locale={{ emptyText: "Chưa có task." }}
            expandable={{
              expandedRowRender: (task) => <TaskCalls task={task} calls={callsFor(task, calls)} columns={callColumns} />,
              rowExpandable: () => true,
            }}
          />
          {looseCalls.length > 0 ? (
            <div className="history-block">
              <Typography.Title level={5}>Cuộc gọi chưa gắn task</Typography.Title>
              <Table rowKey="provider_ref" size="middle" columns={callColumns} dataSource={looseCalls} pagination={false} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function stamp(value: string | null): string {
  return value ? formatStamp(value) : "—";
}

function isTaskRow(row: HistoryItem): boolean {
  const facts = row.facts;
  return row.phone_mask === "—" && (facts?.number_count != null || facts?.called_count != null || Boolean(facts?.progress));
}

function percent(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return value.endsWith("%") ? value : `${value}%`;
}

function durationLabel(seconds: number | null | undefined): string {
  if (!seconds) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds} giây`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} phút` : `${minutes} phút ${rest} giây`;
}

function callsFor(task: HistoryItem, calls: HistoryItem[]): HistoryItem[] {
  const keys = [task.provider_ref, task.facts?.task_id ?? ""].filter((value) => value.length > 0);
  return calls.filter((call) => {
    const id = call.facts?.task_id ?? "";
    return id.length > 0 && keys.some((key) => key === id || (id.length >= 6 && key.startsWith(id)));
  });
}

function reportedNumbers(calls: HistoryItem[]): string {
  const phones = calls.map((call) => call.phone_mask).filter((phone) => phone && phone !== "—");
  if (phones.length === 0) {
    return "Chưa báo về";
  }
  if (phones.length <= 2) {
    return phones.join(", ");
  }
  return `${phones.slice(0, 2).join(", ")} +${phones.length - 2}`;
}

function TaskCalls(props: { task: HistoryItem; calls: HistoryItem[]; columns: TableColumnsType<HistoryItem> }) {
  if (props.calls.length === 0) {
    const expected = props.task.facts?.number_count;
    return <p className="page-note">{expected ? `Task có ${expected} số, nhưng Laaffic chưa gửi báo cáo từng cuộc gọi.` : "Laaffic chưa gửi báo cáo từng cuộc gọi."}</p>;
  }
  return <Table rowKey="provider_ref" size="small" columns={props.columns} dataSource={props.calls} pagination={false} />;
}

function taskSummary(row: HistoryItem): string {
  const facts = row.facts;
  const parts = [
    facts?.number_count != null ? `${facts.number_count} số` : "",
    facts?.called_count != null ? `${facts.called_count} đã gọi` : "",
    facts?.answered_count != null ? `${facts.answered_count} nghe` : "",
    facts?.failed_count != null ? `${facts.failed_count} lỗi` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function CallOutcome(props: { row: HistoryItem }) {
  const description = callDescription(props.row.facts?.call_description);
  const reason = props.row.facts?.termination_reason?.trim() ?? "";
  const headline = description === "—" ? reason || "—" : description;
  return (
    <div>
      <div>{headline}</div>
      {reason && reason !== headline ? <Typography.Text type="secondary">{reason}</Typography.Text> : null}
    </div>
  );
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
