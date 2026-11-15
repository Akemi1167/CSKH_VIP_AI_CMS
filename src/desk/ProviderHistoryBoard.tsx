import { Button, Input, Modal, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
import { useDeskLang, useTr } from "./language.tsx";

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

type Tr = (vi: string, zh: string) => string;

const EMPTY_FILTER: VoiceFilter = { task: "", phone: "", account: "" };

export function ProviderHistoryBoard(props: {
  channel: Channel;
  title: string;
  lead: string;
  canSync: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const lang = useDeskLang();
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được lịch sử", "无法加载记录"), "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [failAuth, lang, load, props.channel]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được lịch sử", "无法加载记录"), "");
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
          ? tr(`Đã đồng bộ ${result.pulled} task. Danh sách này không có mã file ghi âm.`, `已同步 ${result.pulled} 个任务。此列表没有录音文件编号。`)
          : tr(`Đã đồng bộ ${result.pulled} dòng từ Laaffic.`, `已从 Laaffic 同步 ${result.pulled} 行。`),
      );
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không đồng bộ được", "无法同步"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSyncing(false);
    }
  }

  const smsColumns: TableColumnsType<HistoryItem> = [
    { title: tr("Lúc", "时间"), dataIndex: "happened_at", width: 160, render: (value: string | null) => stamp(value) },
    { title: tr("Số", "号码"), dataIndex: "phone_mask", width: 140 },
    { title: tr("Trạng thái", "状态"), dataIndex: "status_label", width: 140, render: (value: string) => providerStatus(value, tr) },
    { title: tr("Mã Laaffic", "Laaffic 编号"), dataIndex: "provider_ref", ellipsis: true },
  ];
  const callColumns: TableColumnsType<HistoryItem> = [
    { title: tr("Lúc gọi", "呼叫时间"), dataIndex: "happened_at", width: 168, render: (value: string | null) => stamp(value) },
    { title: tr("Số", "号码"), dataIndex: "phone_mask", width: 140 },
    { title: tr("Tài khoản", "账号"), width: 150, ellipsis: true, render: (_value, row) => row.game_account || "—" },
    { title: tr("Trạng thái", "状态"), width: 150, render: (_value, row) => callStatus(row, tr) },
    { title: tr("Thời lượng", "时长"), width: 120, render: (_value, row) => durationLabel(row.facts?.duration_seconds, tr) },
    { title: tr("Kết quả", "结果"), render: (_value, row) => <CallOutcome row={row} /> },
    { title: tr("Hội thoại", "对话"), width: 120, render: (_value, row) => <DialogueCell turns={row.facts?.dialogue ?? null} /> },
    { title: tr("Nghe lại", "回听"), width: 110 },
  ];
  const calls = items.filter((row) => !isTaskRow(row)).sort((a, b) => timeValue(b.happened_at) - timeValue(a.happened_at));
  const tasks = items.filter(isTaskRow).sort((a, b) => timeValue(taskMoment(b, calls)) - timeValue(taskMoment(a, calls)));
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
            {tr("Đồng bộ Laaffic", "同步 Laaffic")}
          </Button>
        ) : null}
      </div>
      <p className="page-note" style={{ marginTop: 0 }}>
        {props.channel === "sms"
          ? tr("Lấy 7 ngày gần nhất. Số được che. Không lưu nội dung tin.", "取最近 7 天。号码已掩码。不保存短信内容。")
          : tr("Tự lấy báo cáo Laaffic mỗi 2 phút. Mỗi task là một thẻ, các cuộc gọi nằm trong thẻ đó. Số và file nghe chỉ có khi Laaffic gửi báo cáo cuộc gọi về.", "每 2 分钟自动拉取 Laaffic 报告。每个任务为一张卡片，通话列在卡片内。号码和录音仅在 Laaffic 回传通话报告后才有。")}
      </p>
      {props.channel === "ai_voice" ? <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {props.channel === "ai_voice" ? (
        <div className="filter-bar">
          <div className="filter-bar__fields">
            <Input
              allowClear
              placeholder={tr("Task hoặc tên chiến dịch", "任务或活动名称")}
              value={draft.task}
              onChange={(event) => setDraft({ ...draft, task: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 220 }}
            />
            <Input
              allowClear
              placeholder={tr("Số điện thoại", "电话号码")}
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 180 }}
            />
            <Input
              allowClear
              placeholder={tr("Tên tài khoản", "账号")}
              value={draft.account}
              onChange={(event) => setDraft({ ...draft, account: event.target.value })}
              onPressEnter={() => setFilters(draft)}
              style={{ width: 180 }}
            />
            <Button type="primary" onClick={() => setFilters(draft)}>
              {tr("Tìm", "搜索")}
            </Button>
            <Button
              onClick={() => {
                setDraft(EMPTY_FILTER);
                setFilters(EMPTY_FILTER);
              }}
            >
              {tr("Xóa lọc", "清除筛选")}
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? <p className="page-note">{notice}</p> : null}
      {props.channel === "sms" ? (
        <Table rowKey="provider_ref" size="middle" columns={smsColumns} dataSource={items} loading={loading} pagination={false} locale={{ emptyText: tr("Chưa có lịch sử. Bấm đồng bộ để lấy từ Laaffic.", "还没有记录。点同步从 Laaffic 获取。") }} />
      ) : (
        <>
          {loading && tasks.length === 0 ? (
            <div className="voice-tasks__loading">
              <Spin />
            </div>
          ) : tasks.length === 0 ? (
            <p className="page-note">{filters.task || filters.phone || filters.account ? tr("Không có task khớp bộ lọc.", "没有符合筛选的任务。") : tr("Chưa có task.", "还没有任务。")}</p>
          ) : (
            <div className="voice-tasks">
              {tasks.map((task) => (
                <VoiceTaskCard
                  key={task.provider_ref}
                  task={task}
                  calls={callsFor(task, calls)}
                  columns={callColumns}
                  onFail={(problem) => {
                    if (!failAuth(problem)) {
                      setError(problem);
                    }
                  }}
                />
              ))}
            </div>
          )}
          {looseCalls.length > 0 ? (
            <div className="history-block">
              <Typography.Title level={5}>{tr("Cuộc gọi chưa gắn task", "未关联任务的通话")}</Typography.Title>
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

function durationLabel(seconds: number | null | undefined, tr: Tr): string {
  if (!seconds) {
    return "—";
  }
  if (seconds < 60) {
    return tr(`${seconds} giây`, `${seconds} 秒`);
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? tr(`${minutes} phút`, `${minutes} 分钟`) : tr(`${minutes} phút ${rest} giây`, `${minutes} 分 ${rest} 秒`);
}

function callsFor(task: HistoryItem, calls: HistoryItem[]): HistoryItem[] {
  const keys = [task.provider_ref, task.facts?.task_id ?? ""].filter((value) => value.length > 0);
  return calls.filter((call) => {
    const id = call.facts?.task_id ?? "";
    return id.length > 0 && keys.some((key) => key === id || (id.length >= 6 && key.startsWith(id)));
  });
}

function VoiceTaskCard(props: { task: HistoryItem; calls: HistoryItem[]; columns: TableColumnsType<HistoryItem>; onFail: (error: ApiError) => void }) {
  const tr = useTr();
  const named = props.task.facts?.task_name;
  const campaign = props.task.campaign_name;
  const title = named || campaign || tr("Task gọi nhóm", "群呼任务");
  const id = props.task.facts?.task_id || props.task.provider_ref;
  const facts = props.task.facts;
  const stats = [
    [tr("Tiến độ", "进度"), percent(facts?.progress)],
    [tr("Số", "号码"), facts?.number_count != null ? String(facts.number_count) : "—"],
    [tr("Đã gọi", "已呼叫"), facts?.called_count != null ? String(facts.called_count) : "—"],
    [tr("Nghe máy", "已接听"), facts?.answered_count != null ? String(facts.answered_count) : "—"],
    [tr("Lỗi", "失败"), facts?.failed_count != null ? String(facts.failed_count) : "—"],
    [tr("Tỷ lệ nghe", "接听率"), percent(facts?.answer_rate)],
  ];
  return (
    <article className="voice-task">
      <header className="voice-task__head">
        <div>
          <p className="voice-task__kicker">{tr("Task gọi nhóm", "群呼任务")}</p>
          <h3 className="voice-task__title">{title}</h3>
          <p className="voice-task__id">{id}</p>
          {named && campaign && named !== campaign ? <p className="voice-task__campaign">{tr(`Chiến dịch ${campaign}`, `活动 ${campaign}`)}</p> : null}
        </div>
        <div className="voice-task__meta">
          <Tag color={taskStatusColor(props.task.status_label)}>{providerStatus(props.task.status_label, tr)}</Tag>
          <time>{stamp(taskMoment(props.task, props.calls))}</time>
        </div>
      </header>
      <dl className="voice-task__stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="voice-task__calls">
        <p className="voice-task__calls-label">{props.calls.length > 0 ? tr(`${props.calls.length} cuộc gọi`, `${props.calls.length} 通通话`) : tr("Từng cuộc gọi", "通话明细")}</p>
        <TaskCalls task={props.task} calls={props.calls} columns={props.columns} onFail={props.onFail} />
      </div>
    </article>
  );
}

function taskStatusColor(label: string): string {
  if (label === "Đang gọi" || label === "Đang gửi") {
    return "blue";
  }
  if (label === "Đã gọi xong") {
    return "green";
  }
  if (label === "Gửi lỗi") {
    return "red";
  }
  if (label === "Tạm dừng") {
    return "gold";
  }
  return "default";
}

function TaskCalls(props: { task: HistoryItem; calls: HistoryItem[]; columns: TableColumnsType<HistoryItem>; onFail: (error: ApiError) => void }) {
  const tr = useTr();
  if (props.calls.length === 0) {
    const expected = props.task.facts?.number_count;
    return <p className="page-note">{expected ? tr(`Task có ${expected} số, nhưng Laaffic chưa gửi báo cáo từng cuộc gọi.`, `任务有 ${expected} 个号码，但 Laaffic 尚未回传每通通话报告。`) : tr("Laaffic chưa gửi báo cáo từng cuộc gọi.", "Laaffic 尚未回传每通通话报告。")}</p>;
  }
  return <CallTable calls={props.calls} columns={props.columns} onFail={props.onFail} />;
}

function CallTable(props: { calls: HistoryItem[]; columns: TableColumnsType<HistoryItem>; onFail: (error: ApiError) => void }) {
  const tr = useTr();
  const [clip, setClip] = useState<{ ref: string; url: string } | null>(null);
  const replay = tr("Nghe lại", "回听");
  const columns = props.columns.map((column) =>
    column.title === replay
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

function CallOutcome(props: { row: HistoryItem }) {
  const tr = useTr();
  const description = callDescription(props.row.facts?.call_description, tr);
  const reason = props.row.facts?.termination_reason?.trim() ?? "";
  const headline = description === "—" ? reason || "—" : description;
  return (
    <div>
      <div>{headline}</div>
      {reason && reason !== headline ? <Typography.Text type="secondary">{reason}</Typography.Text> : null}
    </div>
  );
}

function callStatus(row: HistoryItem, tr: Tr): string {
  const code = row.facts?.call_status;
  if (code === "1") {
    return tr("Đã nối máy", "已接通");
  }
  if (code === "2") {
    return tr("Nối máy lỗi", "接通失败");
  }
  if (code === "3") {
    return tr("Không nghe máy", "未接听");
  }
  if (code === "4") {
    return tr("Không nghe, lỗi", "未接听，失败");
  }
  return providerStatus(row.status_label, tr);
}

function providerStatus(label: string, tr: Tr): string {
  if (label === "Đang gọi") {
    return tr("Đang gọi", "正在呼叫");
  }
  if (label === "Đang gửi") {
    return tr("Đang gửi", "正在发送");
  }
  if (label === "Đã gọi xong") {
    return tr("Đã gọi xong", "呼叫完成");
  }
  if (label === "Gửi lỗi") {
    return tr("Gửi lỗi", "发送失败");
  }
  if (label === "Tạm dừng") {
    return tr("Tạm dừng", "已暂停");
  }
  return label;
}

function callDescription(code: string | null | undefined, tr: Tr): string {
  switch (code) {
    case "1":
      return tr("Hợp lệ", "有效");
    case "2":
      return tr("Thư thoại", "语音信箱");
    case "3":
      return tr("Cúp nhanh", "快速挂断");
    case "4":
      return tr("Im lặng", "无声");
    case "5":
      return tr("AI cúp", "AI挂断");
    case "6":
      return tr("Khách từ chối", "客户拒接");
    case "7":
      return tr("Ngoài vùng", "区域外");
    case "8":
      return tr("Không bắt máy", "未接听");
    case "10":
      return tr("Lỗi đường truyền", "线路故障");
    default:
      return "—";
  }
}

function DialogueCell(props: { turns: DialogueTurn[] | null }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const turns = props.turns ?? [];
  if (turns.length === 0) {
    return <span>{tr("Chưa có thoại", "暂无对话")}</span>;
  }
  const first = turns[0];
  return (
    <>
      <div className="call-log-preview">{first ? `${first.role}: ${first.text}` : ""}</div>
      <Button size="small" onClick={() => setOpen(true)}>
        {tr(`Xem ${turns.length} lượt`, `查看 ${turns.length} 轮`)}
      </Button>
      <Modal open={open} title={tr("Nội dung cuộc gọi", "通话内容")} footer={null} onCancel={() => setOpen(false)}>
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
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  if (!props.canTry) {
    return <span>{tr("Chưa có file", "暂无文件")}</span>;
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
            props.onFail(caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không mở được file nghe", "无法打开录音"), ""));
          })
          .finally(() => setBusy(false));
      }}
    >
      {tr("Nghe", "播放")}
    </Button>
  );
}
