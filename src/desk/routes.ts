import { pageLabel } from "./language.tsx";

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
  | "hangupSms"
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
  hangupSms: "/tin-sau-goi",
  embed: "/chat-nhung",
  home: "/trang-chu",
  telegram: "/telegram",
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
  return `${pageLabel(page)} · CSKH VIP`;
}
