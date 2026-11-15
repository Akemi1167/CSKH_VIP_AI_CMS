import { DownloadOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Select, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
import { useTr } from "./language.tsx";
import { TestVoice } from "./VoiceBoard.tsx";
import { ErrorAlert } from "../ui.tsx";

type Channel = "sms" | "ai_voice" | "telegram";
type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED";

type Campaign = {
  id: string;
  name: string;
  channel: Channel;
  site: string | null;
  status: CampaignStatus;
  body: string;
  agent_id: string | null;
  dimension_id: string | null;
  destination_url: string | null;
  max_attempts: number;
  created_at: string;
};

type Audience = { eligible: number; missing_consent: number; recent_send: number; listed: number };

type CallRow = { game_account: string | null; status: string; attempts: number; updated_at: string };

type Tr = (vi: string, zh: string) => string;

function callResult(row: CallRow, tr: Tr): string {
  if (row.status === "DELIVERED") {
    return tr("Đã kết nối", "已接通");
  }
  if (row.status === "FAILED") {
    return tr("Không kết nối", "未接通");
  }
  if (row.status === "QUEUED" && row.attempts > 0) {
    return tr("Chờ gọi lại", "待重呼");
  }
  if (row.status === "PROVIDER_ACCEPTED" || row.status === "SUBMITTED") {
    return tr("Đang gọi", "呼叫中");
  }
  if (row.status === "QUEUED") {
    return tr("Đang chờ", "等待中");
  }
  if (row.status === "UNKNOWN") {
    return tr("Chưa rõ", "未知");
  }
  return row.status;
}

function countLabel(channel: Channel, status: string, tr: Tr): string {
  if (channel === "ai_voice") {
    if (status === "DELIVERED") {
      return tr("Đã kết nối", "已接通");
    }
    if (status === "FAILED") {
      return tr("Không kết nối", "未接通");
    }
    if (status === "PROVIDER_ACCEPTED" || status === "SUBMITTED") {
      return tr("Đang gọi", "呼叫中");
    }
  }
  return countText(status, tr);
}

function channelLabel(channel: Channel, tr: Tr): string {
  if (channel === "sms") {
    return "SMS";
  }
  if (channel === "telegram") {
    return "Telegram";
  }
  return tr("Gọi AI", "AI呼叫");
}

function campaignStatusText(status: string, tr: Tr): string {
  if (status === "DRAFT") {
    return tr("Nháp", "草稿");
  }
  if (status === "RUNNING") {
    return tr("Đang chạy", "进行中");
  }
  if (status === "PAUSED") {
    return tr("Tạm dừng", "已暂停");
  }
  if (status === "COMPLETED") {
    return tr("Xong", "已完成");
  }
  return status;
}

function countText(status: string, tr: Tr): string {
  if (status === "QUEUED") {
    return tr("Đang chờ", "等待中");
  }
  if (status === "SUBMITTED") {
    return tr("Đã gửi", "已提交");
  }
  if (status === "PROVIDER_ACCEPTED") {
    return tr("Nhà mạng nhận", "运营商已接收");
  }
  if (status === "DELIVERED") {
    return tr("Đã tới", "已送达");
  }
  if (status === "FAILED") {
    return tr("Lỗi", "失败");
  }
  if (status === "UNKNOWN") {
    return tr("Chưa rõ", "未知");
  }
  return status;
}

export function CampaignBoard(props: {
  voiceTasks?: boolean;
  canCreate: boolean;
  canImport?: boolean;
  canValidate: boolean;
  canLaunch: boolean;
  canManage: boolean;
  canReport: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const [status, setStatus] = useState<string>("all");
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [people, setPeople] = useState<CallRow[] | null>(null);
  const [callList, setCallList] = useState("");
  const [listNote, setListNote] = useState<string | null>(null);
  const [skips, setSkips] = useState<{ line: number; reason: string }[]>([]);
  const [attemptChoice, setAttemptChoice] = useState("2");
  const [careNote, setCareNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const rosterFileRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  const [draft, setDraft] = useState({ name: "", channel: (props.voiceTasks ? "ai_voice" : "sms") as Channel, site: "", body: "", destinationUrl: "", agentId: "", dimensionId: "", maxAttempts: "2" });

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

  const load = useCallback(async (nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextStatus !== "all") {
      params.set("status", nextStatus);
    }
    if (props.voiceTasks) {
      params.set("channel", "ai_voice");
    }
    const query = params.toString();
    const result = await api<{ items: Campaign[] }>(`/api/v1/campaigns${query ? `?${query}` : ""}`);
    setItems(result.items);
    setError(null);
  }, [props.voiceTasks]);

  useEffect(() => {
    let ignore = false;
    api<{ items: { code: string }[] }>("/api/v1/stations")
      .then((result) => {
        if (!ignore) {
          setStations(result.items.map((item) => item.code));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(status)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được chiến dịch", "无法加载活动"), "");
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
  }, [failAuth, load, status]);

  function catchProblem(caught: unknown, fallback: string) {
    const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", fallback, "");
    if (!failAuth(problem)) {
      setError(problem);
    }
  }

  async function refreshSelected(id: string) {
    const next = await api<Campaign>(`/api/v1/campaigns/${id}`);
    setSelected(next);
    await load(status);
  }

  async function validate() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAudience(await api<Audience>(`/api/v1/campaigns/${selected.id}/validate`, { method: "POST", body: {} }));
    } catch (caught) {
      catchProblem(caught, tr("Không đếm được người nhận", "无法统计接收人数"));
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (!selected || careNote.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/campaigns/${selected.id}/launch`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { care_note: careNote.trim() },
      });
      setCareNote("");
      await refreshSelected(selected.id);
    } catch (caught) {
      catchProblem(caught, tr("Không chạy được chiến dịch", "无法开始活动"));
    } finally {
      setBusy(false);
    }
  }

  async function setRunning(to: "pause" | "resume") {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/campaigns/${selected.id}/${to}`, { method: "POST", body: {} });
      await refreshSelected(selected.id);
    } catch (caught) {
      catchProblem(caught, tr("Không đổi được trạng thái", "无法更改状态"));
    } finally {
      setBusy(false);
    }
  }

  async function loadResults() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ counts: Record<string, number>; items: CallRow[] }>(`/api/v1/campaigns/${selected.id}/results`);
      setCounts(result.counts);
      setPeople(result.items);
    } catch (caught) {
      catchProblem(caught, tr("Không tải được kết quả", "无法加载结果"));
    } finally {
      setBusy(false);
    }
  }

  async function attachList() {
    if (!selected) {
      return;
    }
    const accounts = callList.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (accounts.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ listed: number; missing: number }>(`/api/v1/campaigns/${selected.id}/call-list`, {
        method: "POST",
        body: { accounts, max_attempts: Number(attemptChoice) },
      });
      setListNote(result.missing > 0 ? tr(`Đã gắn ${result.listed}. Không thấy ${result.missing}.`, `已绑定 ${result.listed}。未找到 ${result.missing}。`) : tr(`Đã gắn ${result.listed}.`, `已绑定 ${result.listed}。`));
      setAudience(null);
      await refreshSelected(selected.id);
    } catch (caught) {
      catchProblem(caught, tr("Không gắn được danh sách", "无法绑定名单"));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = draft.name.trim();
    if (name.length < 2) {
      setError(new ApiError(400, "validation_error", tr("Tên cần từ 2 ký tự", "名称至少 2 个字符"), ""));
      return;
    }
    if (!/^[A-Za-z0-9]{2,16}$/.test(draft.site)) {
      setError(new ApiError(400, "validation_error", tr("Chọn đài nhận tin", "请选择接收站点"), ""));
      return;
    }
    if (draft.channel === "telegram" && draft.body.trim().length === 0) {
      setError(new ApiError(400, "validation_error", tr("Telegram cần nội dung", "Telegram 需要填写内容"), ""));
      return;
    }
    if (draft.channel === "sms" && draft.body.includes("{link}") && draft.destinationUrl.trim().length === 0) {
      setError(new ApiError(400, "validation_error", tr("Nội dung có {link} thì cần link đích", "内容包含 {link} 时需要目标链接"), ""));
      return;
    }
    if (draft.channel === "ai_voice" && !/^\d{1,12}$/.test(draft.agentId.trim())) {
      setError(new ApiError(400, "validation_error", tr("Cần mã agent Laaffic", "请填写 Laaffic 坐席编号"), ""));
      return;
    }
    if (draft.channel === "ai_voice" && draft.dimensionId.trim().length > 0 && !/^\d{1,12}$/.test(draft.dimensionId.trim())) {
      setError(new ApiError(400, "validation_error", tr("Mã chiều chỉ gồm số", "维度编号只能是数字"), ""));
      return;
    }
    if (draft.channel === "ai_voice" && !["1", "2", "3", "4", "5"].includes(draft.maxAttempts)) {
      setError(new ApiError(400, "validation_error", tr("Số lần gọi từ 1 đến 5", "呼叫次数为 1 到 5"), ""));
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, string | number> = { name, channel: draft.channel, site: draft.site, body: draft.channel === "ai_voice" ? "" : draft.body };
    if (draft.channel === "sms" && draft.destinationUrl.trim()) {
      body.destination_url = draft.destinationUrl.trim();
    }
    if (draft.channel === "ai_voice") {
      body.agent_id = draft.agentId.trim();
      body.max_attempts = Number(draft.maxAttempts);
      if (draft.dimensionId.trim()) {
        body.dimension_id = draft.dimensionId.trim();
      }
    }
    try {
      const created = await api<Campaign>("/api/v1/campaigns", { method: "POST", body });
      setCreateOpen(false);
      setDraft({ name: "", channel: props.voiceTasks ? "ai_voice" : "sms", site: "", body: "", destinationUrl: "", agentId: "", dimensionId: "", maxAttempts: "2" });
      await load(status);
      return created;
    } catch (caught) {
      catchProblem(caught, tr("Không tạo được chiến dịch", "无法创建活动"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    setReadingFile(true);
    setError(null);
    try {
      const response = await fetch(toApiUrl("/api/v1/campaigns/voice-roster/template"), {
        credentials: "include",
        headers: { "x-request-id": crypto.randomUUID() },
      });
      if (!response.ok) {
        throw new ApiError(response.status, "download_failed", tr("Không tải được file mẫu", "无法下载模板"), "");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "mau-goi-nhom.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      catchProblem(caught, tr("Không tải được file mẫu", "无法下载模板"));
    } finally {
      setReadingFile(false);
    }
  }

  async function readRosterFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
      setError(new ApiError(400, "validation_error", tr("Chỉ nhận file .csv hoặc .xlsx", "只接受 .csv 或 .xlsx 文件"), ""));
      return;
    }
    if (file.size === 0 || file.size > 1_048_576) {
      setError(new ApiError(400, "validation_error", file.size === 0 ? tr("File trống", "文件为空") : tr("File vượt 1 MB", "文件超过 1 MB"), ""));
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setReadingFile(true);
    setError(null);
    try {
      const result = await api<{ rows: { account: string; phone: string; tier: string; site: string }[] }>("/api/v1/campaigns/voice-roster/file", {
        method: "POST",
        body,
      });
      setCallList(result.rows.map((row) => [row.account, row.phone, row.tier, row.site].join("\t")).join("\n"));
      setSkips([]);
      setListNote(tr(`Đã đọc ${result.rows.length} dòng từ file. Kiểm tra rồi tạo task.`, `已从文件读取 ${result.rows.length} 行。请检查后创建任务。`));
    } catch (caught) {
      catchProblem(caught, tr("Không đọc được file", "无法读取文件"));
    } finally {
      setReadingFile(false);
    }
  }

  async function createTask() {
    const name = draft.name.trim();
    if (name.length < 2) {
      setError(new ApiError(400, "validation_error", tr("Tên cần từ 2 ký tự", "名称至少 2 个字符"), ""));
      return;
    }
    if (!/^\d{1,12}$/.test(draft.agentId.trim())) {
      setError(new ApiError(400, "validation_error", tr("Cần mã agent Laaffic", "请填写 Laaffic 坐席编号"), ""));
      return;
    }
    if (draft.dimensionId.trim().length > 0 && !/^\d{1,12}$/.test(draft.dimensionId.trim())) {
      setError(new ApiError(400, "validation_error", tr("Mã chiều chỉ gồm số", "维度编号只能是数字"), ""));
      return;
    }
    const parsed = parseRoster(callList, tr);
    if (parsed.error) {
      setError(new ApiError(400, "validation_error", parsed.error, ""));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ created_customers: number; reused_customers: number; skipped: { line: number; reason: string }[]; tasks: { id: string }[] }>(
        "/api/v1/campaigns/voice-roster",
        {
          method: "POST",
          body: {
            name,
            agent_id: draft.agentId.trim(),
            max_attempts: Number(draft.maxAttempts),
            ...(draft.dimensionId.trim() ? { dimension_id: draft.dimensionId.trim() } : {}),
            rows: parsed.rows,
          },
        },
      );
      const taskCount = result.tasks.length;
      setSkips(result.skipped);
      setListNote(
        taskCount > 0
          ? tr(`Đã tạo ${result.created_customers} hội viên mới, dùng lại ${result.reused_customers}, tạo ${taskCount} task. Bấm dòng task rồi chạy.`, `已新建 ${result.created_customers} 名会员，复用 ${result.reused_customers} 名，创建 ${taskCount} 个任务。点任务行后开始。`)
          : tr("Chưa tạo được task. Kiểm tra các dòng bị bỏ.", "还没能创建任务。请检查被跳过的行。"),
      );
      if (taskCount > 0) {
        setCallList("");
        setDraft({ ...draft, name: "" });
      }
      await load(status);
    } catch (caught) {
      catchProblem(caught, tr("Không tạo được danh sách gọi", "无法创建呼叫名单"));
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<Campaign> = [
    { title: tr("Tên", "名称"), dataIndex: "name", ellipsis: true },
    { title: tr("Đài", "站点"), dataIndex: "site", width: 100, render: (value: string | null) => value || "—" },
    props.voiceTasks
      ? { title: tr("Số lần", "次数"), dataIndex: "max_attempts", width: 90 }
      : { title: tr("Kênh", "渠道"), width: 120, dataIndex: "channel", render: (value: Channel) => channelLabel(value, tr) },
    { title: tr("Trạng thái", "状态"), width: 130, dataIndex: "status", render: (value: string) => campaignStatusText(value, tr) },
    { title: tr("Tạo lúc", "创建时间"), width: 160, dataIndex: "created_at", render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.voiceTasks ? tr("Task gọi nhóm", "群呼任务") : tr("Chiến dịch", "活动")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {props.voiceTasks
              ? tr("Nhập tài khoản, số điện thoại, cấp VIP và đài. Hệ thống tạo hội viên VIP rồi tạo task gọi từ đúng danh sách đó.", "填写账号、电话、VIP 等级和站点。系统会创建 VIP 会员，并按该名单创建呼叫任务。")
              : tr("SMS hoặc cuộc gọi AI cho hội viên đã đồng ý kênh đó.", "向已同意该渠道的会员发送短信或发起 AI 呼叫。")}
          </Typography.Text>
        </div>
        <Space>
          <Select
            value={status}
            style={{ width: 150 }}
            onChange={setStatus}
            options={[
              { value: "all", label: tr("Mọi trạng thái", "全部状态") },
              { value: "DRAFT", label: tr("Nháp", "草稿") },
              { value: "RUNNING", label: tr("Đang chạy", "进行中") },
              { value: "PAUSED", label: tr("Tạm dừng", "已暂停") },
              { value: "COMPLETED", label: tr("Xong", "已完成") },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(status).catch((caught: unknown) => catchProblem(caught, tr("Không tải được chiến dịch", "无法加载活动")))}>
            {tr("Tải lại", "刷新")}
          </Button>
          {props.canCreate && !props.voiceTasks ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelected(null); setCreateOpen(true); }}>
              {tr("Tạo nháp", "创建草稿")}
            </Button>
          ) : null}
        </Space>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {props.voiceTasks && props.canCreate && props.canImport ? (
        <Form className="shift-form" layout="vertical" requiredMark={false} style={{ maxWidth: 720, marginBottom: 16 }} onFinish={() => void createTask()}>
          <Form.Item label={tr("Tên task", "任务名称")}>
            <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Form.Item>
          <Form.Item label={tr("Mã agent Laaffic", "Laaffic 坐席编号")} help={tr("Cuộc gọi được ghi âm.", "通话会录音。")}>
            <Input value={draft.agentId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
          </Form.Item>
          <Form.Item label={tr("Mã chiều", "维度编号")} help={tr("Để trống nếu agent không dùng chiều.", "坐席不用维度时留空。")}>
            <Input value={draft.dimensionId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, dimensionId: event.target.value })} />
          </Form.Item>
          <Form.Item label={tr("Số lần gọi", "呼叫次数")} help={tr("Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút.", "含首次。未接通则 15 分钟后重呼。")}>
            <Select value={draft.maxAttempts} onChange={(value) => setDraft({ ...draft, maxAttempts: value })} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item label={tr("Danh sách hội viên", "会员名单")} help={tr("Tải file mẫu, điền hội viên, rồi nhập lại. Tiêu đề có tiếng Việt và tiếng Trung. Xóa hai dòng màu kem trước khi tải lên.", "下载模板，填写会员后再导入。表头包含越南语和中文。上传前请删除两行米色示例。")}>
            <div className="roster-file">
              <Button htmlType="button" icon={<DownloadOutlined />} disabled={busy || readingFile} onClick={() => void downloadTemplate()}>
                {tr("Tải file mẫu", "下载模板")}
              </Button>
              <Button htmlType="button" icon={<UploadOutlined />} loading={readingFile} disabled={busy} onClick={() => rosterFileRef.current?.click()}>
                {tr("Nhập Excel / CSV", "导入 Excel / CSV")}
              </Button>
              <input
                ref={rosterFileRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    void readRosterFile(file);
                  }
                }}
              />
            </div>
            <Input.TextArea rows={8} value={callList} placeholder={"vipuser01\t0901234567\tVIP1\tJ88"} onChange={(event) => setCallList(event.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} disabled={callList.trim().length === 0 || draft.name.trim().length < 2 || draft.agentId.trim().length === 0}>
            {tr("Nhập danh sách và tạo task", "导入名单并创建任务")}
          </Button>
        </Form>
      ) : null}
      {props.voiceTasks && listNote ? <p className="page-note">{listNote}</p> : null}
      {props.voiceTasks && skips.length > 0 ? (
        <ul className="import-errors">
          {skips.slice(0, 8).map((item) => (
            <li key={`${item.line}-${item.reason}`}>
              {tr("Dòng ", "第")}
              {item.line}
              {tr(": ", "行：")}
              {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {props.voiceTasks ? null : <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />}
      {props.voiceTasks || !props.canLaunch ? null : <TestVoice onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />}
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: props.voiceTasks ? tr("Chưa có task gọi.", "还没有呼叫任务。") : tr("Chưa có chiến dịch.", "还没有活动。") }}
        onRow={(row) => ({
          onClick: () => {
            setCreateOpen(false);
            setSelected(row);
            setAudience(null);
            setCounts(null);
            setPeople(null);
            if (!props.voiceTasks) {
              setCallList("");
              setListNote(null);
            }
            setAttemptChoice(String(row.max_attempts || 2));
            setCareNote("");
          },
        })}
      />
      <Drawer title={selected?.name ?? tr("Chiến dịch", "活动")} open={selected !== null || createOpen} width={560} onClose={() => { setSelected(null); setCreateOpen(false); }}>
        {createOpen ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void create()}>
            <Form.Item label={tr("Tên", "名称")}>
              <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Form.Item>
            <Form.Item label={tr("Kênh", "渠道")}>
              <Select value={draft.channel} onChange={(channel) => setDraft({ ...draft, channel })} options={[{ value: "sms", label: "SMS" }, { value: "telegram", label: "Telegram" }, { value: "ai_voice", label: tr("Gọi AI", "AI呼叫") }]} />
            </Form.Item>
            <Form.Item label={tr("Đài", "站点")}>
              <Select
                showSearch
                placeholder="J88"
                value={draft.site || undefined}
                options={stations.map((code) => ({ value: code, label: code }))}
                onChange={(site) => setDraft({ ...draft, site })}
              />
            </Form.Item>
            {draft.channel === "sms" ? (
              <>
                <Form.Item label={tr("Nội dung", "内容")} help={tr("Để trống thì dùng mẫu tin của đài. Dùng {link} nếu cần gắn mã chiến dịch.", "留空则使用站点短信模板。需要插入活动码时使用 {link}。")}>
                  <Input.TextArea rows={4} value={draft.body} maxLength={1024} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
                </Form.Item>
                <Form.Item label={tr("Link đích", "目标链接")}>
                  <Input value={draft.destinationUrl} placeholder="https://" onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} />
                </Form.Item>
              </>
            ) : draft.channel === "telegram" ? (
              <Form.Item label={tr("Nội dung", "内容")} help={tr("Gửi cho hội viên đã đồng ý Telegram và đang có hội thoại với bot. Không gồm kho data và người bị chặn.", "发送给已同意 Telegram 且正在与机器人对话的会员。不含数据集中库和被屏蔽的人。")}>
                <Input.TextArea rows={4} value={draft.body} maxLength={1024} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              </Form.Item>
            ) : (
              <>
                <Form.Item label={tr("Mã agent Laaffic", "Laaffic 坐席编号")} help={tr("Lấy trên màn hình agent của Laaffic. Cuộc gọi được ghi âm.", "在 Laaffic 的坐席页面获取。通话会录音。")}>
                  <Input value={draft.agentId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
                </Form.Item>
                <Form.Item label={tr("Mã chiều", "维度编号")} help={tr("Để trống nếu agent không dùng chiều.", "坐席不用维度时留空。")}>
                  <Input value={draft.dimensionId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, dimensionId: event.target.value })} />
                </Form.Item>
                <Form.Item label={tr("Số lần gọi", "呼叫次数")} help={tr("Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút.", "含首次。未接通则 15 分钟后重呼。")}>
                  <Select value={draft.maxAttempts} onChange={(value) => setDraft({ ...draft, maxAttempts: value })} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
                </Form.Item>
              </>
            )}
            <Button type="primary" htmlType="submit" loading={busy}>
              {tr("Lưu nháp", "保存草稿")}
            </Button>
          </Form>
        ) : selected ? (
          <>
            <p className="page-note">
              {selected.site ? `${selected.site} · ` : ""}
              {channelLabel(selected.channel, tr)} · {campaignStatusText(selected.status, tr)}
            </p>
            {selected.channel === "telegram" ? (
              <p className="page-note">{tr("Hỏi thăm qua bot. Chỉ hội viên đã đồng ý Telegram, có hội thoại, không thuộc kho data và không bị chặn.", "通过机器人问候。仅限已同意 Telegram、有对话、不属于数据集中库且未被屏蔽的会员。")}</p>
            ) : null}
            {selected.channel === "ai_voice" ? (
              <p className="page-note">
                {tr("Agent ", "坐席 ")}
                {selected.agent_id || "—"}
                {selected.dimension_id ? tr(` · chiều ${selected.dimension_id}`, ` · 维度 ${selected.dimension_id}`) : ""}
                {tr(". Gọi tối đa ", "。最多呼叫 ")}
                {selected.max_attempts || 1}
                {tr(" lần. Ghi âm bật, nghe lại ở lịch sử cuộc gọi khi Laaffic báo về. Chỉ gọi hội viên đã đồng ý, không gồm kho data và nuôi SMS.", " 次。已开启录音，Laaffic 回传后可在通话记录中回听。只呼叫已同意的会员，不含数据集中库和短信养号。")}
              </p>
            ) : null}
            {selected.body ? <p>{selected.body}</p> : null}
            {audience ? (
              <p className="page-note">
                {audience.listed > 0 ? tr(`Danh sách ${audience.listed}. `, `名单 ${audience.listed}。`) : selected.channel === "ai_voice" ? tr("Chưa gắn danh sách. ", "尚未绑定名单。") : ""}
                {tr("Đủ điều kiện ", "符合条件 ")}
                {audience.eligible}
                {tr(". Thiếu đồng ý ", "。未同意 ")}
                {audience.missing_consent}
                {tr(".", "。")}
                {selected.channel === "sms" ? tr(` Gửi SMS gần đây ${audience.recent_send}.`, ` 近期已发短信 ${audience.recent_send}。`) : ""}
              </p>
            ) : null}
            {listNote ? <p className="page-note">{listNote}</p> : null}
            {counts ? (
              <p className="page-note">
                {Object.entries(counts)
                  .map(([key, value]) => `${countLabel(selected.channel, key, tr)} ${value}`)
                  .join(" · ") || tr("Chưa có lượt gửi.", "还没有发送记录。")}
              </p>
            ) : null}
            {people ? (
              <Table
                style={{ marginTop: 12 }}
                size="small"
                rowKey={(row) => `${row.game_account ?? "member"}-${row.status}-${row.updated_at}`}
                pagination={false}
                dataSource={people}
                locale={{ emptyText: tr("Chưa có lượt gọi.", "还没有呼叫记录。") }}
                columns={[
                  { title: tr("Tài khoản", "账号"), render: (_, row) => row.game_account || tr("Hội viên", "会员") },
                  { title: tr("Kết quả", "结果"), render: (_, row) => callResult(row, tr) },
                  { title: tr("Lần", "次数"), dataIndex: "attempts", width: 70 },
                ]}
              />
            ) : null}
            {selected.channel === "ai_voice" && selected.status === "DRAFT" && props.canCreate ? (
              <Form layout="vertical" style={{ marginTop: 16 }} requiredMark={false} onFinish={() => void attachList()}>
                <Form.Item label={tr("Số lần gọi", "呼叫次数")} help={tr("Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút, đến hết số lần.", "含首次。未接通则 15 分钟后重呼，直到用完次数。")}>
                  <Select value={attemptChoice} onChange={setAttemptChoice} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
                </Form.Item>
                <Form.Item label={tr("Danh sách cần gọi", "待呼名单")} help={tr("Mỗi dòng một tài khoản game hoặc số điện thoại đã có trong hội viên của đài. Tối đa 500 dòng. Kho data, nuôi SMS và người chưa đồng ý sẽ không được gọi.", "每行一个已在该站点会员中的游戏账号或电话号码。最多 500 行。数据集中库、短信养号和未同意的人不会被呼叫。")}>
                  <Input.TextArea rows={6} value={callList} onChange={(event) => setCallList(event.target.value)} />
                </Form.Item>
                <Button htmlType="submit" loading={busy} disabled={callList.trim().length === 0}>
                  {tr("Gắn danh sách", "绑定名单")}
                </Button>
              </Form>
            ) : null}
            <Space wrap>
              {props.canValidate && selected.status === "DRAFT" ? (
                <Button loading={busy} onClick={() => void validate()}>
                  {tr("Đếm người nhận", "统计接收人数")}
                </Button>
              ) : null}
              {props.canReport ? (
                <Button loading={busy} onClick={() => void loadResults()}>
                  {tr("Xem kết quả", "查看结果")}
                </Button>
              ) : null}
              {props.canManage && selected.status === "RUNNING" ? (
                <Button loading={busy} onClick={() => void setRunning("pause")}>
                  {tr("Tạm dừng", "暂停")}
                </Button>
              ) : null}
              {props.canManage && selected.status === "PAUSED" ? (
                <Button loading={busy} onClick={() => void setRunning("resume")}>
                  {tr("Chạy tiếp", "继续")}
                </Button>
              ) : null}
            </Space>
            {props.canLaunch && selected.status === "DRAFT" ? (
              <Form layout="vertical" style={{ marginTop: 16 }} requiredMark={false} onFinish={() => void launch()}>
                {selected.channel === "ai_voice" ? <p className="page-note">{tr("Cần gắn danh sách trước khi chạy.", "开始前需要先绑定名单。")}</p> : null}
                <Form.Item label={tr("Ghi chú lần chạm", "本次触达备注")}>
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={busy} disabled={careNote.trim().length === 0}>
                  {tr("Chạy chiến dịch", "开始活动")}
                </Button>
              </Form>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </section>
  );
}

function parseRoster(text: string, tr: Tr): { rows: { line: number; account: string; phone: string; tier: string; site: string }[]; error?: string } {
  const lines = text.split(/\r?\n/);
  const rows: { line: number; account: string; phone: string; tier: string; site: string }[] = [];
  let skippedHeader = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]?.trim() ?? "";
    if (!raw) {
      continue;
    }
    const fields = (raw.includes("\t") ? raw.split("\t") : raw.includes(";") ? raw.split(";") : raw.split(",")).map((field) => field.trim());
    if (!skippedHeader && rows.length === 0 && isRosterHeader(fields)) {
      skippedHeader = true;
      continue;
    }
    if (fields.length !== 4 || fields.some((field) => field.length === 0)) {
      return { rows: [], error: tr(`Dòng ${index + 1} cần 4 cột: tài khoản, số điện thoại, cấp VIP, đài`, `第 ${index + 1} 行需要 4 列：账号、电话、VIP 等级、站点`) };
    }
    rows.push({ line: index + 1, account: fields[0] ?? "", phone: fields[1] ?? "", tier: fields[2] ?? "", site: fields[3] ?? "" });
  }
  if (rows.length === 0) {
    return { rows: [], error: tr("Danh sách trống", "名单为空") };
  }
  if (rows.length > 500) {
    return { rows: [], error: tr("Danh sách tối đa 500 dòng", "名单最多 500 行") };
  }
  return { rows };
}

function isRosterHeader(fields: string[]): boolean {
  const folded = fields.map((field) => field.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase());
  return folded.some((field) => field.includes("tai khoan") || field.includes("tai_khoan") || field === "account") && folded.some((field) => field.includes("sdt") || field.includes("dien thoai") || field.includes("phone"));
}
