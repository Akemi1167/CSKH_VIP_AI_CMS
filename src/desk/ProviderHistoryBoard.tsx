import { Button, Input, Modal, Table, Typography } from "antd";
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
  game_account?: string | null;
  campaign_name?: string | null;
};

type VoiceFilter = { task: string; phone: string; account: string };

const EMPTY_FILTER: VoiceFilter = { task: "", phone: "", account: "" };

export function ProviderHistoryBoard(props: {
  channel: Channel;
  title: string;
  lead: string;
  canSync: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [draft, setDraft] = useState<VoiceFilter>(EMPTY_FILTER);
  const [filters, setFilters] = useState<VoiceFilter>(EMPTY_FILTER);
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
    [props.onUnauthorized, props.onMfaSetup],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams({ channel: props.channel });
    if (props.channel === "ai_voice") {
      if (filters.task.trim()) {
        params.set("task", filters.task.trim());
      }
      if (filters.phone.trim()) {
        params.set("phone", filters.phone.trim());
      }
      if (filters.account.trim()) {
        params.set("account", filters.account.trim());
      }
    }
    const result = await api<{ items: HistoryItem[] }>(`/api/v1/admin/laaffic/history?${params.toString()}`);
    setItems(result.items);
    setError(null);
  }, [filters, props.channel]);

  useEffect(() => {
    if (props.channel !== "ai_voice") {
      return;
    }
    const timer = window.setInterval(() => {
      load().catch((caught: unknown) => {
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được lịch sử", "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [failAuth, load, props.channel]);

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
    { title: "Tài khoản", width: 150, ellipsis: true, render: (_value, row) => row.game_account || "—" },
    { title: "Trạng thái", width: 150, render: (_value, row) => callStatus(row) },
    { title: "Thời lượng", width: 120, render: (_value, row) => durationLabel(row.facts?.duration_seconds) },
    { title: "Kết quả", render: (_value, row) => <CallOutcome row={row} /> },
    { title: "Hội thoại", width: 120, render: (_value, row) => <DialogueCell turns={row.facts?.dialogue ?? null} /> },
    { title: "Nghe lại", width: 110 },
  ];
  const calls = items.filter((row) => !isTaskRow(row)).sort((a, b) => timeValue(b.happened_at) - timeValue(a.happened_at));
  const tasks = items.filter(isTaskRow).sort((a, b) => timeValue(taskMoment(b, calls)) - timeValue(taskMoment(a, calls)));
  const taskColumns: TableColumnsType<HistoryItem> = [
    { title: "Lúc gọi", width: 168, render: (_value, row) => stamp(taskMoment(row, calls)) },
    { title: "Task", ellipsis: true, render: (_value, row) => <TaskTitle row={row} /> },
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
          : "Tự lấy báo cáo Laaffic mỗi 2 phút. Bấm một task để xem từng số đã gọi. Số và file nghe chỉ có khi Laaffic gửi báo cáo cuộc gọi về."}
      </p>
      {props.channel === "ai_voice" ? <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {props.channel === "ai_voice" ? (
        <div className="filter-bar">
          <div className="filter-bar__fields">
            <Input
              allowClear
              placeholder="Task hoặc tên chiến dịch"
              value={draft.task}
              onChange={(event) => setDraft({ ...draft, task: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 220 }}
            />
            <Input
              allowClear
              placeholder="Số điện thoại"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 180 }}
            />
            <Input
              allowClear
              placeholder="Tên tài khoản"
              value={draft.account}
              onChange={(event) => setDraft({ ...draft, account: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 180 }}
            />
            <Button type="primary" onClick={() => setFilters(draft)}>
              Tìm
            </Button>
            <Button
              onClick={() => {
                setDraft(EMPTY_FILTER);
                setFilters(EMPTY_FILTER);
              }}
            >
              Xóa lọc
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? <p className="page-note">{notice}</p> : null}
      {props.channel === "sms" ? (
        <Table rowKey="provider_ref" size="middle" columns={smsColumns} dataSource={items} loading={loading} pagination={false} locale={{ emptyText: "Chưa có lịch sử. Bấm đồng bộ để lấy từ Laaffic." }} />
      ) : (
        <>
          <Typography.Title level={5}>Task gọi nhóm</Typography.Title>
          <Table
            className="history-table"
            rowKey="provider_ref"
            size="middle"
            columns={taskColumns}
            dataSource={tasks}
            loading={loading}
            pagination={false}
            locale={{ emptyText: filters.task || filters.phone || filters.account ? "Không có task khớp bộ lọc." : "Chưa có task." }}
            expandable={{
              expandedRowRender: (task) => (
                <TaskCalls
                  task={task}
                  calls={callsFor(task, calls)}
                  columns={callColumns}
                  onFail={(problem) => {
                    if (!failAuth(problem)) {
                      setError(problem);
                    }
                  }}
                />
              ),
              rowExpandable: () => true,
            }}
          />
          {looseCalls.length > 0 ? (
            <div className="history-block">
              <Typography.Title level={5}>Cuộc gọi chưa gắn task</Typography.Title>
              <CallTable
                calls={looseCalls}
                columns={callColumns}
                onFail={(problem) => {
                  if (!failAuth(problem)) {
                    setError(problem);
                  }
                }}
              />
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

function timeValue(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function taskMoment(task: HistoryItem, calls: HistoryItem[]): string | null {
  let best = task.happened_at;
  let bestValue = timeValue(best);
  for (const call of callsFor(task, calls)) {
    const value = timeValue(call.happened_at);
    if (value > bestValue) {
      best = call.happened_at;
      bestValue = value;
    }
  }
  return best;
}

function TaskTitle(props: { row: HistoryItem }) {
  const name = props.row.facts?.task_name || props.row.facts?.task_id || props.row.detail || "—";
  return (
    <div>
      <div>{name}</div>
      {props.row.campaign_name ? <Typography.Text type="secondary">{props.row.campaign_name}</Typography.Text> : null}
    </div>
  );
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

function TaskCalls(props: { task: HistoryItem; calls: HistoryItem[]; columns: TableColumnsType<HistoryItem>; onFail: (error: ApiError) => void }) {
  if (props.calls.length === 0) {
    const expected = props.task.facts?.number_count;
    return <p className="page-note">{expected ? `Task có ${expected} số, nhưng Laaffic chưa gửi báo cáo từng cuộc gọi.` : "Laaffic chưa gửi báo cáo từng cuộc gọi."}</p>;
  }
  return <CallTable calls={props.calls} columns={props.columns} onFail={props.onFail} />;
}

function CallTable(props: { calls: HistoryItem[]; columns: TableColumnsType<HistoryItem>; onFail: (error: ApiError) => void }) {
  const [clip, setClip] = useState<{ ref: string; url: string } | null>(null);
  const columns = props.columns.map((column) =>
    column.title === "Nghe lại"
      ? {
          ...column,
          render: (_value: unknown, row: HistoryItem) => (
            <RecordingCell
              providerRef={row.provider_ref}
              canTry={Boolean(row.facts?.recording_id)}
              active={clip?.ref === row.provider_ref}
              onPlay={(url) => setClip({ ref: row.provider_ref, url })}
              onFail={props.onFail}
            />
          ),
        }
      : column,
  );
  return (
    <div className="history-calls">
      <Table rowKey="provider_ref" size="small" columns={columns} dataSource={props.calls} pagination={false} />
      {clip ? (
        <div className="history-player">
          <audio className="history-audio" controls autoPlay preload="none" src={clip.url} />
        </div>
      ) : null}
    </div>
  );
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
  const turns = props.turns ?? [];
  if (turns.length === 0) {
    return <span>Chưa có thoại</span>;
  }
  const first = turns[0];
  return (
    <>
      <div className="call-log-preview">{first ? `${first.role}: ${first.text}` : ""}</div>
      <Button size="small" onClick={() => setOpen(true)}>
        Xem {turns.length} lượt
      </Button>
      <Modal open={open} title="Nội dung cuộc gọi" footer={null} onCancel={() => setOpen(false)}>
        <div className="log-dialogue">
          {turns.map((turn, index) => (
            <p key={`${turn.role}-${index}`}>
              <strong>{turn.role}.</strong> {turn.text}
              {turn.at ? <time>{formatStamp(turn.at)}</time> : null}
            </p>
          ))}
        </div>
      </Modal>
    </>
  );
}

function RecordingCell(props: { providerRef: string; canTry: boolean; active: boolean; onPlay: (url: string) => void; onFail: (error: ApiError) => void }) {
  const [busy, setBusy] = useState(false);
  if (!props.canTry) {
    return <span>Chưa có file</span>;
  }
  return (
    <Button
      size="small"
      type={props.active ? "primary" : "default"}
      loading={busy}
      onClick={() => {
        setBusy(true);
        api<{ url: string }>(`/api/v1/admin/laaffic/history/${encodeURIComponent(props.providerRef)}/recording`)
          .then((result) => props.onPlay(result.url))
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
