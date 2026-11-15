import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { useTr } from "./language.tsx";
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
  has_logo?: boolean;
  staff: StationMember[];
  lead: StationMember | null;
};

const CODE_PATTERN = /^[A-Za-z0-9]{2,16}$/;

export function StationBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
  const [items, setItems] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agents, setAgents] = useState<Staff[]>([]);
  const [leads, setLeads] = useState<Staff[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [leading, setLeading] = useState<Station | null>(null);
  const [logoFor, setLogoFor] = useState<Station | null>(null);
  const [logoTick, setLogoTick] = useState(0);
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
    [props.onUnauthorized, props.onMfaSetup],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được hậu đài", "无法加载站点"), "");
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
      setNotice(saved.status === "active" ? tr(`Đã mở ${saved.code}.`, `已开启 ${saved.code}。`) : tr(`Đã tắt ${saved.code}.`, `已停用 ${saved.code}。`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không cập nhật được hậu đài", "无法更新站点"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(null);
      setPendingOff(null);
    }
  }

  const columns: TableColumnsType<Station> = [
    { title: tr("Mã", "编码"), dataIndex: "code", width: 120 },
    {
      title: "Logo",
      width: 150,
      render: (_, row) => (
        <Space size={8}>
          {row.has_logo ? <img className="station-logo" src={`${toApiUrl(`/api/v1/stations/${encodeURIComponent(row.code)}/logo`)}?v=${logoTick}`} alt="" /> : <Typography.Text type="secondary">{tr("Chưa có", "暂无")}</Typography.Text>}
          {props.canWrite ? (
            <Button size="small" onClick={() => setLogoFor(row)}>
              Logo
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      title: tr("Trạng thái", "状态"),
      dataIndex: "status",
      width: 140,
      render: (status: Station["status"]) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? tr("Đang mở", "已开启") : tr("Đã tắt", "已停用")}</Tag>,
    },
    {
      title: tr("Chọn khi nhập hội viên", "录入会员时可选"),
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
      title: tr("Nhân viên chăm sóc", "客服"),
      render: (_, row) => (
        <Space size={4} wrap>
          {row.staff.length === 0 ? <Typography.Text type="secondary">{tr("Chưa gắn", "未分配")}</Typography.Text> : null}
          {row.staff.map((person) => (
            <Tag key={person.id}>{person.display_name}</Tag>
          ))}
          {props.canWrite ? (
            <Button size="small" onClick={() => setEditing(row)}>
              {tr("Gắn", "分配")}
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      title: tr("Tổ trưởng", "组长"),
      width: 220,
      render: (_, row) => (
        <Space size={4}>
          {row.lead ? <Tag>{row.lead.display_name}</Tag> : <Typography.Text type="secondary">{tr("Chưa gắn", "未分配")}</Typography.Text>}
          {props.canWrite ? (
            <Button size="small" onClick={() => setLeading(row)}>
              {tr("Gắn", "分配")}
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
            {tr("Hậu đài", "站点")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Gắn nhân viên chăm sóc, tổ trưởng và logo. Logo hiện khi chăm khách để khỏi nhầm đài.", "分配客服、组长和 Logo。关怀会员时会显示 Logo，避免弄错站点。")}</Typography.Text>
        </div>
        {props.canWrite ? (
          <div className="page-header__actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {tr("Thêm hậu đài", "添加站点")}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Table rowKey="code" columns={columns} dataSource={items} loading={loading} pagination={false} />
      <Modal
        title={tr("Tắt hậu đài", "停用站点")}
        open={pendingOff !== null}
        okText={tr("Tắt", "停用")}
        cancelText={tr("Đóng", "关闭")}
        okButtonProps={{ danger: true, loading: busy === pendingOff }}
        onCancel={() => setPendingOff(null)}
        onOk={() => {
          if (pendingOff) {
            void setStatus(pendingOff, "disabled");
          }
        }}
      >
        <p>{tr(`Hội viên mới sẽ không chọn được ${pendingOff}. Hội viên đã nhập vẫn giữ trang này.`, `新会员将不能选择 ${pendingOff}。已录入的会员仍保留在此站点。`)}</p>
      </Modal>
      {leading ? (
        <AssignLead
          station={leading}
          leads={leads}
          onClose={() => setLeading(null)}
          onSaved={(station) => {
            setItems((current) => current.map((item) => (item.code === station.code ? station : item)));
            setLeading(null);
            setNotice(tr(`Đã gắn tổ trưởng cho ${station.code}.`, `已为 ${station.code} 分配组长。`));
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
      {logoFor ? (
        <StationLogo
          station={logoFor}
          tick={logoTick}
          onClose={() => setLogoFor(null)}
          onSaved={(station) => {
            setItems((current) => current.map((item) => (item.code === station.code ? { ...item, ...station, staff: station.staff ?? item.staff, lead: station.lead ?? item.lead } : item)));
            setLogoTick(Date.now());
            setLogoFor(null);
            setNotice(station.has_logo ? tr(`Đã lưu logo ${station.code}.`, `已保存 ${station.code} 的 Logo。`) : tr(`Đã gỡ logo ${station.code}.`, `已移除 ${station.code} 的 Logo。`));
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
            setNotice(saved.staff.length === 0 ? tr(`Đã bỏ nhân viên khỏi ${saved.code}.`, `已移除 ${saved.code} 的员工。`) : tr(`Đã gắn ${saved.staff.length} nhân viên cho ${saved.code}.`, `已为 ${saved.code} 分配 ${saved.staff.length} 名员工。`));
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
            setNotice(tr(`Đã thêm ${code}.`, `已添加 ${code}。`));
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
  const tr = useTr();
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gắn được nhân viên", "无法分配员工"), "");
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
    <Modal title={tr(`Nhân viên ${props.station.code}`, `${props.station.code} 的员工`)} open centered width={480} confirmLoading={saving} okText={tr("Lưu", "保存")} cancelText={tr("Đóng", "关闭")} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Nhân viên chăm sóc", "客服")} help={tr("Chỉ nhân viên vai trò chăm sóc đang làm việc. Một người có thể gắn nhiều đài. Hàng chờ giao hội viên của đài này cho những người trong danh sách.", "仅限在职客服。一人可分配多个站点。队列会把本站点的会员分配给列表中的人。")}>
          <Select
            mode="multiple"
            allowClear
            placeholder={options.length === 0 ? tr("Chưa có nhân viên chăm sóc", "暂无客服") : tr("Chọn nhân viên", "选择员工")}
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
  const tr = useTr();
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gắn được tổ trưởng", "无法分配组长"), "");
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
    <Modal title={tr(`Tổ trưởng ${props.station.code}`, `${props.station.code} 的组长`)} open centered width={480} confirmLoading={saving} okText={tr("Lưu", "保存")} cancelText={tr("Đóng", "关闭")} okButtonProps={{ disabled: !userId }} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Tổ trưởng", "组长")} help={options.length === 0 ? tr("Cần một tài khoản vai trò tổ trưởng đang làm.", "需要一个在职的组长账号。") : tr("Một tổ trưởng có thể phụ trách nhiều đài.", "一名组长可以负责多个站点。")}>
          <Select showSearch optionFilterProp="label" placeholder={tr("Chọn tổ trưởng", "选择组长")} value={userId} options={options} onChange={setUserId} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function StationLogo(props: {
  station: Station;
  tick: number;
  onClose: () => void;
  onSaved: (station: Station) => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  function chooseFile(next: File | undefined) {
    if (!next) {
      return;
    }
    if (next.size > 512 * 1024) {
      setFieldError(tr("Ảnh tối đa 512 KB.", "图片最大 512 KB。"));
      return;
    }
    setFieldError(null);
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  function fail(problem: ApiError) {
    if (problem.status === 401) {
      props.onUnauthorized();
      return;
    }
    if (problem.code === "mfa_setup_required") {
      props.onMfaSetup();
      return;
    }
    setError(problem);
  }

  async function upload() {
    if (!file) {
      setFieldError(tr("Chọn ảnh PNG, JPEG hoặc WebP.", "请选择 PNG、JPEG 或 WebP 图片。"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const saved = await api<Station>(`/api/v1/admin/stations/${encodeURIComponent(props.station.code)}/logo`, { method: "PUT", body });
      props.onSaved({ ...props.station, ...saved, has_logo: true, staff: saved.staff ?? props.station.staff, lead: saved.lead ?? props.station.lead });
    } catch (caught) {
      fail(caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được logo", "无法保存 Logo"), ""));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<Station>(`/api/v1/admin/stations/${encodeURIComponent(props.station.code)}/logo`, { method: "DELETE" });
      props.onSaved({ ...props.station, ...saved, has_logo: false, staff: saved.staff ?? props.station.staff, lead: saved.lead ?? props.station.lead });
    } catch (caught) {
      fail(caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gỡ được logo", "无法移除 Logo"), ""));
    } finally {
      setSaving(false);
    }
  }

  const current = props.station.has_logo ? `${toApiUrl(`/api/v1/stations/${encodeURIComponent(props.station.code)}/logo`)}?v=${props.tick}` : null;

  return (
    <Modal
      title={tr(`Logo ${props.station.code}`, `${props.station.code} 的 Logo`)}
      open
      centered
      width={420}
      confirmLoading={saving}
      okText={tr("Lưu", "保存")}
      cancelText={tr("Đóng", "关闭")}
      okButtonProps={{ disabled: !file }}
      onCancel={props.onClose}
      onOk={() => void upload()}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          {props.station.has_logo ? (
            <Button danger loading={saving} onClick={() => void remove()}>
              {tr("Gỡ logo", "移除 Logo")}
            </Button>
          ) : null}
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Ảnh", "图片")} validateStatus={fieldError ? "error" : ""} help={fieldError || tr("PNG, JPEG hoặc WebP, tối đa 512 KB. Khách và nhân viên thấy logo này khi chăm sóc.", "PNG、JPEG 或 WebP，最大 512 KB。会员和员工在关怀时会看到此 Logo。")}>
          <Space direction="vertical" size={8}>
            {preview || current ? <img className="station-logo station-logo--lg" src={preview || current || undefined} alt="" /> : <Typography.Text type="secondary">{tr("Chưa có logo", "暂无 Logo")}</Typography.Text>}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </Space>
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
  const tr = useTr();
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = code.trim();
    if (!CODE_PATTERN.test(value)) {
      setFieldError(tr("Mã gồm 2 đến 16 chữ hoặc số, ví dụ J88.", "编码为 2 到 16 位字母或数字，例如 J88。"));
      return;
    }
    setFieldError(null);
    setError(null);
    setSaving(true);
    try {
      const created = await api<Station>("/api/v1/admin/stations", { method: "POST", body: { code: value } });
      props.onCreated(created.code);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không thêm được hậu đài", "无法添加站点"), "");
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
    <Modal title={tr("Thêm hậu đài", "添加站点")} open centered width={420} confirmLoading={saving} okText={tr("Thêm", "添加")} cancelText={tr("Đóng", "关闭")} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Mã", "编码")} validateStatus={fieldError ? "error" : ""} help={fieldError || tr("Viết hoa khi lưu. Ví dụ J88.", "保存时会转为大写。例如 J88。")}>
          <Input value={code} maxLength={16} placeholder="J88" onChange={(event) => setCode(event.target.value)} onPressEnter={() => void submit()} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
