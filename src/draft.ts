import { generatePassword, passwordProblem } from "./password.ts";
import type { Draft, FieldErrors, Staff, UpdateStaffBody } from "./types.ts";

export function usernameProblem(username: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    return "Tên đăng nhập từ 3 đến 64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang";
  }
  return null;
}

export function timezoneProblem(value: string): string | null {
  if (!value.trim()) {
    return "Chọn múi giờ";
  }
  try {
    Intl.DateTimeFormat("vi-VN", { timeZone: value }).format(new Date());
    return null;
  } catch {
    return "Múi giờ không hợp lệ";
  }
}

export function emptyDraft(): Draft {
  return {
    username: "",
    display_name: "",
    timezone: "Asia/Ho_Chi_Minh",
    role_codes: ["agent"],
    status: "active",
    password: generatePassword(),
  };
}

export function draftFromStaff(staff: Staff): Draft {
  return {
    username: staff.username,
    display_name: staff.display_name,
    timezone: staff.timezone,
    role_codes: [...staff.roles],
    status: staff.status === "disabled" ? "disabled" : "active",
    password: "",
  };
}

export function cloneDraft(draft: Draft): Draft {
  return { ...draft, role_codes: [...draft.role_codes] };
}

export function sameDraft(left: Draft, right: Draft): boolean {
  return (
    left.username === right.username &&
    left.display_name === right.display_name &&
    left.timezone === right.timezone &&
    left.status === right.status &&
    left.password === right.password &&
    sameRoles(left.role_codes, right.role_codes)
  );
}

export function validateDraft(mode: "create" | "edit", draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  const name = draft.display_name.trim();
  if (!name) {
    errors.display_name = "Nhập tên hiển thị";
  } else if (name.length > 80) {
    errors.display_name = "Tên hiển thị tối đa 80 ký tự";
  }
  const zone = timezoneProblem(draft.timezone);
  if (zone) {
    errors.timezone = zone;
  }
  if (draft.role_codes.length === 0) {
    errors.role_codes = "Chọn ít nhất một vai trò";
  }
  if (mode === "create") {
    const username = usernameProblem(draft.username.trim());
    if (username) {
      errors.username = username;
    }
    const password = passwordProblem(draft.password);
    if (password) {
      errors.password = password;
    }
  } else if (draft.password) {
    const password = passwordProblem(draft.password);
    if (password) {
      errors.password = password;
    }
  }
  return errors;
}

export function patchFromDraft(origin: Draft, draft: Draft): UpdateStaffBody | null {
  const body: UpdateStaffBody = {};
  const name = draft.display_name.trim();
  if (name !== origin.display_name) {
    body.display_name = name;
  }
  if (draft.timezone !== origin.timezone) {
    body.timezone = draft.timezone;
  }
  if (draft.status !== origin.status) {
    body.status = draft.status;
  }
  if (!sameRoles(draft.role_codes, origin.role_codes)) {
    body.role_codes = draft.role_codes;
  }
  if (draft.password) {
    body.password = draft.password;
  }
  return Object.keys(body).length > 0 ? body : null;
}

export function isLastActiveAdmin(people: Staff[], userId: string): boolean {
  const admins = people.filter((person) => person.status === "active" && person.roles.includes("admin"));
  return admins.length === 1 && admins[0]?.id === userId;
}

export function saveBlockReason(input: {
  mode: "create" | "edit";
  draft: Draft;
  isSelf: boolean;
  lastAdmin: boolean;
}): string | null {
  if (input.mode !== "edit") {
    return null;
  }
  if (input.isSelf && input.draft.status === "disabled") {
    return "Không thể tự khóa tài khoản đang dùng";
  }
  const removesAdmin = !input.draft.role_codes.includes("admin");
  if (input.lastAdmin && (input.draft.status === "disabled" || removesAdmin)) {
    return "Cần còn ít nhất một quản trị viên đang hoạt động";
  }
  return null;
}

export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function sameRoles(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((code, index) => code === b[index]);
}
