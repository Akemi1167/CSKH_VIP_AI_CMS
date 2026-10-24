import { EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, fieldErrorsFrom } from "../api.ts";
import { roleName, statusLabel } from "../copy.ts";
import {
  cloneDraft,
  draftFromStaff,
  emptyDraft,
  isLastActiveAdmin,
  patchFromDraft,
  sameDraft,
  saveBlockReason,
  validateDraft,
} from "../draft.ts";
import type { CreateStaffBody, Draft, FieldErrors, Role, Staff, UpdateStaffBody, UserProfile } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { StaffEditor } from "./StaffEditor.tsx";

type Selection = { kind: "idle" } | { kind: "create" } | { kind: "edit"; id: string };
type StatusFilter = "all" | "active" | "disabled";

const KNOWN_FIELDS = ["username", "display_name", "password", "role_codes", "timezone", "status"];

export function StaffBoard(props: {
  me: UserProfile;
  canWrite: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
  onSessionEnded: (notice: string) => void;
  onSelfUpdated: (user: UserProfile) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selection, setSelection] = useState<Selection>({ kind: "idle" });
  const [origin, setOrigin] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [queued, setQueued] = useState<Selection | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null);

  const dirty = Boolean(origin && draft && !sameDraft(origin, draft));

  const failAuth = useCallback(
    (error: ApiError) => {
      if (error.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (error.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props],
  );

  const refresh = useCallback(async () => {
    const [staffResult, roleResult] = await Promise.allSettled([
      api<{ items: Staff[] }>("/api/v1/admin/staff"),
      api<{ items: Role[] }>("/api/v1/admin/roles"),
    ]);
    if (staffResult.status === "rejected") {
      const error = staffResult.reason instanceof ApiError ? staffResult.reason : new ApiError(0, "network", "Không tải được nhân sự", "");
      if (!failAuth(error)) {
        setLoadError(error);
      }
      return [];
    }
    setPeople(staffResult.value.items);
    setLoadError(null);
    if (roleResult.status === "fulfilled") {
      setRoles(roleResult.value.items);
    }
    return staffResult.value.items;
  }, [failAuth]);

  useEffect(() => {
    let ignore = false;
    refresh().finally(() => {
      if (!ignore) {
        setLoading(false);
      }
    });
    return () => {
      ignore = true;
    };
  }, [refresh]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("input, textarea, select") || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function apply(next: Selection, source: Staff[] = people) {
    setSelection(next);
    setQueued(null);
    setFieldErrors({});
    setFormError(null);
    setSaved(null);
    if (next.kind === "create") {
      const created = emptyDraft();
      setDraft(created);
      setOrigin(cloneDraft(created));
      setIssued(null);
      return;
    }
    if (next.kind === "edit") {
      const person = source.find((item) => item.id === next.id);
      if (!person) {
        setSelection({ kind: "idle" });
        setDraft(null);
        setOrigin(null);
        return;
      }
      const nextDraft = draftFromStaff(person);
      setDraft(nextDraft);
      setOrigin(cloneDraft(nextDraft));
      setIssued((current) => (current?.id === person.id ? current : null));
      return;
    }
    setDraft(null);
    setOrigin(null);
    setIssued(null);
  }

  function choose(next: Selection) {
    if (next.kind === selection.kind && (next.kind !== "edit" || selection.kind !== "edit" || next.id === selection.id)) {
      return;
    }
    if (dirty) {
      setQueued(next);
      return;
    }
    apply(next);
  }

  async function submit() {
    if (!draft || !origin || selection.kind === "idle") {
      return;
    }
    const mode = selection.kind === "create" ? "create" : "edit";
    const errors = validateDraft(mode, draft);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const personId = selection.kind === "edit" ? selection.id : "";
    const blocked = saveBlockReason({
      mode,
      draft,
      isSelf: personId === props.me.id,
      lastAdmin: personId ? isLastActiveAdmin(people, personId) : false,
    });
    if (blocked) {
      return;
    }
    setSaving(true);
    try {
      if (selection.kind === "create") {
        const body: CreateStaffBody = {
          username: draft.username.trim().toLowerCase(),
          display_name: draft.display_name.trim(),
          password: draft.password,
          role_codes: draft.role_codes,
          timezone: draft.timezone,
        };
        const created = await api<Staff>("/api/v1/admin/staff", { method: "POST", body });
        const items = await refresh();
        setQuery("");
        setFilter("all");
        setIssued({ id: created.id, password: draft.password });
        setSaved("Đã tạo nhân viên.");
        const nextDraft = draftFromStaff(created);
        setSelection({ kind: "edit", id: created.id });
        setDraft(nextDraft);
        setOrigin(cloneDraft(nextDraft));
        setPeople(items.length > 0 ? items : [created]);
        setFieldErrors({});
        return;
      }
      const body: UpdateStaffBody | null = patchFromDraft(origin, draft);
      if (!body) {
        setSaved("Không có gì để lưu.");
        return;
      }
      const updated = await api<Staff>(`/api/v1/admin/staff/${selection.id}`, { method: "PATCH", body });
      const endsSelf = selection.id === props.me.id && Boolean(body.role_codes || body.password);
      if (endsSelf) {
        props.onSessionEnded("Đã lưu. Phiên của bạn đã đóng, hãy đăng nhập lại.");
        return;
      }
      const items = await refresh();
      const nextDraft = draftFromStaff(updated);
      setDraft(nextDraft);
      setOrigin(cloneDraft(nextDraft));
      setPeople(items);
      setSaved(body.password || body.role_codes || body.status === "disabled" ? "Đã lưu. Phiên đăng nhập của người này đã đóng." : "Đã lưu.");
      setFieldErrors({});
      if (updated.id === props.me.id) {
        props.onSelfUpdated({ ...props.me, display_name: updated.display_name, roles: updated.roles });
      }
      if (body.password) {
        setIssued({ id: updated.id, password: body.password });
      }
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không kết nối được máy chủ", "");
      if (failAuth(error)) {
        return;
      }
      const parsed = fieldErrorsFrom(error, KNOWN_FIELDS);
      setFieldErrors(parsed.fields);
      if (error.code === "conflict") {
        setFieldErrors((current) => ({ ...current, username: error.message }));
      }
      setFormError(parsed.extra ? new ApiError(error.status, error.code, `${error.message}. ${parsed.extra}`, error.requestId) : error);
    } finally {
      setSaving(false);
    }
  }

  const needle = query.trim().toLocaleLowerCase("vi");
  const visible = people.filter((person) => {
    const matchesStatus = filter === "all" || person.status === filter;
    const matchesQuery = needle.length === 0 || `${person.display_name} ${person.username}`.toLocaleLowerCase("vi").includes(needle);
    return matchesStatus && matchesQuery;
  });
  const activeCount = people.filter((person) => person.status === "active").length;
  const lockedCount = people.filter((person) => person.status === "disabled").length;
  const editing = selection.kind === "edit" ? people.find((person) => person.id === selection.id) : undefined;
  const blockReason =
    draft && selection.kind !== "idle"
      ? saveBlockReason({
          mode: selection.kind,
          draft,
          isSelf: selection.kind === "edit" && selection.id === props.me.id,
          lastAdmin: selection.kind === "edit" ? isLastActiveAdmin(people, selection.id) : false,
        })
      : null;
  const pendingPatch = origin && draft && selection.kind === "edit" ? patchFromDraft(origin, draft) : null;
  const endsOwnSession = Boolean(
    selection.kind === "edit" && selection.id === props.me.id && pendingPatch && (pendingPatch.password || pendingPatch.role_codes),
  );
  const editorOpen = selection.kind !== "idle" && Boolean(draft);

  const columns: TableColumnsType<Staff> = [
    {
      title: "Nhân viên",
      dataIndex: "display_name",
      render: (value: string, person) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {person.username}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Vai trò",
      dataIndex: "roles",
      render: (codes: string[]) => (
        <Space size={4} wrap>
          {(codes.length > 0 ? codes : ["none"]).map((code) => (
            <Tag key={code}>{code === "none" ? "Chưa có vai trò" : roleName(code, roles)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 120,
      render: (status: string) => <Tag color={status === "active" ? "success" : "default"}>{statusLabel(status)}</Tag>,
    },
    {
      title: "MFA",
      dataIndex: "mfa_enabled",
      width: 140,
      render: (enabled: boolean, person) =>
        enabled ? <Tag color="success">Đã bật</Tag> : person.roles.includes("admin") ? <Tag color="warning">Cần bật MFA</Tag> : <Tag>Chưa bật</Tag>,
    },
    {
      title: "",
      key: "edit",
      width: 88,
      render: (_, person) => (
        <Button
          type="link"
          icon={<EditOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            choose({ kind: "edit", id: person.id });
          }}
        >
          Sửa
        </Button>
      ),
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Nhân sự
          </Typography.Title>
          <Typography.Text type="secondary">Sửa hồ sơ, vai trò và mật khẩu ngay trong bảng này.</Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => choose({ kind: "create" })}>
            Thêm nhân viên
          </Button>
        ) : null}
      </div>

      <div className="filter-bar">
        <div className="filter-bar__fields">
          <Input
            ref={(node) => {
              searchRef.current = node?.input ?? null;
            }}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Tìm theo tên hoặc tên đăng nhập"
            aria-label="Tìm nhân viên"
            style={{ width: 280 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select<StatusFilter>
            value={filter}
            style={{ width: 180 }}
            onChange={setFilter}
            options={[
              { value: "all", label: `Tất cả (${people.length})` },
              { value: "active", label: `Đang làm (${activeCount})` },
              { value: "disabled", label: `Đã khóa (${lockedCount})` },
            ]}
          />
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Xóa bộ lọc
          </Button>
        </Space>
      </div>

      {loadError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={loadError.message}
          description={loadError.requestId ? `Mã yêu cầu ${loadError.requestId}` : undefined}
          action={
            <Button
              size="small"
              onClick={() => {
                setLoading(true);
                refresh().finally(() => setLoading(false));
              }}
            >
              Thử lại
            </Button>
          }
        />
      ) : null}

      <div className="staff-table">
        <Table<Staff>
          rowKey="id"
          columns={columns}
          dataSource={visible}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: "Không có người khớp." }}
          onRow={(person) => ({
            onClick: () => choose({ kind: "edit", id: person.id }),
            style: { cursor: "pointer" },
          })}
        />
      </div>

      <Modal
        title={selection.kind === "create" ? "Thêm nhân viên" : draft ? `Sửa ${draft.display_name || draft.username}` : "Sửa nhân viên"}
        open={editorOpen}
        centered
        width={480}
        styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" } }}
        onCancel={() => choose({ kind: "idle" })}
        okText={selection.kind === "create" ? "Tạo nhân viên" : draft?.status === "disabled" ? "Lưu và khóa" : "Lưu thay đổi"}
        cancelText="Đóng"
        confirmLoading={saving}
        okButtonProps={{
          htmlType: "submit",
          form: "staff-form",
          disabled: Boolean(blockReason),
          style: props.canWrite ? undefined : { display: "none" },
        }}
        cancelButtonProps={{ style: props.canWrite ? undefined : { display: "none" } }}
        footer={props.canWrite ? undefined : <Button onClick={() => choose({ kind: "idle" })}>Đóng</Button>}
      >
        {formError && formError.code !== "conflict" ? <ErrorAlert error={formError} /> : null}
        {draft ? (
          <StaffEditor
            mode={selection.kind === "create" ? "create" : "edit"}
            draft={draft}
            roles={roles}
            canWrite={props.canWrite}
            isSelf={selection.kind === "edit" && selection.id === props.me.id}
            mfaEnabled={editing?.mfa_enabled ?? false}
            fieldErrors={fieldErrors}
            blockReason={blockReason}
            endsOwnSession={endsOwnSession}
            saved={saved}
            issuedPassword={selection.kind === "edit" && issued?.id === selection.id ? issued.password : null}
            focusToken={selection.kind === "edit" ? selection.id : "create"}
            onChange={(next) => {
              setDraft(next);
              setSaved(null);
              setFieldErrors({});
              setFormError(null);
            }}
            onSubmit={() => void submit()}
          />
        ) : null}
      </Modal>

      <Modal
        title="Có thay đổi chưa lưu"
        open={queued !== null}
        onCancel={() => setQueued(null)}
        footer={
          <Space>
            <Button onClick={() => setQueued(null)}>Tiếp tục sửa</Button>
            <Button danger onClick={() => queued && apply(queued)}>
              Bỏ thay đổi
            </Button>
          </Space>
        }
      >
        Thoát lúc này sẽ mất phần vừa sửa.
      </Modal>
    </section>
  );
}
