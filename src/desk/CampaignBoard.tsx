import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Drawer, Form, Input, Select, Space, Table, Typography, Alert } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";

type Channel = "sms" | "ai_voice";
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
  created_at: string;
};

type Audience = { eligible: number; missing_consent: number; recent_send: number };

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
  canCreate: boolean;
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
  const [careNote, setCareNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  const [draft, setDraft] = useState({ name: "", channel: "sms" as Channel, site: "", body: "", destinationUrl: "", agentId: "", dimensionId: "" });

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

  const load = useCallback(async (nextStatus: string) => {
    const query = nextStatus === "all" ? "" : `?status=${nextStatus}`;
    const result = await api<{ items: Campaign[] }>(`/api/v1/campaigns${query}`);
    setItems(result.items);
    setError(null);
  }, []);

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
      const result = await api<{ counts: Record<string, number> }>(`/api/v1/campaigns/${selected.id}/results`);
      setCounts(result.counts);
    } catch (caught) {
      catchProblem(caught, "Không tải được kết quả");
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
    setBusy(true);
    setError(null);
    const body: Record<string, string> = { name, channel: draft.channel, site: draft.site, body: draft.channel === "sms" ? draft.body : "" };
    if (draft.channel === "sms" && draft.destinationUrl.trim()) {
      body.destination_url = draft.destinationUrl.trim();
    }
    if (draft.channel === "ai_voice") {
      body.agent_id = draft.agentId.trim();
      if (draft.dimensionId.trim()) {
        body.dimension_id = draft.dimensionId.trim();
      }
    }
    try {
      await api<Campaign>("/api/v1/campaigns", { method: "POST", body });
      setCreateOpen(false);
      setDraft({ name: "", channel: "sms", site: "", body: "", destinationUrl: "", agentId: "", dimensionId: "" });
      await load(status);
    } catch (caught) {
      catchProblem(caught, "Không tạo được chiến dịch");
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<Campaign> = [
    { title: "Tên", dataIndex: "name", ellipsis: true },
    { title: "Đài", dataIndex: "site", width: 100, render: (value: string | null) => value || "—" },
    { title: "Kênh", width: 110, dataIndex: "channel", render: (value: Channel) => (value === "sms" ? "SMS" : "Gọi AI") },
    { title: "Trạng thái", width: 130, dataIndex: "status", render: (value: string) => STATUS_LABEL[value] ?? value },
    { title: "Tạo lúc", width: 160, dataIndex: "created_at", render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Chiến dịch
          </Typography.Title>
          <Typography.Text type="secondary">SMS hoặc cuộc gọi AI cho hội viên đã đồng ý kênh đó.</Typography.Text>
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
          {props.canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelected(null); setCreateOpen(true); }}>
              Tạo nháp
            </Button>
          ) : null}
        </Space>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {props.canLaunch ? <TestVoice onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: "Chưa có chiến dịch." }}
        onRow={(row) => ({
          onClick: () => {
            setCreateOpen(false);
            setSelected(row);
            setAudience(null);
            setCounts(null);
            setCareNote("");
          },
        })}
      />
      <Drawer title={selected?.name ?? "Chiến dịch"} open={selected !== null || createOpen} width={440} onClose={() => { setSelected(null); setCreateOpen(false); }}>
        {createOpen ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void create()}>
            <Form.Item label="Tên">
              <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Form.Item>
            <Form.Item label="Kênh">
              <Select value={draft.channel} onChange={(channel) => setDraft({ ...draft, channel })} options={[{ value: "sms", label: "SMS" }, { value: "ai_voice", label: "Gọi AI" }]} />
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
            ) : (
              <>
                <Form.Item label="Mã agent Laaffic" help="Lấy trên màn hình agent của Laaffic. Ghi âm cuộc gọi đang tắt.">
                  <Input value={draft.agentId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} />
                </Form.Item>
                <Form.Item label="Mã chiều" help="Để trống nếu agent không dùng chiều.">
                  <Input value={draft.dimensionId} inputMode="numeric" onChange={(event) => setDraft({ ...draft, dimensionId: event.target.value })} />
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
              {selected.channel === "sms" ? "SMS" : "Gọi AI"} · {STATUS_LABEL[selected.status] ?? selected.status}
            </p>
            {selected.channel === "ai_voice" ? (
              <p className="page-note">Agent {selected.agent_id || "—"}{selected.dimension_id ? ` · chiều ${selected.dimension_id}` : ""}. Ghi âm đang tắt. Chỉ gọi hội viên đã đồng ý, không gồm kho data và nuôi SMS.</p>
            ) : null}
            {selected.body ? <p>{selected.body}</p> : null}
            {audience ? (
              <p className="page-note">
                Đủ điều kiện {audience.eligible}. Thiếu đồng ý {audience.missing_consent}.
                {selected.channel === "sms" ? ` Gửi SMS gần đây ${audience.recent_send}.` : ""}
              </p>
            ) : null}
            {counts ? (
              <p className="page-note">
                {Object.entries(counts)
                  .map(([key, value]) => `${COUNT_LABEL[key] ?? key} ${value}`)
                  .join(" · ") || "Chưa có lượt gửi."}
              </p>
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

function TestVoice(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [phone, setPhone] = useState("");
  const [agentId, setAgentId] = useState("");
  const [dimensionId, setDimensionId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const number = phone.trim();
    const agent = agentId.trim();
    const dimension = dimensionId.trim();
    if (number.length < 8) {
      setFieldError("Cần số điện thoại Việt Nam.");
      return;
    }
    if (!/^\d{1,12}$/.test(agent)) {
      setFieldError("Cần mã agent Laaffic.");
      return;
    }
    if (dimension.length > 0 && !/^\d{1,12}$/.test(dimension)) {
      setFieldError("Mã chiều chỉ gồm số.");
      return;
    }
    setFieldError(null);
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const result = await api<{ provider_ref: string }>("/api/v1/admin/voice/test", {
        method: "POST",
        body: { phone: number, agent_id: agent, ...(dimension ? { dimension_id: dimension } : {}) },
      });
      setPhone("");
      setNotice(`Đã giao cuộc gọi thử. Mã Laaffic: ${result.provider_ref}.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gọi được", "");
      if (problem.status === 401) {
        props.onUnauthorized();
        return;
      }
      if (problem.code === "mfa_setup_required") {
        props.onMfaSetup();
        return;
      }
      setError(problem);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shift-form" style={{ marginBottom: 16, maxWidth: 520 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Gọi thử một số
      </Typography.Title>
      <p className="page-note" style={{ marginTop: 0 }}>
        Một cuộc gọi AI tới số bạn nhập, từ 8 giờ đến 21 giờ giờ Việt Nam. Ghi âm tắt. Mỗi lần cách nhau 30 giây.
      </p>
      <ErrorAlert error={error} />
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Form layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label="Số điện thoại" validateStatus={fieldError ? "error" : ""} help={fieldError || "Nhập số di động, ví dụ 0901234567."}>
          <Input value={phone} maxLength={20} inputMode="tel" autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label="Mã agent Laaffic">
          <Input value={agentId} inputMode="numeric" onChange={(event) => setAgentId(event.target.value)} />
        </Form.Item>
        <Form.Item label="Mã chiều">
          <Input value={dimensionId} inputMode="numeric" onChange={(event) => setDimensionId(event.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={sending} disabled={phone.trim().length === 0 || agentId.trim().length === 0}>
          Gọi thử
        </Button>
      </Form>
    </div>
  );
}
