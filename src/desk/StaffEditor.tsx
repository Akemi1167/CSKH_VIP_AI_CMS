import { Alert, Button, Checkbox, Form, Input, Segmented, Select } from "antd";
import { useEffect, useState } from "react";
import { TIMEZONES, accessLabels, roleName, statusLabel } from "../copy.ts";
import { copyText, generatePassword } from "../password.ts";
import type { Draft, FieldErrors, Role } from "../types.ts";

export function StaffEditor(props: {
  mode: "create" | "edit";
  draft: Draft;
  roles: Role[];
  canWrite: boolean;
  isSelf: boolean;
  mfaEnabled: boolean;
  fieldErrors: FieldErrors;
  blockReason: string | null;
  endsOwnSession: boolean;
  saved: string | null;
  issuedPassword: string | null;
  focusToken: string;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
}) {
  const [copied, setCopied] = useState<"password" | "issued" | "failed" | null>(null);
  const [reveal, setReveal] = useState(props.mode === "create");
  const [showAllPerms, setShowAllPerms] = useState(false);
  const zones = TIMEZONES.some((zone) => zone.value === props.draft.timezone)
    ? TIMEZONES
    : [{ value: props.draft.timezone, label: props.draft.timezone }, ...TIMEZONES];
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
          message="Mật khẩu chỉ hiện lúc này."
          description={
            <span>
              <code className="secret-code">{props.issuedPassword}</code>
              <Button size="small" style={{ marginTop: 8 }} onClick={() => void copy(props.issuedPassword ?? "", "issued")}>
                {copied === "issued" ? "Đã chép" : "Chép"}
              </Button>
            </span>
          }
        />
      ) : null}
      {props.blockReason ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={props.blockReason} /> : null}
      {copied === "failed" ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Trình duyệt chặn sao chép. Hãy chọn chuỗi và chép tay." /> : null}

      {props.mode === "create" ? (
        <Form.Item label="Tên đăng nhập" validateStatus={props.fieldErrors.username ? "error" : ""} help={props.fieldErrors.username}>
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
          Tên đăng nhập {props.draft.username}
        </p>
      )}

      <Form.Item label="Tên hiển thị" validateStatus={props.fieldErrors.display_name ? "error" : ""} help={props.fieldErrors.display_name}>
        <Input
          autoComplete="off"
          disabled={!props.canWrite}
          value={props.draft.display_name}
          onChange={(event) => props.onChange({ ...props.draft, display_name: event.target.value })}
        />
      </Form.Item>

      <div className="staff-split">
        <Form.Item label="Múi giờ" validateStatus={props.fieldErrors.timezone ? "error" : ""} help={props.fieldErrors.timezone}>
          <Select
            disabled={!props.canWrite}
            value={props.draft.timezone}
            options={zones.map((zone) => ({ value: zone.value, label: zone.label }))}
            onChange={(value) => props.onChange({ ...props.draft, timezone: value })}
          />
        </Form.Item>
        {props.mode === "edit" ? (
          <Form.Item label="Trạng thái">
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

      <Form.Item label="Vai trò" validateStatus={props.fieldErrors.role_codes ? "error" : ""} help={props.fieldErrors.role_codes}>
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
                <span className="role-row__meta">{role ? `${role.permissions.length} quyền` : "Ngoài danh mục"}</span>
              </div>
            );
          })}
        </div>
        {access.length > 0 ? (
          <p className="perm-box">
            {preview.join(", ")}
            {hiddenCount > 0 ? ` và ${hiddenCount} quyền khác. ` : " "}
            {access.length > 4 ? (
              <button type="button" className="text-button" onClick={() => setShowAllPerms((value) => !value)}>
                {showAllPerms ? "Thu gọn" : "Hiện đủ"}
              </button>
            ) : null}
          </p>
        ) : (
          <p className="perm-box">Chưa chọn vai trò.</p>
        )}
        {props.isSelf ? <p className="page-note">Bạn không tự khóa tài khoản đang dùng.</p> : null}
        {locks ? <p className="page-note">Khóa sẽ đăng xuất người này khỏi mọi thiết bị.</p> : null}
        {needsAdminMfa ? <p className="page-note">Lần đăng nhập tới, người này phải bật MFA.</p> : null}
      </Form.Item>

      <Form.Item
        label={props.mode === "create" ? "Mật khẩu tạm" : "Mật khẩu mới"}
        validateStatus={props.fieldErrors.password ? "error" : ""}
        help={props.fieldErrors.password || (props.mode === "create" ? "Gửi mật khẩu này cho người đó. CMS không lưu lại." : "Để trống nếu không đổi.")}
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
            Tạo mật khẩu
          </button>
          {props.draft.password ? (
            <button type="button" className="text-button" onClick={() => void copy(props.draft.password, "password")}>
              {copied === "password" ? "Đã chép" : "Chép"}
            </button>
          ) : null}
        </div>
      </Form.Item>

      {props.endsOwnSession ? <p className="page-note">Lưu vai trò hoặc mật khẩu của chính bạn sẽ đăng xuất phiên này.</p> : null}
      {!props.canWrite ? <p className="page-note">Bạn xem được hồ sơ này. Sửa nhân sự cần quyền riêng.</p> : null}
    </Form>
  );
}
