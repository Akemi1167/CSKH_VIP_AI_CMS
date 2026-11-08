export type DeskPage =
  | "overview"
  | "inbox"
  | "contacts"
  | "tasks"
  | "history"
  | "personal"
  | "queue"
  | "schedule"
  | "staff"
  | "customers"
  | "warehouse"
  | "distribute"
  | "campaigns"
  | "shift"
  | "effect"
  | "rewards"
  | "journal"
  | "stations"
  | "media"
  | "stationSms"
  | "callTasks"
  | "voice"
  | "voiceReview"
  | "smsHistory"
  | "voiceHistory"
  | "rateLimit"
  | "chatIdle"
  | "voiceLimit"
  | "embed"
  | "home"
  | "telegram"
  | "verify";

export const DESK_PATH: Record<DeskPage, string> = {
  overview: "/tong-quan",
  inbox: "/hop-thu",
  contacts: "/lien-he",
  tasks: "/nhiem-vu",
  history: "/lich-su-cham-soc",
  personal: "/bao-cao-ca-nhan",
  verify: "/xac-minh",
  queue: "/dieu-phoi",
  schedule: "/ca-lam",
  staff: "/nhan-vien",
  customers: "/hoi-vien",
  warehouse: "/kho-data",
  distribute: "/phan-bo",
  campaigns: "/chien-dich",
  shift: "/bao-cao-ca",
  effect: "/hieu-qua",
  rewards: "/thuong",
  journal: "/nhat-ky",
  stations: "/hau-dai",
  media: "/media",
  stationSms: "/tin-nhan",
  callTasks: "/goi-nhom",
  voice: "/goi-thu",
  voiceReview: "/cham-diem",
  smsHistory: "/lich-su-tin",
  voiceHistory: "/lich-su-goi",
  rateLimit: "/ip",
  chatIdle: "/thoi-gian-chat",
  voiceLimit: "/thoi-luong-goi",
  embed: "/chat-nhung",
  home: "/trang-chu",
  telegram: "/telegram",
};

const DESK_LABEL: Record<DeskPage, string> = {
  overview: "Tổng quan",
  inbox: "Hộp thư hỗ trợ",
  contacts: "Cuộc gọi & liên hệ",
  tasks: "Nhiệm vụ",
  history: "Lịch sử chăm sóc",
  personal: "Báo cáo cá nhân",
  verify: "Xác minh tài khoản",
  queue: "Điều phối Ticket",
  schedule: "Ca làm",
  staff: "Quản lý nhân viên",
  customers: "Hội viên VIP",
  warehouse: "Kho Data tập trung",
  distribute: "Phân bổ Data",
  campaigns: "Chiến dịch",
  shift: "Báo cáo ca",
  effect: "Thống kê hiệu quả",
  rewards: "Thưởng",
  journal: "Nhật ký",
  stations: "Hậu đài",
  media: "Media",
  stationSms: "Tin nhắn",
  callTasks: "Task gọi nhóm",
  voice: "Gọi thử",
  voiceReview: "Chấm điểm cuộc gọi",
  smsHistory: "Lịch sử tin nhắn",
  voiceHistory: "Lịch sử cuộc gọi",
  rateLimit: "Không chặn IP",
  chatIdle: "Thời gian chat",
  voiceLimit: "Thời lượng cuộc gọi",
  embed: "Chat nhúng",
  home: "Trang chủ",
  telegram: "Telegram",
};

const PATH_PAGE = new Map<string, DeskPage>(Object.entries(DESK_PATH).map(([page, path]) => [path, page as DeskPage]));

export function deskPath(page: DeskPage): string {
  return DESK_PATH[page];
}

export function deskPathname(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function pageFromPath(path = deskPathname()): DeskPage | null {
  return PATH_PAGE.get(path) ?? null;
}

export function rememberPage(page: DeskPage, mode: "push" | "replace"): void {
  const path = DESK_PATH[page];
  if (deskPathname() === path) {
    return;
  }
  const update = mode === "push" ? window.history.pushState : window.history.replaceState;
  update.call(window.history, null, "", path);
}

export function deskTitle(page: DeskPage): string {
  return `${DESK_LABEL[page]} · CSKH VIP`;
}
