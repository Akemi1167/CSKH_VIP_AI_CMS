import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type StationMember = {
  id: string;
  display_name: string;
  username: string;
};

type Station = {
  code: string;
  status: "active" | "disabled";
  staff: StationMember[];
  lead: StationMember | null;
};

const CODE_PATTERN = /^[A-Za-z0-9]{2,16}$/;

export function StationBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [items, setItems] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agents, setAgents] = useState<Staff[]>([]);
  const [leads, setLeads] = useState<Staff[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [leading, setLeading] = useState<Station | null>(null);
  const [pendingOff, setPendingOff] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    const result = await api<{ items: Station[] }>("/api/v1/admin/stations");
    setItems(result.items.map((item) => ({ ...item, staff: item.staff ?? [], lead: item.lead ?? null })));
    if (props.canWrite) {
      const people = await api<{ items: Staff[] }>("/api/v1/admin/staff");
      setAgents(people.items.filter((person) => person.status === "active" && person.roles.includes("agent")));
      setLeads(people.items.filter((person) => person.status === "active" && person.roles.includes("team_lead")));
    }
    setError(null);
  }, [props.canWrite]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được hậu đài", "");
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

  async function setStatus(code: string, status: Station["status"]) {
    setBusy(code);
    setNotice(null);
    try {
      const saved = await api<Station>(`/api/v1/admin/stations/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: { status },
      });
      setItems((current) => current.map((item) => (item.code === saved.code ? { ...item, ...saved, staff: saved.staff ?? item.staff, lead: saved.lead ?? item.lead } : item)));
      setError(null);
      setNotice(saved.status === "active" ? `Đã mở ${saved.code}.` : `Đã tắt ${saved.code}.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không cập nhật được hậu đài", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(null);
      setPendingOff(null);
    }
  }

  const columns: TableColumnsType<Station> = [
    { title: "Mã", dataIndex: "code", width: 160 },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 140,
      render: (status: Station["status"]) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "Đang mở" : "Đã tắt"}</Tag>,
    },
    {
      title: "Chọn khi nhập hội viên",
      width: 180,
      render: (_, row) => (
        <Switch
          checked={row.status === "active"}
          disabled={!props.canWrite}
          loading={busy === row.code}
          onChange={(checked) => {
            if (checked) {
              void setStatus(row.code, "active");
              return;
            }
            setPendingOff(row.code);
          }}
        />
      ),
    },
    {
      title: "Nhân viên chăm sóc",
      render: (_, row) => (
        <Space size={4} wrap>
          {row.staff.length === 0 ? <Typography.Text type="secondary">Chưa gắn</Typography.Text> : null}
          {row.staff.map((person) => (
            <Tag key={person.id}>{person.display_name}</Tag>
          ))}
          {props.canWrite ? (
            <Button size="small" onClick={() => setEditing(row)}>
              Gắn
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Tổ trưởng",
      width: 220,
      render: (_, row) => (
        <Space size={4}>
          {row.lead ? <Tag>{row.lead.display_name}</Tag> : <Typography.Text type="secondary">Chưa gắn</Typography.Text>}
          {props.canWrite ? (
            <Button size="small" onClick={() => setLeading(row)}>
              Gắn
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Hậu đài
          </Typography.Title>
          <Typography.Text type="secondary">Trang game khi nhập hội viên. Gắn nhân viên chăm sóc và tổ trưởng của từng trang.</Typography.Text>
        </div>
        {props.canWrite ? (
          <div className="page-header__actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Thêm hậu đài
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Table rowKey="code" columns={columns} dataSource={items} loading={loading} pagination={false} />
      <Modal
        title="Tắt hậu đài"
        open={pendingOff !== null}
        okText="Tắt"
        cancelText="Đóng"
        okButtonProps={{ danger: true, loading: busy === pendingOff }}
        onCancel={() => setPendingOff(null)}
        onOk={() => {
          if (pendingOff) {
            void setStatus(pendingOff, "disabled");
          }
        }}
      >
        <p>Hội viên mới sẽ không chọn được {pendingOff}. Hội viên đã nhập vẫn giữ trang này.</p>
      </Modal>
      {leading ? (
        <AssignLead
          station={leading}
          leads={leads}
          onClose={() => setLeading(null)}
          onSaved={(station) => {
            setItems((current) => current.map((item) => (item.code === station.code ? station : item)));
            setLeading(null);
            setNotice(`Đã gắn tổ trưởng cho ${station.code}.`);
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
      {editing ? (
        <AssignStaff
          station={editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setItems((current) => current.map((item) => (item.code === saved.code ? saved : item)));
            setEditing(null);
            setNotice(saved.staff.length === 0 ? `Đã bỏ nhân viên khỏi ${saved.code}.` : `Đã gắn ${saved.staff.length} nhân viên cho ${saved.code}.`);
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
      {createOpen ? (
        <CreateStation
          onClose={() => setCreateOpen(false)}
          onCreated={(code) => {
            setCreateOpen(false);
            setNotice(`Đã thêm ${code}.`);
            void load();
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
    </section>
  );
}

function AssignStaff(props: {
  station: Station;
  agents: Staff[];
  onClose: () => void;
  onSaved: (station: Station) => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [ids, setIds] = useState(props.station.staff.map((person) => person.id));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const known = new Map(props.agents.map((person) => [person.id, person]));
  const options = [
    ...props.agents.map((person) => ({ value: person.id, label: `${person.display_name} (${person.username})` })),
    ...props.station.staff.filter((person) => !known.has(person.id)).map((person) => ({ value: person.id, label: person.display_name })),
  ];

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<Station>(`/api/v1/admin/stations/${encodeURIComponent(props.station.code)}/staff`, {
        method: "PUT",
        body: { user_ids: ids },
      });
      props.onSaved({ ...saved, staff: saved.staff ?? [], lead: saved.lead ?? props.station.lead });
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gắn được nhân viên", "");
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
      setSaving(false);
    }
  }

  return (
    <Modal title={`Nhân viên ${props.station.code}`} open centered width={480} confirmLoading={saving} okText="Lưu" cancelText="Đóng" onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="Nhân viên chăm sóc" help="Chỉ nhân viên vai trò chăm sóc đang làm việc. Một người có thể gắn nhiều trang. Hàng chờ chưa chia theo danh sách này.">
          <Select
            mode="multiple"
            allowClear
            placeholder={options.length === 0 ? "Chưa có nhân viên chăm sóc" : "Chọn nhân viên"}
            value={ids}
            options={options}
            onChange={setIds}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AssignLead(props: {
  station: Station;
  leads: Staff[];
  onClose: () => void;
  onSaved: (station: Station) => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [userId, setUserId] = useState<string | undefined>(props.station.lead?.id);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const known = props.leads.some((person) => person.id === props.station.lead?.id);
  const options = [
    ...props.leads.map((person) => ({ value: person.id, label: `${person.display_name} (${person.username})` })),
    ...(!known && props.station.lead ? [{ value: props.station.lead.id, label: props.station.lead.display_name }] : []),
  ];

  async function submit() {
    if (!userId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api<{ station: string; user_id: string }>(`/api/v1/admin/stations/${encodeURIComponent(props.station.code)}/lead`, {
        method: "PUT",
        body: { user_id: userId },
      });
      const person = props.leads.find((item) => item.id === saved.user_id) ?? (props.station.lead?.id === saved.user_id ? props.station.lead : undefined);
      props.onSaved({
        ...props.station,
        lead: person ? { id: person.id, display_name: person.display_name, username: person.username } : props.station.lead,
      });
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gắn được tổ trưởng", "");
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
      setSaving(false);
    }
  }

  return (
    <Modal title={`Tổ trưởng ${props.station.code}`} open centered width={480} confirmLoading={saving} okText="Lưu" cancelText="Đóng" okButtonProps={{ disabled: !userId }} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="Tổ trưởng" help={options.length === 0 ? "Cần một tài khoản vai trò tổ trưởng đang làm." : undefined}>
          <Select showSearch optionFilterProp="label" placeholder="Chọn tổ trưởng" value={userId} options={options} onChange={setUserId} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CreateStation(props: {
  onClose: () => void;
  onCreated: (code: string) => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = code.trim();
    if (!CODE_PATTERN.test(value)) {
      setFieldError("Mã gồm 2 đến 16 chữ hoặc số, ví dụ J88.");
      return;
    }
    setFieldError(null);
    setError(null);
    setSaving(true);
    try {
      const created = await api<Station>("/api/v1/admin/stations", { method: "POST", body: { code: value } });
      props.onCreated(created.code);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không thêm được hậu đài", "");
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
      setSaving(false);
    }
  }

  return (
    <Modal title="Thêm hậu đài" open centered width={420} confirmLoading={saving} okText="Thêm" cancelText="Đóng" onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="Mã" validateStatus={fieldError ? "error" : ""} help={fieldError || "Viết hoa khi lưu. Ví dụ J88."}>
          <Input value={code} maxLength={16} placeholder="J88" onChange={(event) => setCode(event.target.value)} onPressEnter={() => void submit()} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
