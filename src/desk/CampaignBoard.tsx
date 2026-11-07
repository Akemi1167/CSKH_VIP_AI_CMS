import { PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Select, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
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

function callResult(row: CallRow): string {
  if (row.status === "DELIVERED") {
    return "Đã kết nối";
  }
  if (row.status === "FAILED") {
    return "Không kết nối";
  }
  if (row.status === "QUEUED" && row.attempts > 0) {
    return "Chờ gọi lại";
  }
  if (row.status === "PROVIDER_ACCEPTED" || row.status === "SUBMITTED") {
    return "Đang gọi";
  }
  if (row.status === "QUEUED") {
    return "Đang chờ";
  }
  if (row.status === "UNKNOWN") {
    return "Chưa rõ";
  }
  return row.status;
}

function countLabel(channel: Channel, status: string): string {
  if (channel === "ai_voice") {
    if (status === "DELIVERED") {
      return "Đã kết nối";
    }
    if (status === "FAILED") {
      return "Không kết nối";
    }
    if (status === "PROVIDER_ACCEPTED" || status === "SUBMITTED") {
      return "Đang gọi";
    }
  }
  return COUNT_LABEL[status] ?? status;
}

function channelLabel(channel: Channel): string {
  if (channel === "sms") {
    return "SMS";
  }
  if (channel === "telegram") {
    return "Telegram";
  }
  return "Gọi AI";
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nháp",
  RUNNING: "Đang chạy",
  PAUSED: "Tạm dừng",
  COMPLETED: "Xong",
};

const COUNT_LABEL: Record<string, string> = {
  QUEUED: "Đang chờ",
  SUBMITTED: "Đã gửi",
  PROVIDER_ACCEPTED: "Nhà mạng nhận",
  DELIVERED: "Đã tới",
  FAILED: "Lỗi",
  UNKNOWN: "Chưa rõ",
};

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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được chiến dịch", "");
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
      catchProblem(caught, "Không đếm được người nhận");
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
      catchProblem(caught, "Không chạy được chiến dịch");
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
      catchProblem(caught, "Không đổi được trạng thái");
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
      catchProblem(caught, "Không tải được kết quả");
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
      setListNote(result.missing > 0 ? `Đã gắn ${result.listed}. Không thấy ${result.missing}.` : `Đã gắn ${result.listed}.`);
      setAudience(null);
      await refreshSelected(selected.id);
    } catch (caught) {
      catchProblem(caught, "Không gắn được danh sách");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = draft.name.trim();
    if (name.length < 2) {
      setError(new ApiError(400, "validation_error", "Tên cần từ 2 ký tự", ""));
      return;
    }
    if (!/^[A-Za-z0-9]{2,16}$/.test(draft.site)) {
      setError(new ApiError(400, "validation_error", "Chọn đài nhận tin", ""));
      return;
    }
    if (draft.channel === "telegram" && draft.body.trim().length === 0) {
      setError(new ApiError(400, "validation_error", "Telegram cần nội dung", ""));
      return;
    }
    if (draft.channel === "sms" && draft.body.includes("{link}") && draft.destinationUrl.trim().length === 0) {
      setError(new ApiError(400, "validation_error", "Nội dung có {link} thì cần link đích", ""));
      return;
    }
    if (draft.channel === "ai_voice" && !/^\d{1,12}$/.test(draft.agentId.trim())) {
      setError(new ApiError(400, "validation_error", "Cần mã agent Laaffic", ""));
      return;
    }
    if (draft.channel === "ai_voice" && draft.dimensionId.trim().length > 0 && !/^\d{1,12}$/.test(draft.dimensionId.trim())) {
      setError(new ApiError(400, "validation_error", "Mã chiều chỉ gồm số", ""));
      return;
    }
    if (draft.channel === "ai_voice" && !["1", "2", "3", "4", "5"].includes(draft.maxAttempts)) {
      setError(new ApiError(400, "validation_error", "Số lần gọi từ 1 đến 5", ""));
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
      catchProblem(caught, "Không tạo được chiến dịch");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function readRosterFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
      setError(new ApiError(400, "validation_error", "Chỉ nhận file .csv hoặc .xlsx", ""));
      return;
    }
    if (file.size === 0 || file.size > 1_048_576) {
      setError(new ApiError(400, "validation_error", file.size === 0 ? "File trống" : "File vượt 1 MB", ""));
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
      setListNote(`Đã đọc ${result.rows.length} dòng từ file. Kiểm tra rồi tạo task.`);
    } catch (caught) {
      catchProblem(caught, "Không đọc được file");
    } finally {
      setReadingFile(false);
    }
  }

  async function createTask() {
    const name = draft.name.trim();
    if (name.length < 2) {
      setError(new ApiError(400, "validation_error", "Tên cần từ 2 ký tự", ""));
      return;
    }
    if (!/^\d{1,12}$/.test(draft.agentId.trim())) {
      setError(new ApiError(400, "validation_error", "Cần mã agent Laaffic", ""));
      return;
    }
    if (draft.dimensionId.trim().length > 0 && !/^\d{1,12}$/.test(draft.dimensionId.trim())) {
      setError(new ApiError(400, "validation_error", "Mã chiều chỉ gồm số", ""));
      return;
    }
    const parsed = parseRoster(callList);
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
          ? `Đã tạo ${result.created_customers} hội viên mới, dùng lại ${result.reused_customers}, tạo ${taskCount} task. Bấm dòng task rồi chạy.`
          : "Chưa tạo được task. Kiểm tra các dòng bị bỏ.",
      );
      if (taskCount > 0) {
        setCallList("");
        setDraft({ ...draft, name: "" });
      }
      await load(status);
    } catch (caught) {
      catchProblem(caught, "Không tạo được danh sách gọi");
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<Campaign> = [
    { title: "Tên", dataIndex: "name", ellipsis: true },
    { title: "Đài", dataIndex: "site", width: 100, render: (value: string | null) => value || "—" },
    props.voiceTasks
      ? { title: "Số lần", dataIndex: "max_attempts", width: 90 }
      : { title: "Kênh", width: 120, dataIndex: "channel", render: (value: Channel) => channelLabel(value) },
    { title: "Trạng thái", width: 130, dataIndex: "status", render: (value: string) => STATUS_LABEL[value] ?? value },
    { title: "Tạo lúc", width: 160, dataIndex: "created_at", render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.voiceTasks ? "Task gọi nhóm" : "Chiến dịch"}
          </Typography.Title>
          <Typography.Text type="secondary">
            {props.voiceTasks
              ? "Nhập tài khoản, số điện thoại, cấp VIP và đài. Hệ thống tạo hội viên VIP rồi tạo task gọi từ đúng danh sách đó."
              : "SMS hoặc cuộc gọi AI cho hội viên đã đồng ý kênh đó."}
          </Typography.Text>
        </div>
        <Space>
          <Select
            value={status}
            style={{ width: 150 }}
            onChange={setStatus}
            options={[
              { value: "all", label: "Mọi trạng thái" },
              { value: "DRAFT", label: "Nháp" },
              { value: "RUNNING", label: "Đang chạy" },
              { value: "PAUSED", label: "Tạm dừng" },
              { value: "COMPLETED", label: "Xong" },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(status).catch((caught: unknown) => catchProblem(caught, "Không tải được chiến dịch"))}>
            Tải lại
          </Button>
          {props.canCreate && !props.voiceTasks ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelected(null); setCreateOpen(true); }}>
              Tạo nháp
            </Button>
          ) : null}
        </Space>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {props.voiceTasks && props.canCreate && props.canImport ? (
        <Form className="shift-form" layout="vertical" requiredMark={false} style={{ maxWidth: 720, marginBottom: 16 }} onFinish={() => void createTask()}>
          <Form.Item label="Tên task">
            <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Form.Item>
          <Form.Item label="Mã agent Laaffic" help="Cuộc gọi được ghi âm.">
            <Input value={draft.agentId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
          </Form.Item>
          <Form.Item label="Mã chiều" help="Để trống nếu agent không dùng chiều.">
            <Input value={draft.dimensionId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, dimensionId: event.target.value })} />
          </Form.Item>
          <Form.Item label="Số lần gọi" help="Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút.">
            <Select value={draft.maxAttempts} onChange={(value) => setDraft({ ...draft, maxAttempts: value })} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item label="Danh sách hội viên" help="Mỗi dòng 4 cột, cách nhau bằng tab hoặc dấu phẩy: tài khoản, số điện thoại, cấp VIP, đài. File .csv hoặc .xlsx cùng 4 cột, tối đa 1 MB và 500 dòng. Dòng tiêu đề nếu có sẽ được bỏ qua.">
            <div className="roster-file">
              <Button htmlType="button" icon={<UploadOutlined />} loading={readingFile} disabled={busy} onClick={() => rosterFileRef.current?.click()}>
                Nhập Excel / CSV
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
            Nhập danh sách và tạo task
          </Button>
        </Form>
      ) : null}
      {props.voiceTasks && listNote ? <p className="page-note">{listNote}</p> : null}
      {props.voiceTasks && skips.length > 0 ? (
        <ul className="import-errors">
          {skips.slice(0, 8).map((item) => (
            <li key={`${item.line}-${item.reason}`}>
              Dòng {item.line}: {item.reason}
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
        locale={{ emptyText: props.voiceTasks ? "Chưa có task gọi." : "Chưa có chiến dịch." }}
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
      <Drawer title={selected?.name ?? "Chiến dịch"} open={selected !== null || createOpen} width={560} onClose={() => { setSelected(null); setCreateOpen(false); }}>
        {createOpen ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void create()}>
            <Form.Item label="Tên">
              <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Form.Item>
            <Form.Item label="Kênh">
              <Select value={draft.channel} onChange={(channel) => setDraft({ ...draft, channel })} options={[{ value: "sms", label: "SMS" }, { value: "telegram", label: "Telegram" }, { value: "ai_voice", label: "Gọi AI" }]} />
            </Form.Item>
            <Form.Item label="Đài">
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
                <Form.Item label="Nội dung" help="Để trống thì dùng mẫu tin của đài. Dùng {link} nếu cần gắn mã chiến dịch.">
                  <Input.TextArea rows={4} value={draft.body} maxLength={1024} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
                </Form.Item>
                <Form.Item label="Link đích">
                  <Input value={draft.destinationUrl} placeholder="https://" onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} />
                </Form.Item>
              </>
            ) : draft.channel === "telegram" ? (
              <Form.Item label="Nội dung" help="Gửi cho hội viên đã đồng ý Telegram và đang có hội thoại với bot. Không gồm kho data và người bị chặn.">
                <Input.TextArea rows={4} value={draft.body} maxLength={1024} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              </Form.Item>
            ) : (
              <>
                <Form.Item label="Mã agent Laaffic" help="Lấy trên màn hình agent của Laaffic. Cuộc gọi được ghi âm.">
                  <Input value={draft.agentId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
                </Form.Item>
                <Form.Item label="Mã chiều" help="Để trống nếu agent không dùng chiều.">
                  <Input value={draft.dimensionId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, dimensionId: event.target.value })} />
                </Form.Item>
                <Form.Item label="Số lần gọi" help="Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút.">
                  <Select value={draft.maxAttempts} onChange={(value) => setDraft({ ...draft, maxAttempts: value })} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
                </Form.Item>
              </>
            )}
            <Button type="primary" htmlType="submit" loading={busy}>
              Lưu nháp
            </Button>
          </Form>
        ) : selected ? (
          <>
            <p className="page-note">
              {selected.site ? `${selected.site} · ` : ""}
              {channelLabel(selected.channel)} · {STATUS_LABEL[selected.status] ?? selected.status}
            </p>
            {selected.channel === "telegram" ? (
              <p className="page-note">Hỏi thăm qua bot. Chỉ hội viên đã đồng ý Telegram, có hội thoại, không thuộc kho data và không bị chặn.</p>
            ) : null}
            {selected.channel === "ai_voice" ? (
              <p className="page-note">
                Agent {selected.agent_id || "—"}
                {selected.dimension_id ? ` · chiều ${selected.dimension_id}` : ""}. Gọi tối đa {selected.max_attempts || 1} lần. Ghi âm bật, nghe lại ở lịch sử cuộc gọi khi Laaffic báo về. Chỉ gọi hội viên đã đồng ý, không gồm kho data và nuôi SMS.
              </p>
            ) : null}
            {selected.body ? <p>{selected.body}</p> : null}
            {audience ? (
              <p className="page-note">
                {audience.listed > 0 ? `Danh sách ${audience.listed}. ` : selected.channel === "ai_voice" ? "Chưa gắn danh sách. " : ""}
                Đủ điều kiện {audience.eligible}. Thiếu đồng ý {audience.missing_consent}.
                {selected.channel === "sms" ? ` Gửi SMS gần đây ${audience.recent_send}.` : ""}
              </p>
            ) : null}
            {listNote ? <p className="page-note">{listNote}</p> : null}
            {counts ? (
              <p className="page-note">
                {Object.entries(counts)
                  .map(([key, value]) => `${countLabel(selected.channel, key)} ${value}`)
                  .join(" · ") || "Chưa có lượt gửi."}
              </p>
            ) : null}
            {people ? (
              <Table
                style={{ marginTop: 12 }}
                size="small"
                rowKey={(row) => `${row.game_account ?? "member"}-${row.status}-${row.updated_at}`}
                pagination={false}
                dataSource={people}
                locale={{ emptyText: "Chưa có lượt gọi." }}
                columns={[
                  { title: "Tài khoản", render: (_, row) => row.game_account || "Hội viên" },
                  { title: "Kết quả", render: (_, row) => callResult(row) },
                  { title: "Lần", dataIndex: "attempts", width: 70 },
                ]}
              />
            ) : null}
            {selected.channel === "ai_voice" && selected.status === "DRAFT" && props.canCreate ? (
              <Form layout="vertical" style={{ marginTop: 16 }} requiredMark={false} onFinish={() => void attachList()}>
                <Form.Item label="Số lần gọi" help="Kể cả lần đầu. Chưa kết nối thì gọi lại sau 15 phút, đến hết số lần.">
                  <Select value={attemptChoice} onChange={setAttemptChoice} options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))} />
                </Form.Item>
                <Form.Item label="Danh sách cần gọi" help="Mỗi dòng một tài khoản game hoặc số điện thoại đã có trong hội viên của đài. Tối đa 500 dòng. Kho data, nuôi SMS và người chưa đồng ý sẽ không được gọi.">
                  <Input.TextArea rows={6} value={callList} onChange={(event) => setCallList(event.target.value)} />
                </Form.Item>
                <Button htmlType="submit" loading={busy} disabled={callList.trim().length === 0}>
                  Gắn danh sách
                </Button>
              </Form>
            ) : null}
            <Space wrap>
              {props.canValidate && selected.status === "DRAFT" ? (
                <Button loading={busy} onClick={() => void validate()}>
                  Đếm người nhận
                </Button>
              ) : null}
              {props.canReport ? (
                <Button loading={busy} onClick={() => void loadResults()}>
                  Xem kết quả
                </Button>
              ) : null}
              {props.canManage && selected.status === "RUNNING" ? (
                <Button loading={busy} onClick={() => void setRunning("pause")}>
                  Tạm dừng
                </Button>
              ) : null}
              {props.canManage && selected.status === "PAUSED" ? (
                <Button loading={busy} onClick={() => void setRunning("resume")}>
                  Chạy tiếp
                </Button>
              ) : null}
            </Space>
            {props.canLaunch && selected.status === "DRAFT" ? (
              <Form layout="vertical" style={{ marginTop: 16 }} requiredMark={false} onFinish={() => void launch()}>
                {selected.channel === "ai_voice" ? <p className="page-note">Cần gắn danh sách trước khi chạy.</p> : null}
                <Form.Item label="Ghi chú lần chạm">
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={busy} disabled={careNote.trim().length === 0}>
                  Chạy chiến dịch
                </Button>
              </Form>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </section>
  );
}

function parseRoster(text: string): { rows: { line: number; account: string; phone: string; tier: string; site: string }[]; error?: string } {
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
      return { rows: [], error: `Dòng ${index + 1} cần 4 cột: tài khoản, số điện thoại, cấp VIP, đài` };
    }
    rows.push({ line: index + 1, account: fields[0] ?? "", phone: fields[1] ?? "", tier: fields[2] ?? "", site: fields[3] ?? "" });
  }
  if (rows.length === 0) {
    return { rows: [], error: "Danh sách trống" };
  }
  if (rows.length > 500) {
    return { rows: [], error: "Danh sách tối đa 500 dòng" };
  }
  return { rows };
}

function isRosterHeader(fields: string[]): boolean {
  const folded = fields.map((field) => field.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase());
  return folded.some((field) => field.includes("tai khoan") || field.includes("tai_khoan") || field === "account") && folded.some((field) => field.includes("sdt") || field.includes("dien thoai") || field.includes("phone"));
}
