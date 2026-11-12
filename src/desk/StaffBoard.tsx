import { EditOutlined, KeyOutlined, MessageOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, fieldErrorsFrom } from "../api.ts";
import { roleName, statusLabel } from "../copy.ts";
import { copyText, generatePassword, passwordProblem } from "../password.ts";
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

const KNOWN_FIELDS = ["username", "display_name", "password", "role_codes", "work_functions", "timezone", "status", "current_password"];

function needsActorPassword(mode: "create" | "edit", patch: UpdateStaffBody | null): boolean {
  if (mode === "create") {
    return true;
  }
  return Boolean(patch && (patch.role_codes || patch.password || patch.status));
}

function careStations(draft: Draft): string[] {
  return draft.role_codes.includes("agent") ? draft.stations : [];
}

function sameCodes(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((code, index) => code === b[index]);
}

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
  const [stations, setStations] = useState<string[]>([]);
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
  const [functionBusy, setFunctionBusy] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<Staff | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [actorPassword, setActorPassword] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordShown, setPasswordShown] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [mfaFor, setMfaFor] = useState<Staff | null>(null);
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
    [props.onUnauthorized, props.onMfaSetup],
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
    setPeople(staffResult.value.items.map((person) => ({ ...person, stations: person.stations ?? [] })));
    setLoadError(null);
    try {
      const stationResult = await api<{ items: { code: string }[] }>("/api/v1/stations");
      setStations(stationResult.items.map((item) => item.code));
    } catch {
      setStations([]);
    }
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
    setConfirmPassword("");
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
    const personId = selection.kind === "edit" ? selection.id : "";
    const patch = mode === "edit" ? patchFromDraft(origin, draft) : null;
    if (needsActorPassword(mode, patch) && !confirmPassword) {
      errors.current_password = "Nhập mật khẩu hiện tại của bạn";
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
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
          work_functions: draft.work_functions,
          timezone: draft.timezone,
          current_password: confirmPassword,
        };
        const created = await api<Staff>("/api/v1/admin/staff", { method: "POST", body });
        const codes = careStations(draft);
        const withStations = codes.length
          ? {
              ...created,
              stations: (await api<{ stations: string[] }>(`/api/v1/admin/staff/${created.id}/stations`, { method: "PUT", body: { station_codes: codes } })).stations,
            }
          : { ...created, stations: created.stations ?? [] };
        const items = await refresh();
        setQuery("");
        setFilter("all");
        setIssued({ id: withStations.id, password: draft.password });
        setSaved("Đã tạo nhân viên.");
        const nextDraft = draftFromStaff(withStations);
        setSelection({ kind: "edit", id: created.id });
        setDraft(nextDraft);
        setOrigin(cloneDraft(nextDraft));
        setPeople(items.length > 0 ? items : [withStations]);
        setFieldErrors({});
        setConfirmPassword("");
        return;
      }
      const body: UpdateStaffBody | null = patch;
      const codes = careStations(draft);
      const stationChange = !sameCodes(origin.stations, codes);
      if (!body && !stationChange) {
        setSaved("Không có gì để lưu.");
        return;
      }
      let updated = people.find((person) => person.id === selection.id);
      if (body) {
        const payload = needsActorPassword("edit", body) ? { ...body, current_password: confirmPassword } : body;
        updated = await api<Staff>(`/api/v1/admin/staff/${selection.id}`, { method: "PATCH", body: payload });
      }
      if (!updated) {
        throw new ApiError(0, "network", "Không lưu được nhân viên", "");
      }
      if (stationChange) {
        const savedStations = await api<{ stations: string[] }>(`/api/v1/admin/staff/${selection.id}/stations`, {
          method: "PUT",
          body: { station_codes: codes },
        });
        updated = { ...updated, stations: savedStations.stations };
      }
      const endsSelf = selection.id === props.me.id && Boolean(body?.role_codes || body?.password);
      if (endsSelf) {
        props.onSessionEnded("Đã lưu. Phiên của bạn đã đóng, hãy đăng nhập lại.");
        return;
      }
      const items = await refresh();
      const nextDraft = draftFromStaff(updated);
      setDraft(nextDraft);
      setOrigin(cloneDraft(nextDraft));
      setPeople(items);
      setSaved(body?.password || body?.role_codes || body?.status === "disabled" ? "Đã lưu. Phiên đăng nhập của người này đã đóng." : "Đã lưu.");
      setFieldErrors({});
      setConfirmPassword("");
      if (updated.id === props.me.id) {
        props.onSelfUpdated({ ...props.me, display_name: updated.display_name, roles: updated.roles });
      }
      if (body?.password) {
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
  const needsConfirm = needsActorPassword(selection.kind === "create" ? "create" : "edit", pendingPatch);
  const endsOwnSession = Boolean(
    selection.kind === "edit" && selection.id === props.me.id && pendingPatch && (pendingPatch.password || pendingPatch.role_codes),
  );
  const editorOpen = selection.kind !== "idle" && Boolean(draft);

  async function toggleFunction(person: Staff, code: "web_chat" | "telegram") {
    if (!props.canWrite || functionBusy) {
      return;
    }
    const current = Array.isArray(person.work_functions) ? person.work_functions : [];
    const work_functions = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
    setFunctionBusy(`${person.id}:${code}`);
    setFormError(null);
    try {
      const updated = await api<Staff>(`/api/v1/admin/staff/${person.id}`, { method: "PATCH", body: { work_functions } });
      setPeople((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      if (selection.kind === "edit" && selection.id === updated.id && draft && origin) {
        setDraft({ ...draft, work_functions: [...updated.work_functions] });
        setOrigin({ ...origin, work_functions: [...updated.work_functions] });
      }
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đổi được chức năng", "");
      if (!failAuth(error)) {
        setFormError(error);
      }
    } finally {
      setFunctionBusy(null);
    }
  }

  function openPassword(person: Staff) {
    setActorPassword("");
    setPasswordFor(person);
    setPasswordValue(generatePassword());
    setPasswordShown(null);
    setPasswordCopied(false);
    setFormError(null);
  }

  async function savePassword() {
    if (!passwordFor) {
      return;
    }
    const problem = passwordProblem(passwordValue);
    if (problem) {
      setFormError(new ApiError(400, "validation_error", problem, ""));
      return;
    }
    if (!actorPassword) {
      setFormError(new ApiError(400, "validation_error", "Nhập mật khẩu hiện tại của bạn", ""));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api<Staff>(`/api/v1/admin/staff/${passwordFor.id}`, {
        method: "PATCH",
        body: { password: passwordValue, current_password: actorPassword },
      });
      if (passwordFor.id === props.me.id) {
        props.onSessionEnded("Đã đổi mật khẩu. Phiên của bạn đã đóng, hãy đăng nhập lại.");
        return;
      }
      setPasswordShown(passwordValue);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đổi được mật khẩu", "");
      if (!failAuth(error)) {
        setFormError(error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearMfa() {
    if (!mfaFor) {
      return;
    }
    if (!actorPassword) {
      setFormError(new ApiError(400, "validation_error", "Nhập mật khẩu hiện tại của bạn", ""));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api(`/api/v1/admin/staff/${mfaFor.id}/mfa`, { method: "DELETE", body: { current_password: actorPassword } });
      if (mfaFor.id === props.me.id) {
        props.onSessionEnded("Đã gỡ MFA. Phiên của bạn đã đóng, hãy đăng nhập lại.");
        return;
      }
      setPeople((rows) => rows.map((row) => (row.id === mfaFor.id ? { ...row, mfa_enabled: false } : row)));
      setMfaFor(null);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gỡ được MFA", "");
      if (!failAuth(error)) {
        setFormError(error);
      }
    } finally {
      setSaving(false);
    }
  }

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
      title: "Đài",
      dataIndex: "stations",
      render: (codes: string[] | undefined, person) =>
        person.roles.includes("agent") ? (
          <Space size={4} wrap>
            {(codes ?? []).length === 0 ? <Typography.Text type="secondary">Chưa gắn</Typography.Text> : null}
            {(codes ?? []).map((code) => (
              <Tag key={code}>{code}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 120,
      render: (status: string) => <Tag color={status === "active" ? "success" : "default"}>{statusLabel(status)}</Tag>,
    },
    {
      title: "",
      key: "actions",
      width: 220,
      align: "right",
      render: (_, person) => {
        const functions = Array.isArray(person.work_functions) ? person.work_functions : [];
        const chatOn = functions.includes("web_chat");
        const telegramOn = functions.includes("telegram");
        return (
          <span className="row-actions" onClick={(event) => event.stopPropagation()}>
            <Tooltip title={chatOn ? "Đang nhận chat website" : "Không nhận chat website"}>
              <button
                type="button"
                className={chatOn ? "is-on" : undefined}
                disabled={!props.canWrite || functionBusy === `${person.id}:web_chat`}
                onClick={() => void toggleFunction(person, "web_chat")}
              >
                <MessageOutlined />
              </button>
            </Tooltip>
            <Tooltip title={telegramOn ? "Đang nhận Telegram" : "Không nhận Telegram"}>
              <button
                type="button"
                className={telegramOn ? "is-on" : undefined}
                disabled={!props.canWrite || functionBusy === `${person.id}:telegram`}
                onClick={() => void toggleFunction(person, "telegram")}
              >
                <SendOutlined />
              </button>
            </Tooltip>
            <Tooltip title="Đổi mật khẩu">
              <button type="button" className="is-key" disabled={!props.canWrite} onClick={() => openPassword(person)}>
                <KeyOutlined />
              </button>
            </Tooltip>
            <Tooltip title={person.mfa_enabled ? "MFA đang bật. Bấm để gỡ" : "Chưa bật MFA"}>
              <button
                type="button"
                className={person.mfa_enabled ? "is-mfa" : person.roles.includes("admin") ? "is-warn" : undefined}
                disabled={!props.canWrite}
                onClick={() => {
                  if (!person.mfa_enabled) {
                    return;
                  }
                  setFormError(null);
                  setActorPassword("");
                  setMfaFor(person);
                }}
              >
                <SafetyCertificateOutlined />
              </button>
            </Tooltip>
            <Tooltip title="Sửa hồ sơ">
              <button type="button" onClick={() => choose({ kind: "edit", id: person.id })}>
                <EditOutlined />
              </button>
            </Tooltip>
          </span>
        );
      },
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Nhân sự
          </Typography.Title>
          <Typography.Text type="secondary">Một nhân viên chăm sóc có thể gắn nhiều đài. Icon trên mỗi dòng: chat website, Telegram, đổi mật khẩu, MFA, sửa hồ sơ.</Typography.Text>
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
        <ErrorAlert
          error={loadError}
          action={
            <button
              type="button"
              className="notice__retry"
              onClick={() => {
                setLoading(true);
                refresh().finally(() => setLoading(false));
              }}
            >
              Thử lại
            </button>
          }
        />
      ) : null}
      {formError && !editorOpen && !passwordFor && !mfaFor ? <ErrorAlert error={formError} /> : null}

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
        title={passwordFor ? `Đổi mật khẩu ${passwordFor.display_name}` : "Đổi mật khẩu"}
        open={passwordFor !== null}
        centered
        confirmLoading={saving}
        okText={passwordShown ? "Đóng" : "Lưu mật khẩu"}
        cancelText="Hủy"
        cancelButtonProps={{ style: passwordShown ? { display: "none" } : undefined }}
        onCancel={() => setPasswordFor(null)}
        onOk={() => {
          if (passwordShown) {
            setPasswordFor(null);
            return;
          }
          void savePassword();
        }}
      >
        {formError ? <ErrorAlert error={formError} /> : null}
        {passwordShown ? (
          <p className="page-note">
            Mật khẩu mới chỉ hiện lúc này: <code className="secret-code">{passwordShown}</code>
            <Button size="small" style={{ marginLeft: 8 }} onClick={() => void copyText(passwordShown).then(setPasswordCopied)}>
              {passwordCopied ? "Đã chép" : "Chép"}
            </Button>
          </p>
        ) : (
          <>
            <p className="page-note">Người này sẽ phải đăng nhập lại. Gửi mật khẩu cho họ, CMS không lưu lại.</p>
            <p className="page-note">Mật khẩu mới</p>
            <Input.Password value={passwordValue} autoComplete="new-password" onChange={(event) => setPasswordValue(event.target.value)} />
            <p className="page-note" style={{ marginTop: 12 }}>Mật khẩu của bạn</p>
            <Input.Password
              autoComplete="current-password"
              value={actorPassword}
              onChange={(event) => setActorPassword(event.target.value)}
            />
            <button type="button" className="text-button" style={{ marginTop: 8 }} onClick={() => setPasswordValue(generatePassword())}>
              Tạo mật khẩu khác
            </button>
          </>
        )}
      </Modal>

      <Modal
        title={mfaFor ? `Gỡ MFA của ${mfaFor.display_name}` : "Gỡ MFA"}
        open={mfaFor !== null}
        centered
        confirmLoading={saving}
        okText="Gỡ MFA"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
        onCancel={() => setMfaFor(null)}
        onOk={() => void clearMfa()}
      >
        {formError ? <ErrorAlert error={formError} /> : null}
        <p className="page-note">
          {mfaFor?.id === props.me.id
            ? "MFA của bạn sẽ bị gỡ và phiên này đóng."
            : "Người này đăng nhập bằng mật khẩu cho đến khi tự bật lại MFA. Phiên đang mở của họ sẽ đóng."}
        </p>
        <p className="page-note">Mật khẩu của bạn</p>
        <Input.Password autoComplete="current-password" value={actorPassword} onChange={(event) => setActorPassword(event.target.value)} />
      </Modal>

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
            stations={stations}
            canWrite={props.canWrite}
            isSelf={selection.kind === "edit" && selection.id === props.me.id}
            mfaEnabled={editing?.mfa_enabled ?? false}
            fieldErrors={fieldErrors}
            blockReason={blockReason}
            endsOwnSession={endsOwnSession}
            needsConfirm={needsConfirm}
            confirmPassword={confirmPassword}
            onConfirmPassword={setConfirmPassword}
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
