import type { Role } from "./types.ts";

const PERMISSION_LABELS: Record<string, string> = {
  "staff:read": "Xem nhân sự",
  "staff:write": "Sửa nhân sự",
  "schedule:read": "Xem ca làm",
  "schedule:write": "Sửa ca làm",
  "tasks:read_own": "Xem task của mình",
  "tasks:update_own": "Cập nhật task của mình",
  "tasks:read": "Xem mọi task",
  "tasks:transfer": "Chuyển task",
  "tasks:assign": "Gán task trong hàng chờ",
  "queues:read": "Xem hàng chờ",
  "campaigns:read": "Xem campaign",
  "campaigns:create": "Tạo campaign",
  "campaigns:validate": "Kiểm tra campaign trước khi chạy",
  "campaigns:launch": "Chạy campaign",
  "campaigns:manage": "Tạm dừng hoặc điều khiển campaign",
  "campaigns:report": "Xem báo cáo campaign",
  "customers:read": "Xem khách VIP",
  "customers:import": "Nhập khách",
  "care:revoke": "Gỡ nhãn thành công hoặc không liên hệ",
  "rewards:approve": "Duyệt thưởng",
  "audit:read": "Xem nhật ký",
  "settings:read": "Xem cấu hình giới hạn IP",
  "settings:write": "Sửa cấu hình giới hạn IP",
  "telegram:manage": "Cấu hình bot Telegram",
};

const PERMISSION_ORDER = Object.keys(PERMISSION_LABELS);

const ROLE_NAMES: Record<string, string> = {
  admin: "Quản trị",
  agent: "Nhân viên CSKH",
  campaign_operator: "Người vận hành campaign",
};

export const TIMEZONES = [
  { value: "Asia/Ho_Chi_Minh", label: "Việt Nam — Asia/Ho_Chi_Minh" },
  { value: "Asia/Bangkok", label: "Bangkok — Asia/Bangkok" },
  { value: "Asia/Singapore", label: "Singapore — Asia/Singapore" },
  { value: "UTC", label: "UTC" },
];

export function permissionLabel(code: string): string {
  return PERMISSION_LABELS[code] ?? code;
}

export function roleName(code: string, roles?: Role[]): string {
  return roles?.find((role) => role.code === code)?.name ?? ROLE_NAMES[code] ?? code;
}

export function accessLabels(roleCodes: string[], catalog: Role[]): string[] {
  const codes = new Set<string>();
  for (const roleCode of roleCodes) {
    const role = catalog.find((item) => item.code === roleCode);
    for (const permission of role?.permissions ?? []) {
      codes.add(permission);
    }
  }
  return [...codes].sort((left, right) => rank(left) - rank(right)).map(permissionLabel);
}

export function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status: string): string {
  if (status === "active") {
    return "Đang làm";
  }
  if (status === "disabled") {
    return "Đã khóa";
  }
  return status;
}

export const CARE_LABELS: { value: string; label: string; revoke?: boolean }[] = [
  { value: "da_lien_he_lai", label: "Đã liên hệ lại" },
  { value: "cho_khach_phan_hoi", label: "Chờ khách phản hồi" },
  { value: "dang_ho_tro", label: "Đang hỗ trợ" },
  { value: "hen_lien_he_lai", label: "Hẹn liên hệ lại" },
  { value: "thanh_cong", label: "Thành công" },
  { value: "khach_tu_choi", label: "Khách từ chối" },
  { value: "khong_phan_hoi", label: "Không phản hồi" },
  { value: "dnc", label: "Không liên hệ nữa" },
  { value: "go_thanh_cong", label: "Gỡ thành công", revoke: true },
  { value: "go_dnc", label: "Gỡ không liên hệ", revoke: true },
];

const CARE_HELP: Record<string, string> = {
  hen_lien_he_lai: "Chọn giờ hẹn ở phía trước.",
  khong_phan_hoi: "Cần đủ 3 lần đã liên hệ lại sau tin cuối của khách.",
  dnc: "Đồng ý nhận tin SMS và giọng nói AI sẽ bị thu hồi.",
  thanh_cong: "Không gắn lại khi nhãn thành công còn hiệu lực.",
  go_thanh_cong: "Chỉ gỡ khi đang có nhãn thành công.",
};

export function careLabelName(code: string): string {
  return CARE_LABELS.find((item) => item.value === code)?.label ?? code;
}

export function careLabelHelp(code: string): string {
  return CARE_HELP[code] ?? "";
}

function rank(code: string): number {
  const index = PERMISSION_ORDER.indexOf(code);
  return index === -1 ? PERMISSION_ORDER.length : index;
}
