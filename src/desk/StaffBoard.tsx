import { EditOutlined, KeyOutlined, MessageOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, fieldErrorsFrom } from "../api.ts";
import { useTr } from "./language.tsx";
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
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
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
      const error = staffResult.reason instanceof ApiError ? staffResult.reason : new ApiError(0, "network", trRef.current("Không tải được nhân sự", "无法加载员工"), "");
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
      errors.current_password = tr("Nhập mật khẩu hiện tại của bạn", "请输入你的当前密码");
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
        setSaved(tr("Đã tạo nhân viên.", "已添加员工。"));
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
        setSaved(tr("Không có gì để lưu.", "没有可保存的内容。"));
        return;
      }
      let updated = people.find((person) => person.id === selection.id);
      if (body) {
        const payload = needsActorPassword("edit", body) ? { ...body, current_password: confirmPassword } : body;
        updated = await api<Staff>(`/api/v1/admin/staff/${selection.id}`, { method: "PATCH", body: payload });
      }
      if (!updated) {
        throw new ApiError(0, "network", tr("Không lưu được nhân viên", "无法保存员工"), "");
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
        props.onSessionEnded(tr("Đã lưu. Phiên của bạn đã đóng, hãy đăng nhập lại.", "已保存。你的会话已关闭，请重新登录。"));
        return;
      }
      const items = await refresh();
      const nextDraft = draftFromStaff(updated);
      setDraft(nextDraft);
      setOrigin(cloneDraft(nextDraft));
      setPeople(items);
      setSaved(body?.password || body?.role_codes || body?.status === "disabled" ? tr("Đã lưu. Phiên đăng nhập của người này đã đóng.", "已保存。此人的登录会话已关闭。") : tr("Đã lưu.", "已保存。"));
      setFieldErrors({});
      setConfirmPassword("");
      if (updated.id === props.me.id) {
        props.onSelfUpdated({ ...props.me, display_name: updated.display_name, roles: updated.roles });
      }
      if (body?.password) {
        setIssued({ id: updated.id, password: body.password });
      }
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không kết nối được máy chủ", "无法连接服务器"), "");
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
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không đổi được chức năng", "无法更改职能"), "");
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
      setFormError(new ApiError(400, "validation_error", tr("Nhập mật khẩu hiện tại của bạn", "请输入你的当前密码"), ""));
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
        props.onSessionEnded(tr("Đã đổi mật khẩu. Phiên của bạn đã đóng, hãy đăng nhập lại.", "已修改密码。你的会话已关闭，请重新登录。"));
        return;
      }
      setPasswordShown(passwordValue);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không đổi được mật khẩu", "无法修改密码"), "");
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
      setFormError(new ApiError(400, "validation_error", tr("Nhập mật khẩu hiện tại của bạn", "请输入你的当前密码"), ""));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api(`/api/v1/admin/staff/${mfaFor.id}/mfa`, { method: "DELETE", body: { current_password: actorPassword } });
      if (mfaFor.id === props.me.id) {
        props.onSessionEnded(tr("Đã gỡ MFA. Phiên của bạn đã đóng, hãy đăng nhập lại.", "已解除 MFA。你的会话已关闭，请重新登录。"));
        return;
      }
      setPeople((rows) => rows.map((row) => (row.id === mfaFor.id ? { ...row, mfa_enabled: false } : row)));
      setMfaFor(null);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gỡ được MFA", "无法解除 MFA"), "");
      if (!failAuth(error)) {
        setFormError(error);
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<Staff> = [
    {
      title: tr("Nhân viên", "员工"),
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
      title: tr("Vai trò", "角色"),
      dataIndex: "roles",
      render: (codes: string[]) => (
        <Space size={4} wrap>
          {(codes.length > 0 ? codes : ["none"]).map((code) => (
            <Tag key={code}>{code === "none" ? tr("Chưa có vai trò", "暂无角色") : roleName(code, roles)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: tr("Đài", "站点"),
      dataIndex: "stations",
      render: (codes: string[] | undefined, person) =>
        person.roles.includes("agent") ? (
          <Space size={4} wrap>
            {(codes ?? []).length === 0 ? <Typography.Text type="secondary">{tr("Chưa gắn", "未分配")}</Typography.Text> : null}
            {(codes ?? []).map((code) => (
              <Tag key={code}>{code}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: tr("Trạng thái", "状态"),
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
            <Tooltip title={chatOn ? tr("Đang nhận chat website", "正在接收网站聊天") : tr("Không nhận chat website", "不接收网站聊天")}>
              <button
                type="button"
                className={chatOn ? "is-on" : undefined}
                disabled={!props.canWrite || functionBusy === `${person.id}:web_chat`}
                onClick={() => void toggleFunction(person, "web_chat")}
              >
                <MessageOutlined />
              </button>
            </Tooltip>
            <Tooltip title={telegramOn ? tr("Đang nhận Telegram", "正在接收 Telegram") : tr("Không nhận Telegram", "不接收 Telegram")}>
              <button
                type="button"
                className={telegramOn ? "is-on" : undefined}
                disabled={!props.canWrite || functionBusy === `${person.id}:telegram`}
                onClick={() => void toggleFunction(person, "telegram")}
              >
                <SendOutlined />
              </button>
            </Tooltip>
            <Tooltip title={tr("Đổi mật khẩu", "修改密码")}>
              <button type="button" className="is-key" disabled={!props.canWrite} onClick={() => openPassword(person)}>
                <KeyOutlined />
              </button>
            </Tooltip>
            <Tooltip title={person.mfa_enabled ? tr("MFA đang bật. Bấm để gỡ", "MFA 已开启。点击解除") : tr("Chưa bật MFA", "未开启 MFA")}>
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
            <Tooltip title={tr("Sửa hồ sơ", "编辑资料")}>
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
            {tr("Nhân sự", "员工")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Một nhân viên chăm sóc có thể gắn nhiều đài. Icon trên mỗi dòng: chat website, Telegram, đổi mật khẩu, MFA, sửa hồ sơ.", "一名客服可以分配多个站点。每行图标：网站聊天、Telegram、修改密码、MFA、编辑资料。")}</Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => choose({ kind: "create" })}>
            {tr("Thêm nhân viên", "添加员工")}
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
            placeholder={tr("Tìm theo tên hoặc tên đăng nhập", "按姓名或用户名搜索")}
            aria-label={tr("Tìm nhân viên", "搜索员工")}
            style={{ width: 280 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select<StatusFilter>
            value={filter}
            style={{ width: 180 }}
            onChange={setFilter}
            options={[
              { value: "all", label: tr(`Tất cả (${people.length})`, `全部 (${people.length})`) },
              { value: "active", label: tr(`Đang làm (${activeCount})`, `在职 (${activeCount})`) },
              { value: "disabled", label: tr(`Đã khóa (${lockedCount})`, `已锁定 (${lockedCount})`) },
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
            {tr("Xóa bộ lọc", "清除筛选")}
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
              {tr("Thử lại", "重试")}
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
          locale={{ emptyText: tr("Không có người khớp.", "没有匹配的人员。") }}
          onRow={(person) => ({
            onClick: () => choose({ kind: "edit", id: person.id }),
            style: { cursor: "pointer" },
          })}
        />
      </div>

      <Modal
        title={passwordFor ? tr(`Đổi mật khẩu ${passwordFor.display_name}`, `修改 ${passwordFor.display_name} 的密码`) : tr("Đổi mật khẩu", "修改密码")}
        open={passwordFor !== null}
        centered
        confirmLoading={saving}
        okText={passwordShown ? tr("Đóng", "关闭") : tr("Lưu mật khẩu", "保存密码")}
        cancelText={tr("Hủy", "取消")}
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
            {tr("Mật khẩu mới chỉ hiện lúc này: ", "新密码只显示这一次：")}<code className="secret-code">{passwordShown}</code>
            <Button size="small" style={{ marginLeft: 8 }} onClick={() => void copyText(passwordShown).then(setPasswordCopied)}>
              {passwordCopied ? tr("Đã chép", "已复制") : tr("Chép", "复制")}
            </Button>
          </p>
        ) : (
          <>
            <p className="page-note">{tr("Người này sẽ phải đăng nhập lại. Gửi mật khẩu cho họ, CMS không lưu lại.", "此人需要重新登录。请把密码发给对方，后台不会保存。")}</p>
            <p className="page-note">{tr("Mật khẩu mới", "新密码")}</p>
            <Input.Password value={passwordValue} autoComplete="new-password" onChange={(event) => setPasswordValue(event.target.value)} />
            <p className="page-note" style={{ marginTop: 12 }}>{tr("Mật khẩu của bạn", "你的密码")}</p>
            <Input.Password
              autoComplete="current-password"
              value={actorPassword}
              onChange={(event) => setActorPassword(event.target.value)}
            />
            <button type="button" className="text-button" style={{ marginTop: 8 }} onClick={() => setPasswordValue(generatePassword())}>
              {tr("Tạo mật khẩu khác", "生成另一个密码")}
            </button>
          </>
        )}
      </Modal>

      <Modal
        title={mfaFor ? tr(`Gỡ MFA của ${mfaFor.display_name}`, `解除 ${mfaFor.display_name} 的 MFA`) : tr("Gỡ MFA", "解除 MFA")}
        open={mfaFor !== null}
        centered
        confirmLoading={saving}
        okText={tr("Gỡ MFA", "解除 MFA")}
        okButtonProps={{ danger: true }}
        cancelText={tr("Hủy", "取消")}
        onCancel={() => setMfaFor(null)}
        onOk={() => void clearMfa()}
      >
        {formError ? <ErrorAlert error={formError} /> : null}
        <p className="page-note">
          {mfaFor?.id === props.me.id
            ? tr("MFA của bạn sẽ bị gỡ và phiên này đóng.", "你的 MFA 将被解除，当前会话会关闭。")
            : tr("Người này đăng nhập bằng mật khẩu cho đến khi tự bật lại MFA. Phiên đang mở của họ sẽ đóng.", "此人将用密码登录，直到自己重新开启 MFA。其当前会话会关闭。")}
        </p>
        <p className="page-note">{tr("Mật khẩu của bạn", "你的密码")}</p>
        <Input.Password autoComplete="current-password" value={actorPassword} onChange={(event) => setActorPassword(event.target.value)} />
      </Modal>

      <Modal
        title={selection.kind === "create" ? tr("Thêm nhân viên", "添加员工") : draft ? tr(`Sửa ${draft.display_name || draft.username}`, `编辑 ${draft.display_name || draft.username}`) : tr("Sửa nhân viên", "编辑员工")}
        open={editorOpen}
        centered
        width={480}
        styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" } }}
        onCancel={() => choose({ kind: "idle" })}
        okText={selection.kind === "create" ? tr("Tạo nhân viên", "创建员工") : draft?.status === "disabled" ? tr("Lưu và khóa", "保存并锁定") : tr("Lưu thay đổi", "保存更改")}
        cancelText={tr("Đóng", "关闭")}
        confirmLoading={saving}
        okButtonProps={{
          htmlType: "submit",
          form: "staff-form",
          disabled: Boolean(blockReason),
          style: props.canWrite ? undefined : { display: "none" },
        }}
        cancelButtonProps={{ style: props.canWrite ? undefined : { display: "none" } }}
        footer={props.canWrite ? undefined : <Button onClick={() => choose({ kind: "idle" })}>{tr("Đóng", "关闭")}</Button>}
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
        title={tr("Có thay đổi chưa lưu", "有未保存的更改")}
        open={queued !== null}
        onCancel={() => setQueued(null)}
        footer={
          <Space>
            <Button onClick={() => setQueued(null)}>{tr("Tiếp tục sửa", "继续编辑")}</Button>
            <Button danger onClick={() => queued && apply(queued)}>
              {tr("Bỏ thay đổi", "放弃更改")}
            </Button>
          </Space>
        }
      >
        {tr("Thoát lúc này sẽ mất phần vừa sửa.", "现在离开会丢失刚才的修改。")}
      </Modal>
    </section>
  );
}
