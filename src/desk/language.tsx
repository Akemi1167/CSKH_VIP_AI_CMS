import { useEffect, useState } from "react";
import type { DeskPage } from "./routes.ts";

export type DeskLang = "vi" | "zh";

const STORAGE = "cskh.cms-lang";

const listeners = new Set<() => void>();

let current: DeskLang = readStored();

export function deskLang(): DeskLang {
  return current;
}

export function setDeskLang(next: DeskLang): void {
  if (next === current) {
    return;
  }
  current = next;
  localStorage.setItem(STORAGE, next);
  applyLang(next);
  for (const listener of listeners) {
    listener();
  }
}

export function useDeskLang(): DeskLang {
  const [lang, setLang] = useState(current);
  useEffect(() => {
    const listener = () => setLang(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return lang;
}

export function useTr(): (vi: string, zh: string) => string {
  const lang = useDeskLang();
  return (vi, zh) => (lang === "zh" ? zh : vi);
}

export function LangSwitch() {
  const lang = useDeskLang();
  return (
    <div className="cms-lang">
      <button type="button" className={lang === "vi" ? "is-on" : undefined} onClick={() => setDeskLang("vi")}>
        VI
      </button>
      <button type="button" className={lang === "zh" ? "is-on" : undefined} onClick={() => setDeskLang("zh")}>
        中文
      </button>
    </div>
  );
}

const PAGE_LABEL: Record<DeskPage, { vi: string; zh: string }> = {
  overview: { vi: "Tổng quan", zh: "总览" },
  inbox: { vi: "Hộp thư hỗ trợ", zh: "客服收件箱" },
  contacts: { vi: "Cuộc gọi & liên hệ", zh: "通话与联系" },
  tasks: { vi: "Nhiệm vụ", zh: "任务" },
  history: { vi: "Lịch sử chăm sóc", zh: "关怀记录" },
  personal: { vi: "Báo cáo cá nhân", zh: "个人报表" },
  verify: { vi: "Xác minh tài khoản", zh: "账户验证" },
  queue: { vi: "Điều phối Ticket", zh: "工单调度" },
  schedule: { vi: "Ca làm", zh: "班次" },
  staff: { vi: "Quản lý nhân viên", zh: "员工管理" },
  customers: { vi: "Hội viên VIP", zh: "VIP会员" },
  warehouse: { vi: "Kho Data tập trung", zh: "数据集中库" },
  distribute: { vi: "Phân bổ Data", zh: "数据分配" },
  campaigns: { vi: "Chiến dịch", zh: "活动" },
  shift: { vi: "Báo cáo ca", zh: "班次报表" },
  effect: { vi: "Thống kê hiệu quả", zh: "效果统计" },
  rewards: { vi: "Thưởng", zh: "奖励" },
  journal: { vi: "Nhật ký", zh: "日志" },
  stations: { vi: "Hậu đài", zh: "站点" },
  media: { vi: "Media", zh: "素材" },
  stationSms: { vi: "Tin nhắn", zh: "短信" },
  callTasks: { vi: "Task gọi nhóm", zh: "群呼任务" },
  voice: { vi: "Gọi thử", zh: "试呼" },
  voiceReview: { vi: "Chấm điểm cuộc gọi", zh: "通话评分" },
  smsHistory: { vi: "Lịch sử tin nhắn", zh: "短信记录" },
  voiceHistory: { vi: "Lịch sử cuộc gọi", zh: "通话记录" },
  rateLimit: { vi: "Không chặn IP", zh: "不限制IP" },
  chatIdle: { vi: "Thời gian chat", zh: "聊天时长" },
  voiceLimit: { vi: "Thời lượng cuộc gọi", zh: "通话时长" },
  hangupSms: { vi: "Tin sau cuộc gọi", zh: "通话后短信" },
  embed: { vi: "Chat nhúng", zh: "嵌入聊天" },
  home: { vi: "Trang chủ", zh: "首页" },
  telegram: { vi: "Telegram", zh: "Telegram" },
};

export function pageLabel(page: DeskPage): string {
  return PAGE_LABEL[page][current];
}

export const ROLE_LABEL: Record<string, { vi: string; zh: string }> = {
  admin: { vi: "Quản trị", zh: "管理员" },
  agent: { vi: "Nhân viên CSKH", zh: "客服" },
  campaign_operator: { vi: "Người vận hành campaign", zh: "活动运营" },
};

type Phrase = { vi: string; zh: string };

export const DESK_TEXT = {
  console: { vi: "Bảng điều khiển", zh: "控制台" },
  ready: { vi: "Hệ thống sẵn sàng", zh: "系统正常" },
  degraded: { vi: "API sống, dữ liệu chưa sẵn", zh: "接口可用，数据未就绪" },
  offline: { vi: "Mất kết nối API", zh: "接口断开" },
  search: { vi: "Tìm menu", zh: "搜索菜单" },
  accepting: { vi: "Đang nhận việc", zh: "正在接单" },
  paused: { vi: "Đang nghỉ", zh: "暂停接单" },
  acceptingHint: { vi: "Gạt tắt khi ăn cơm hoặc đi vệ sinh. Việc đang mở vẫn ở chỗ bạn.", zh: "吃饭或离开时关掉。进行中的工作仍留在你这里。" },
  pausedHint: { vi: "Việc mới chưa giao cho bạn. Gạt lại khi sẵn sàng nhận tiếp.", zh: "新工作暂不分配给你。准备好后再打开。" },
  password: { vi: "Đổi mật khẩu", zh: "修改密码" },
  logout: { vi: "Đăng xuất", zh: "退出" },
  sessionEnded: { vi: "Phiên đã hết. Đăng nhập lại.", zh: "会话已结束。请重新登录。" },
  availabilityError: { vi: "Không đổi được trạng thái nhận việc", zh: "无法更改接单状态" },
  logoutError: { vi: "Không đăng xuất được", zh: "无法退出" },
  passwordChanged: { vi: "Đã đổi mật khẩu. Đăng nhập lại.", zh: "密码已修改。请重新登录。" },
  operate: { vi: "Chăm sóc hội viên", zh: "会员关怀" },
  sms: { vi: "Tin nhắn", zh: "短信" },
  voice: { vi: "Gọi AI", zh: "AI呼叫" },
  settings: { vi: "Cài đặt", zh: "设置" },
  settingsSystem: { vi: "Cài đặt hệ thống", zh: "系统设置" },
  systemGroup: { vi: "Hệ thống", zh: "系统" },
  otherGroup: { vi: "Khác", zh: "其他" },
  central: { vi: "Quản lý tập trung", zh: "集中管理" },
  other: { vi: "Khác", zh: "其他" },
  unsavedTitle: { vi: "Ca chưa lưu", zh: "班次未保存" },
  stay: { vi: "Ở lại", zh: "留下" },
  discard: { vi: "Bỏ ca đang sửa", zh: "放弃正在修改的班次" },
  unsavedBody: { vi: "Giờ bạn vừa chọn chưa được lưu.", zh: "刚选的时间还没保存。" },
  collapse: { vi: "Thu gọn", zh: "收起" },
  inboxLeadAll: {
    vi: "Mọi hội thoại của tất cả đài, kể cả đài chưa có nhân viên. Chat chưa giao hiện ở đây. Mở rồi bấm Giao để đưa cho người chăm sóc.",
    zh: "所有站点的会话，包括还没有员工的站点。未分配的聊天显示在这里。打开后点分配给客服。",
  },
  inboxLeadTeam: {
    vi: "Hội thoại của nhân viên các đài bạn phụ trách. Có thể chuyển cho người khác hoặc thu về tự xử lý.",
    zh: "你负责站点的员工会话。可以转给别人，或收回自己处理。",
  },
  inboxLeadOwn: {
    vi: "Hội thoại đang giao cho bạn. Mở cửa sổ để chăm nhiều khách cùng lúc, kể cả khi sang màn khác.",
    zh: "分配给你的会话。可以同时处理多位客户，换页面也不会关掉。",
  },
  tasksLeadTeam: { vi: "Việc của nhân viên các đài bạn phụ trách.", zh: "你负责站点的员工任务。" },
  tasksLeadOwn: { vi: "Việc đang giao. Bấm một dòng để cập nhật trạng thái hoặc chuyển người.", zh: "已分配的任务。点一行可更新状态或转给别人。" },
  smsHistoryLead: { vi: "Tin đã gửi qua Laaffic trong 7 ngày gần nhất.", zh: "最近 7 天通过 Laaffic 发出的短信。" },
  voiceHistoryLead: { vi: "Từng cuộc gọi AI trên Laaffic trong 7 ngày gần nhất. Danh sách tự cập nhật, không cần bấm đồng bộ.", zh: "最近 7 天 Laaffic 上的每通 AI 呼叫。列表会自动更新，不必手动同步。" },
} satisfies Record<string, Phrase>;

export const PASSWORD_TEXT = {
  title: { vi: "Đổi mật khẩu", zh: "修改密码" },
  ok: { vi: "Đổi và đăng xuất", zh: "修改并退出" },
  later: { vi: "Để sau", zh: "以后再说" },
  note: { vi: "Sau khi đổi, mọi phiên của bạn bị đăng xuất. Bạn đăng nhập lại bằng mật khẩu mới.", zh: "修改后，你的所有会话都会退出。请用新密码重新登录。" },
  current: { vi: "Mật khẩu hiện tại", zh: "当前密码" },
  currentRequired: { vi: "Nhập mật khẩu hiện tại", zh: "请输入当前密码" },
  next: { vi: "Mật khẩu mới", zh: "新密码" },
  nextHint: { vi: "Ít nhất 12 ký tự, có chữ và số.", zh: "至少 12 个字符，包含字母和数字。" },
  nextRule: { vi: "Mật khẩu cần từ 12 ký tự, có chữ và số", zh: "密码至少 12 个字符，并且包含字母和数字" },
  different: { vi: "Mật khẩu mới phải khác mật khẩu hiện tại", zh: "新密码必须和当前密码不同" },
  again: { vi: "Nhập lại mật khẩu mới", zh: "再次输入新密码" },
  mismatch: { vi: "Mật khẩu nhập lại chưa khớp", zh: "两次输入的密码不一致" },
  offline: { vi: "Không kết nối được máy chủ", zh: "无法连接服务器" },
} satisfies Record<string, Phrase>;

export const LOGIN_TEXT = {
  username: { vi: "Tên đăng nhập", zh: "用户名" },
  password: { vi: "Mật khẩu", zh: "密码" },
  login: { vi: "Đăng nhập", zh: "登录" },
  usernameRequired: { vi: "Nhập tên đăng nhập", zh: "请输入用户名" },
  usernameRule: { vi: "Tên đăng nhập từ 3 đến 64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang", zh: "用户名为 3 到 64 个字符，可用字母、数字、点、下划线或短横线" },
  passwordRequired: { vi: "Nhập mật khẩu", zh: "请输入密码" },
  currentPassword: { vi: "Mật khẩu hiện tại", zh: "当前密码" },
  currentPasswordRequired: { vi: "Nhập mật khẩu hiện tại", zh: "请输入当前密码" },
  verifyHint: { vi: "Mã 6 số từ ứng dụng xác thực. Mã sống 5 phút.", zh: "验证器中的 6 位码。验证码 5 分钟内有效。" },
  setupHint: { vi: "Quản trị phải bật MFA. Nhập mật khẩu hiện tại rồi quét QR.", zh: "管理员必须开启双重验证。输入当前密码后扫描二维码。" },
  code: { vi: "Mã xác thực", zh: "验证码" },
  codeHelp: { vi: "Tải lại trang thì đăng nhập lại từ đầu.", zh: "刷新页面后需要重新登录。" },
  confirm: { vi: "Xác nhận", zh: "确认" },
  otherAccount: { vi: "Dùng tài khoản khác", zh: "使用其他账号" },
  setupIntro: { vi: "Tài khoản quản trị chưa bật MFA thì chưa vào được CMS. Nhập mật khẩu đang dùng để tạo mã.", zh: "管理员账号未开启双重验证时不能进入后台。输入正在使用的密码来生成验证码。" },
  createMfa: { vi: "Tạo mã MFA", zh: "生成验证码" },
  logout: { vi: "Đăng xuất", zh: "退出" },
  setupNote: { vi: "Quản trị cần mã này mỗi lần đăng nhập. Tạo mã mới thì mã QR hiện tại hết hạn.", zh: "管理员每次登录都需要这个码。生成新码后，当前二维码失效。" },
  qrAlt: { vi: "Mã QR để thêm tài khoản vào ứng dụng xác thực", zh: "用于把账号加入验证器的二维码" },
  copied: { vi: "Đã chép", zh: "已复制" },
  copy: { vi: "Chép chuỗi", zh: "复制密钥" },
  sixDigits: { vi: "Mã 6 số", zh: "6 位码" },
  manualCode: { vi: "Nếu không quét được, nhập chuỗi ở trên vào ứng dụng xác thực.", zh: "如果无法扫码，把上面的密钥输入验证器。" },
  enable: { vi: "Bật MFA và vào bàn", zh: "开启双重验证并进入" },
  newCode: { vi: "Tạo mã mới", zh: "生成新码" },
  staffOnly: { vi: "Chỉ dành cho nhân sự CSKH VIP.", zh: "仅供 CSKH VIP 工作人员使用。" },
  offline: { vi: "Không kết nối được máy chủ", zh: "无法连接服务器" },
} satisfies Record<string, Phrase>;

function readStored(): DeskLang {
  try {
    return localStorage.getItem(STORAGE) === "zh" ? "zh" : "vi";
  } catch {
    return "vi";
  }
}

function applyLang(next: DeskLang): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = next === "zh" ? "zh-CN" : "vi";
  }
}

applyLang(current);
