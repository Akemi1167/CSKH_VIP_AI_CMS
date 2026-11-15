import { deskLang, ROLE_LABEL } from "./desk/language.tsx";
import type { Role } from "./types.ts";

const PERMISSION_LABELS: Record<string, { vi: string; zh: string }> = {
  "staff:read": { vi: "Xem nhân sự", zh: "查看员工" },
  "staff:write": { vi: "Sửa nhân sự", zh: "修改员工" },
  "schedule:read": { vi: "Xem ca làm", zh: "查看班次" },
  "schedule:write": { vi: "Sửa ca làm", zh: "修改班次" },
  "tasks:read_own": { vi: "Xem task của mình", zh: "查看自己的任务" },
  "tasks:update_own": { vi: "Cập nhật task của mình", zh: "更新自己的任务" },
  "tasks:read": { vi: "Xem mọi task", zh: "查看全部任务" },
  "tasks:read_team": { vi: "Xem việc của đài mình", zh: "查看本站点的工作" },
  "tasks:transfer": { vi: "Chuyển task", zh: "转交任务" },
  "tasks:assign": { vi: "Gán task trong hàng chờ", zh: "分配队列中的任务" },
  "queues:read": { vi: "Xem hàng chờ", zh: "查看队列" },
  "campaigns:read": { vi: "Xem campaign", zh: "查看活动" },
  "campaigns:create": { vi: "Tạo campaign", zh: "创建活动" },
  "campaigns:validate": { vi: "Kiểm tra campaign trước khi chạy", zh: "运行前检查活动" },
  "campaigns:launch": { vi: "Chạy campaign", zh: "启动活动" },
  "campaigns:manage": { vi: "Tạm dừng hoặc điều khiển campaign", zh: "暂停或控制活动" },
  "campaigns:report": { vi: "Xem báo cáo campaign", zh: "查看活动报表" },
  "recordings:review": { vi: "Chấm điểm ghi âm cuộc gọi", zh: "为通话录音评分" },
  "customers:read": { vi: "Xem khách VIP", zh: "查看VIP会员" },
  "customers:import": { vi: "Nhập khách", zh: "导入会员" },
  "care:revoke": { vi: "Gỡ nhãn thành công hoặc không liên hệ", zh: "取消成功或不联系标签" },
  "rewards:approve": { vi: "Duyệt thưởng", zh: "审批奖励" },
  "audit:read": { vi: "Xem nhật ký", zh: "查看日志" },
  "settings:read": { vi: "Xem cấu hình giới hạn IP", zh: "查看IP限制配置" },
  "settings:write": { vi: "Sửa cấu hình giới hạn IP", zh: "修改IP限制配置" },
  "telegram:manage": { vi: "Cấu hình bot Telegram", zh: "配置Telegram机器人" },
};

const PERMISSION_ORDER = Object.keys(PERMISSION_LABELS);

const ROLE_NAMES: Record<string, string> = {
  admin: "Quản trị",
  agent: "Nhân viên CSKH",
  campaign_operator: "Người vận hành campaign",
};

const TIMEZONE_CHOICES = [
  { value: "Asia/Ho_Chi_Minh", vi: "Việt Nam — Asia/Ho_Chi_Minh", zh: "越南 — Asia/Ho_Chi_Minh" },
  { value: "Asia/Bangkok", vi: "Bangkok — Asia/Bangkok", zh: "曼谷 — Asia/Bangkok" },
  { value: "Asia/Singapore", vi: "Singapore — Asia/Singapore", zh: "新加坡 — Asia/Singapore" },
  { value: "UTC", vi: "UTC", zh: "UTC" },
];

export function timezoneChoices(): { value: string; label: string }[] {
  return TIMEZONE_CHOICES.map((zone) => ({ value: zone.value, label: say(zone.vi, zone.zh) }));
}

export function timezoneName(value: string): string {
  return TIMEZONE_CHOICES.find((zone) => zone.value === value)?.[deskLang()] ?? value;
}

export function permissionLabel(code: string): string {
  const labels = PERMISSION_LABELS[code];
  return labels ? say(labels.vi, labels.zh) : code;
}

export function roleName(code: string, roles?: Role[]): string {
  const named = roles?.find((role) => role.code === code)?.name;
  if (named) {
    return named;
  }
  const labels = ROLE_LABEL[code];
  if (labels) {
    return labels[deskLang()];
  }
  return ROLE_NAMES[code] ?? code;
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
  return new Intl.DateTimeFormat(deskLang() === "zh" ? "zh-CN" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status: string): string {
  if (status === "active") {
    return say("Đang làm", "在职");
  }
  if (status === "disabled") {
    return say("Đã khóa", "已停用");
  }
  return status;
}

const CARE_LABELS_ALL: { value: string; vi: string; zh: string; revoke?: boolean }[] = [
  { value: "da_lien_he_lai", vi: "Đã liên hệ lại", zh: "已回访" },
  { value: "cho_khach_phan_hoi", vi: "Chờ khách phản hồi", zh: "等待会员回复" },
  { value: "dang_ho_tro", vi: "Đang hỗ trợ", zh: "正在处理" },
  { value: "hen_lien_he_lai", vi: "Hẹn liên hệ lại", zh: "预约回访" },
  { value: "thanh_cong", vi: "Thành công", zh: "成功" },
  { value: "khach_tu_choi", vi: "Khách từ chối", zh: "会员拒绝" },
  { value: "khong_phan_hoi", vi: "Không phản hồi", zh: "无回复" },
  { value: "dnc", vi: "Không liên hệ nữa", zh: "不再联系" },
  { value: "go_thanh_cong", vi: "Gỡ thành công", zh: "取消成功", revoke: true },
  { value: "go_dnc", vi: "Gỡ không liên hệ", zh: "取消不再联系", revoke: true },
];

export function careChoices(): { value: string; label: string; revoke?: boolean }[] {
  return CARE_LABELS_ALL.map((item) => ({ value: item.value, label: say(item.vi, item.zh), revoke: item.revoke }));
}

const CARE_HELP: Record<string, { vi: string; zh: string }> = {
  hen_lien_he_lai: { vi: "Chọn giờ hẹn ở phía trước.", zh: "请在前面选择预约时间。" },
  khong_phan_hoi: { vi: "Cần đủ 3 lần đã liên hệ lại sau tin cuối của khách.", zh: "会员最后一条消息之后，需要已回访满 3 次。" },
  dnc: { vi: "Đồng ý nhận tin SMS và giọng nói AI sẽ bị thu hồi.", zh: "接收短信和 AI 语音的同意将被收回。" },
  thanh_cong: { vi: "Không gắn lại khi nhãn thành công còn hiệu lực.", zh: "成功标签仍有效时不能再次标记。" },
  go_thanh_cong: { vi: "Chỉ gỡ khi đang có nhãn thành công.", zh: "只有当前是成功标签时才能取消。" },
};

export function careLabelName(code: string): string {
  const item = CARE_LABELS_ALL.find((label) => label.value === code);
  return item ? say(item.vi, item.zh) : code;
}

export function careLabelHelp(code: string): string {
  const help = CARE_HELP[code];
  return help ? say(help.vi, help.zh) : "";
}

function say(vi: string, zh: string): string {
  return deskLang() === "zh" ? zh : vi;
}

function rank(code: string): number {
  const index = PERMISSION_ORDER.indexOf(code);
  return index === -1 ? PERMISSION_ORDER.length : index;
}
