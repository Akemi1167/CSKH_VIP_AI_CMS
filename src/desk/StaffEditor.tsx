import { Alert, Button, Checkbox, Form, Input, Segmented, Select } from "antd";
import { useEffect, useState } from "react";
import { timezoneChoices, accessLabels, roleName, statusLabel } from "../copy.ts";
import { useTr } from "./language.tsx";
import { copyText, generatePassword } from "../password.ts";
import type { Draft, FieldErrors, Role } from "../types.ts";

export function StaffEditor(props: {
  mode: "create" | "edit";
  draft: Draft;
  roles: Role[];
  stations: string[];
  canWrite: boolean;
  isSelf: boolean;
  mfaEnabled: boolean;
  fieldErrors: FieldErrors;
  blockReason: string | null;
  endsOwnSession: boolean;
  needsConfirm: boolean;
  confirmPassword: string;
  onConfirmPassword: (value: string) => void;
  saved: string | null;
  issuedPassword: string | null;
  focusToken: string;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
}) {
  const tr = useTr();
  const [copied, setCopied] = useState<"password" | "issued" | "failed" | null>(null);
  const [reveal, setReveal] = useState(props.mode === "create");
  const [showAllPerms, setShowAllPerms] = useState(false);
  const choices = timezoneChoices();
  const zones = choices.some((zone) => zone.value === props.draft.timezone)
    ? choices
    : [{ value: props.draft.timezone, label: props.draft.timezone }, ...choices];
  const catalogCodes = props.roles.map((role) => role.code);
  const extraCodes = props.draft.role_codes.filter((code) => !catalogCodes.includes(code));
  const roleOptions = [...props.roles.map((role) => role.code), ...extraCodes];
  const access = accessLabels(props.draft.role_codes, props.roles);
  const locks = props.mode === "edit" && props.draft.status === "disabled";
  const needsAdminMfa = props.mode === "edit" && props.draft.role_codes.includes("admin") && !props.mfaEnabled;
  const preview = showAllPerms || access.length <= 4 ? access : access.slice(0, 4);
  const hiddenCount = access.length - preview.length;

  useEffect(() => {
    setReveal(props.mode === "create");
    setCopied(null);
    setShowAllPerms(false);
  }, [props.focusToken, props.mode]);

  async function copy(value: string, kind: "password" | "issued") {
    const ok = await copyText(value);
    setCopied(ok ? kind : "failed");
  }

  function toggleRole(code: string) {
    if (!props.canWrite) {
      return;
    }
    const role_codes = props.draft.role_codes.includes(code)
      ? props.draft.role_codes.filter((item) => item !== code)
      : [...props.draft.role_codes, code];
    props.onChange({ ...props.draft, role_codes });
    setShowAllPerms(false);
  }

  return (
    <Form id="staff-form" className="staff-form" layout="vertical" requiredMark={false} onFinish={props.onSubmit}>
      {props.saved ? <Alert type="success" showIcon style={{ marginBottom: 12 }} message={props.saved} /> : null}
      {props.issuedPassword ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={tr("Mật khẩu chỉ hiện lúc này.", "密码只显示这一次。")}
          description={
            <span>
              <code className="secret-code">{props.issuedPassword}</code>
              <Button size="small" style={{ marginTop: 8 }} onClick={() => void copy(props.issuedPassword ?? "", "issued")}>
                {copied === "issued" ? tr("Đã chép", "已复制") : tr("Chép", "复制")}
              </Button>
            </span>
          }
        />
      ) : null}
      {props.blockReason ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={props.blockReason} /> : null}
      {copied === "failed" ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={tr("Trình duyệt chặn sao chép. Hãy chọn chuỗi và chép tay.", "浏览器阻止了复制。请选中内容手动复制。")} /> : null}

      {props.mode === "create" ? (
        <Form.Item label={tr("Tên đăng nhập", "用户名")} validateStatus={props.fieldErrors.username ? "error" : ""} help={props.fieldErrors.username}>
          <Input
            id="staff-username"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={!props.canWrite}
            value={props.draft.username}
            onChange={(event) => props.onChange({ ...props.draft, username: event.target.value.toLowerCase() })}
          />
        </Form.Item>
      ) : (
        <p className="page-note" style={{ marginTop: 0 }}>
          {tr(`Tên đăng nhập ${props.draft.username}`, `用户名 ${props.draft.username}`)}
        </p>
      )}

      <Form.Item label={tr("Tên hiển thị", "显示名称")} validateStatus={props.fieldErrors.display_name ? "error" : ""} help={props.fieldErrors.display_name}>
        <Input
          autoComplete="off"
          disabled={!props.canWrite}
          value={props.draft.display_name}
          onChange={(event) => props.onChange({ ...props.draft, display_name: event.target.value })}
        />
      </Form.Item>

      <div className="staff-split">
        <Form.Item label={tr("Múi giờ", "时区")} validateStatus={props.fieldErrors.timezone ? "error" : ""} help={props.fieldErrors.timezone}>
          <Select
            disabled={!props.canWrite}
            value={props.draft.timezone}
            options={zones.map((zone) => ({ value: zone.value, label: zone.label }))}
            onChange={(value) => props.onChange({ ...props.draft, timezone: value })}
          />
        </Form.Item>
        {props.mode === "edit" ? (
          <Form.Item label={tr("Trạng thái", "状态")}>
            <Segmented
              block
              value={props.draft.status}
              disabled={!props.canWrite}
              options={[
                { label: statusLabel("active"), value: "active" },
                { label: statusLabel("disabled"), value: "disabled", disabled: props.isSelf },
              ]}
              onChange={(value) => props.onChange({ ...props.draft, status: value as Draft["status"] })}
            />
          </Form.Item>
        ) : null}
      </div>

      <Form.Item label={tr("Vai trò", "角色")} validateStatus={props.fieldErrors.role_codes ? "error" : ""} help={props.fieldErrors.role_codes}>
        <div className="role-list">
          {roleOptions.map((code) => {
            const role = props.roles.find((item) => item.code === code);
            const checked = props.draft.role_codes.includes(code);
            return (
              <div
                key={code}
                className={checked ? "role-row role-row--on" : "role-row"}
                onClick={() => toggleRole(code)}
              >
                <Checkbox checked={checked} disabled={!props.canWrite} style={{ pointerEvents: "none" }} />
                <span className="role-row__name">{roleName(code, props.roles)}</span>
                <span className="role-row__meta">{role ? tr(`${role.permissions.length} quyền`, `${role.permissions.length} 项权限`) : tr("Ngoài danh mục", "不在目录中")}</span>
              </div>
            );
          })}
        </div>
        {access.length > 0 ? (
          <p className="perm-box">
            {preview.join(", ")}
            {hiddenCount > 0 ? tr(` và ${hiddenCount} quyền khác. `, `，另有 ${hiddenCount} 项权限。`) : " "}
            {access.length > 4 ? (
              <button type="button" className="text-button" onClick={() => setShowAllPerms((value) => !value)}>
                {showAllPerms ? tr("Thu gọn", "收起") : tr("Hiện đủ", "展开全部")}
              </button>
            ) : null}
          </p>
        ) : (
          <p className="perm-box">{tr("Chưa chọn vai trò.", "尚未选择角色。")}</p>
        )}
        {props.isSelf ? <p className="page-note">{tr("Bạn không tự khóa tài khoản đang dùng.", "你不能锁定自己正在使用的账号。")}</p> : null}
        {locks ? <p className="page-note">{tr("Khóa sẽ đăng xuất người này khỏi mọi thiết bị.", "锁定后此人会从所有设备退出。")}</p> : null}
        {needsAdminMfa ? <p className="page-note">{tr("Lần đăng nhập tới, người này phải bật MFA.", "此人下次登录必须开启 MFA。")}</p> : null}
      </Form.Item>

      <Form.Item label={tr("Chức năng làm việc", "工作职能")}>
        <div className="role-list">
          {(
            [
              ["web_chat", tr("Nhận chat website", "接收网站聊天")],
              ["telegram", tr("Nhận Telegram", "接收 Telegram")],
            ] as const
          ).map(([code, label]) => {
            const checked = props.draft.work_functions.includes(code);
            return (
              <div
                key={code}
                className={checked ? "role-row role-row--on" : "role-row"}
                onClick={() => {
                  if (!props.canWrite) {
                    return;
                  }
                  const work_functions = checked
                    ? props.draft.work_functions.filter((item) => item !== code)
                    : [...props.draft.work_functions, code];
                  props.onChange({ ...props.draft, work_functions });
                }}
              >
                <Checkbox checked={checked} disabled={!props.canWrite} style={{ pointerEvents: "none" }} />
                <span className="role-row__name">{label}</span>
              </div>
            );
          })}
        </div>
        <p className="page-note">{tr("Hàng chờ chỉ giao đúng loại hội thoại đã bật. Tắt cả hai thì người này không nhận hội thoại mới. Nút nhận việc trên desk vẫn phải bật.", "队列只分配已开启的会话类型。两项都关闭则不再接收新会话。工作台上的接单开关仍需打开。")}</p>
      </Form.Item>

      {props.draft.role_codes.includes("agent") ? (
        <Form.Item label={tr("Đài chăm sóc", "负责站点")}>
          <Select
            mode="multiple"
            allowClear
            disabled={!props.canWrite}
            placeholder={props.stations.length === 0 ? tr("Chưa có đài đang mở", "没有已开启的站点") : tr("Chọn một hoặc nhiều đài", "选择一个或多个站点")}
            value={props.draft.stations}
            options={[...new Set([...props.stations, ...props.draft.stations])].sort().map((code) => ({ value: code, label: code }))}
            onChange={(stations) => props.onChange({ ...props.draft, stations })}
          />
          <p className="page-note">{tr("Một nhân viên có thể chăm nhiều đài. Hàng chờ chỉ giao hội viên của những đài đã chọn.", "一名员工可以负责多个站点。队列只会分配所选站点的会员。")}</p>
        </Form.Item>
      ) : null}

      <Form.Item
        label={props.mode === "create" ? tr("Mật khẩu tạm", "临时密码") : tr("Mật khẩu mới", "新密码")}
        validateStatus={props.fieldErrors.password ? "error" : ""}
        help={props.fieldErrors.password || (props.mode === "create" ? tr("Gửi mật khẩu này cho người đó. CMS không lưu lại.", "请把这个密码发给对方。后台不会保存。") : tr("Để trống nếu không đổi.", "不修改请留空。"))}
      >
        <Input.Password
          autoComplete="new-password"
          spellCheck={false}
          disabled={!props.canWrite}
          visibilityToggle={{ visible: reveal, onVisibleChange: setReveal }}
          value={props.draft.password}
          onChange={(event) => props.onChange({ ...props.draft, password: event.target.value })}
        />
        <div className="staff-password-actions">
          <button
            type="button"
            className="text-button"
            disabled={!props.canWrite}
            onClick={() => {
              setReveal(true);
              props.onChange({ ...props.draft, password: generatePassword() });
            }}
          >
            {tr("Tạo mật khẩu", "生成密码")}
          </button>
          {props.draft.password ? (
            <button type="button" className="text-button" onClick={() => void copy(props.draft.password, "password")}>
              {copied === "password" ? tr("Đã chép", "已复制") : tr("Chép", "复制")}
            </button>
          ) : null}
        </div>
      </Form.Item>

      {props.needsConfirm ? (
        <Form.Item
          label={tr("Mật khẩu của bạn", "你的密码")}
          validateStatus={props.fieldErrors.current_password ? "error" : ""}
          help={props.fieldErrors.current_password || tr("Phiên đăng nhập không đủ. Nhập mật khẩu bạn đang dùng để xác nhận.", "登录会话权限不足。请输入你正在使用的密码以确认。")}
        >
          <Input.Password
            autoComplete="current-password"
            spellCheck={false}
            disabled={!props.canWrite}
            value={props.confirmPassword}
            onChange={(event) => props.onConfirmPassword(event.target.value)}
          />
        </Form.Item>
      ) : null}

      {props.endsOwnSession ? <p className="page-note">{tr("Lưu vai trò hoặc mật khẩu của chính bạn sẽ đăng xuất phiên này.", "保存你自己的角色或密码会使当前会话退出。")}</p> : null}
      {!props.canWrite ? <p className="page-note">{tr("Bạn xem được hồ sơ này. Sửa nhân sự cần quyền riêng.", "你可以查看这份资料。修改员工需要单独权限。")}</p> : null}
    </Form>
  );
}
