import { AppstoreOutlined, AuditOutlined, BarChartOutlined, BookOutlined, CheckSquareOutlined, ClockCircleOutlined, CommentOutlined, FundOutlined, GiftOutlined, GlobalOutlined, HistoryOutlined, KeyOutlined, LeftOutlined, LogoutOutlined, MailOutlined, MessageOutlined, PhoneOutlined, SearchOutlined, SendOutlined, SettingOutlined, ShareAltOutlined, ShopOutlined, TeamOutlined, UnorderedListOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Space, Switch } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, probe, setCsrfToken } from "../api.ts";
import { roleName } from "../copy.ts";
import type { UserProfile } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { CampaignBoard } from "./CampaignBoard.tsx";
import { CareHistoryBoard, CareHome, ContactBoard, PersonalReportBoard } from "./CareDesk.tsx";
import { CustomerBoard } from "./CustomerBoard.tsx";
import { EmbedBoard } from "./EmbedBoard.tsx";
import { DataBoard } from "./DataBoard.tsx";
import { JournalBoard } from "./JournalBoard.tsx";
import { QueueBoard } from "./QueueBoard.tsx";
import { RateLimitBoard } from "./RateLimitBoard.tsx";
import { RewardBoard } from "./RewardBoard.tsx";
import { ShiftBoard } from "./ShiftBoard.tsx";
import { StationBoard } from "./StationBoard.tsx";
import { StationSmsBoard } from "./StationSmsBoard.tsx";
import { TelegramBoard } from "./TelegramBoard.tsx";
import { WorkBoard } from "./WorkBoard.tsx";
import { PasswordDialog } from "./PasswordDialog.tsx";
import { ScheduleBoard } from "./ScheduleBoard.tsx";
import { StaffBoard } from "./StaffBoard.tsx";
import { armAlertSound, askChatNotification, startInboxWatch, stopInboxWatch, useInboxUnread } from "./inboxWatch.ts";

type DeskPage = "overview" | "inbox" | "contacts" | "tasks" | "history" | "personal" | "queue" | "schedule" | "staff" | "customers" | "warehouse" | "distribute" | "campaigns" | "shift" | "rewards" | "journal" | "stations" | "stationSms" | "rateLimit" | "embed" | "telegram";

type NavLeaf = { kind: "leaf"; id: DeskPage; label: string; icon: ReactNode };
type NavGroup = { label?: string; items: NavLeaf[] };
type NavBranch = { kind: "branch"; id: string; label: string; panelTitle: string; icon: ReactNode; groups: NavGroup[] };
type NavNode = NavLeaf | NavBranch;
type MenuSection = { id: string; label: string; items: NavNode[] };

type Health = "ok" | "degraded" | "offline";

export function Desk(props: {
  user: UserProfile;
  onLoggedOut: (notice?: string) => void;
  onMfaSetup: () => void;
}) {
  const [profile, setProfile] = useState(props.user);
  const [health, setHealth] = useState<Health>("ok");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [keyword, setKeyword] = useState("");
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [pendingPage, setPendingPage] = useState<DeskPage | null>(null);
  const canReadStaff = profile.permissions.includes("staff:read");
  const canWriteStaff = profile.permissions.includes("staff:write");
  const canReadSchedule = profile.permissions.includes("schedule:read");
  const canWriteSchedule = profile.permissions.includes("schedule:write");
  const canReadCustomers = profile.permissions.includes("customers:read");
  const canImportCustomers = profile.permissions.includes("customers:import");
  const canReadAudit = profile.permissions.includes("audit:read");
  const canReadSettings = profile.permissions.includes("settings:read");
  const canWriteSettings = profile.permissions.includes("settings:write");
  const canManageTelegram = profile.permissions.includes("telegram:manage");
  const canReadTasks = profile.permissions.includes("tasks:read_own");
  const canReadAllTasks = profile.permissions.includes("tasks:read");
  const canUpdateTasks = profile.permissions.includes("tasks:update_own");
  const canReadQueue = profile.permissions.includes("queues:read");
  const canAssign = profile.permissions.includes("tasks:assign");
  const canTransfer = profile.permissions.includes("tasks:transfer") && profile.permissions.includes("tasks:read");
  const canRevokeCare = profile.permissions.includes("care:revoke");
  const canReadCampaigns = profile.permissions.includes("campaigns:read");
  const canCreateCampaigns = profile.permissions.includes("campaigns:create");
  const canValidateCampaigns = profile.permissions.includes("campaigns:validate");
  const canLaunchCampaigns = profile.permissions.includes("campaigns:launch");
  const canManageCampaigns = profile.permissions.includes("campaigns:manage");
  const canReportCampaigns = profile.permissions.includes("campaigns:report");
  const canApproveRewards = profile.permissions.includes("rewards:approve");
  const [accepting, setAccepting] = useState(profile.accepting_work);
  const [acceptingBusy, setAcceptingBusy] = useState(false);
  const [page, setPage] = useState<DeskPage>("overview");
  const [panelBranchId, setPanelBranchId] = useState<string | null>(null);
  const unread = useInboxUnread();
  const onScheduleDirty = useCallback((dirty: boolean) => setScheduleDirty(dirty), []);
  useEffect(() => {
    if (!canReadTasks) {
      return;
    }
    startInboxWatch(canReadAllTasks ? "staff" : "own");
    const arm = () => armAlertSound();
    const openInbox = () => setPage("inbox");
    window.addEventListener("pointerdown", arm);
    window.addEventListener("cskh-open-inbox", openInbox);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("cskh-open-inbox", openInbox);
      stopInboxWatch();
    };
  }, [canReadAllTasks, canReadTasks]);
  const menus = useMemo(() => {
    const care: NavLeaf[] = [{ kind: "leaf", id: "overview", label: "Tổng quan", icon: <AppstoreOutlined /> }];
    if (canReadCustomers) {
      care.push({ kind: "leaf", id: "customers", label: "Hội viên VIP", icon: <UserOutlined /> });
    }
    if (canReadTasks) {
      care.push({ kind: "leaf", id: "inbox", label: "Hộp thư hỗ trợ", icon: <MailOutlined /> });
      care.push({ kind: "leaf", id: "contacts", label: "Cuộc gọi & liên hệ", icon: <PhoneOutlined /> });
      care.push({ kind: "leaf", id: "tasks", label: "Nhiệm vụ", icon: <CheckSquareOutlined /> });
    }
    if (canReadCustomers || canReadTasks) {
      care.push({ kind: "leaf", id: "history", label: "Lịch sử chăm sóc", icon: <HistoryOutlined /> });
      care.push({ kind: "leaf", id: "personal", label: "Báo cáo cá nhân", icon: <BarChartOutlined /> });
    }
    const settings: NavLeaf[] = [];
    if (canReadSettings) {
      settings.push({ kind: "leaf", id: "stations", label: "Hậu đài", icon: <ShopOutlined /> });
    }
    if (canReadCampaigns) {
      settings.push({ kind: "leaf", id: "stationSms", label: "Tin nhắn", icon: <CommentOutlined /> });
    }
    if (canReadSettings) {
      settings.push({ kind: "leaf", id: "rateLimit", label: "Không chặn IP", icon: <GlobalOutlined /> });
      settings.push({ kind: "leaf", id: "embed", label: "Chat nhúng", icon: <MessageOutlined /> });
    }
    if (canManageTelegram) {
      settings.push({ kind: "leaf", id: "telegram", label: "Telegram", icon: <SendOutlined /> });
    }
    const extras: NavLeaf[] = [{ kind: "leaf", id: "schedule", label: "Ca làm", icon: <ClockCircleOutlined /> }];
    if (canReadCampaigns) {
      extras.push({ kind: "leaf", id: "campaigns", label: "Chiến dịch", icon: <MailOutlined /> });
    }
    if (canReportCampaigns) {
      extras.push({ kind: "leaf", id: "shift", label: "Báo cáo ca", icon: <FundOutlined /> });
    }
    if (canApproveRewards) {
      extras.push({ kind: "leaf", id: "rewards", label: "Thưởng", icon: <GiftOutlined /> });
    }
    const settingsGroups: NavGroup[] = [];
    if (settings.length > 0) {
      settingsGroups.push({ label: "Hệ thống", items: settings });
    }
    settingsGroups.push({ label: "Khác", items: extras });
    const sections: MenuSection[] = [
      { id: "operate", label: "Chăm sóc hội viên", items: care },
      {
        id: "settings",
        label: "Cài đặt",
        items: [{ kind: "branch", id: "settings", label: "Cài đặt", panelTitle: "Cài đặt hệ thống", icon: <SettingOutlined />, groups: settingsGroups }],
      },
    ];
    const central: NavLeaf[] = [];
    if (canReadCustomers) {
      central.push({ kind: "leaf", id: "warehouse", label: "Kho Data tập trung", icon: <BookOutlined /> });
      central.push({ kind: "leaf", id: "distribute", label: "Phân bổ Data", icon: <ShareAltOutlined /> });
    }
    if (canReadStaff) {
      central.push({ kind: "leaf", id: "staff", label: "Quản lý nhân viên", icon: <TeamOutlined /> });
    }
    if (canReadQueue) {
      central.push({ kind: "leaf", id: "queue", label: "Điều phối Ticket", icon: <UnorderedListOutlined /> });
    }
    if (central.length > 0) {
      sections.push({ id: "central", label: "Quản lý tập trung", items: central });
    }
    if (canReadAudit) {
      sections.push({ id: "other", label: "Khác", items: [{ kind: "leaf", id: "journal", label: "Nhật ký", icon: <AuditOutlined /> }] });
    }
    const query = keyword.trim().toLocaleLowerCase("vi");
    return { sections: filterSections(sections, query), query };
  }, [canApproveRewards, canManageTelegram, canReadAudit, canReadCampaigns, canReadCustomers, canReadQueue, canReadSettings, canReadStaff, canReadTasks, canReportCampaigns, keyword]);

  function openPage(next: DeskPage) {
    if (next === page) {
      return;
    }
    if (page === "schedule" && scheduleDirty) {
      setPendingPage(next);
      return;
    }
    setPage(next);
  }

  function openLeaf(next: DeskPage) {
    if (next === "inbox") {
      askChatNotification();
      armAlertSound();
    }
    setPanelBranchId(null);
    openPage(next);
  }

  function openBranch(branch: NavBranch) {
    setPanelBranchId(branch.id);
    const pages = branch.groups.flatMap((group) => group.items);
    if (!pages.some((child) => child.id === page)) {
      const first = pages[0];
      if (first) {
        openPage(first.id);
      }
    }
  }

  const panel = findBranch(
    menus.sections.flatMap((section) => section.items),
    panelBranchId,
  );

  const healthText = health === "ok" ? "Hệ thống sẵn sàng" : health === "degraded" ? "API sống, dữ liệu chưa sẵn" : "Mất kết nối API";
  const initial = (profile.display_name || profile.username || "C").charAt(0).toUpperCase();
  const roleLine = useMemo(() => profile.roles.map((code) => roleName(code)).join(", "), [profile.roles]);

  useEffect(() => {
    let timer = 0;
    let ignore = false;
    async function check() {
      const [live, ready] = await Promise.all([probe("/health"), probe("/ready")]);
      if (ignore) {
        return;
      }
      if (live === "offline") {
        setHealth("offline");
      } else if (ready !== "ok") {
        setHealth("degraded");
      } else {
        setHealth("ok");
      }
    }
    void check();
    timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void check();
      }
    }, 20000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  async function setAvailability(next: boolean) {
    setAcceptingBusy(true);
    setError(null);
    try {
      const saved = await api<{ accepting_work: boolean }>("/api/v1/staff/availability", { method: "PUT", body: { accepting_work: next } });
      setAccepting(saved.accepting_work);
      setProfile((current) => ({ ...current, accepting_work: saved.accepting_work }));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đổi được trạng thái nhận việc", "");
      if (problem.status === 401) {
        props.onLoggedOut("Phiên đã hết. Đăng nhập lại.");
        return;
      }
      if (problem.code === "mfa_setup_required") {
        props.onMfaSetup();
        return;
      }
      setError(problem);
    } finally {
      setAcceptingBusy(false);
    }
  }

  async function logout() {
    setLeaving(true);
    setError(null);
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
      setCsrfToken("");
      props.onLoggedOut();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      if (apiError?.status === 401) {
        props.onLoggedOut();
        return;
      }
      setError(apiError ?? new ApiError(0, "network", "Không đăng xuất được", ""));
      setLeaving(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <strong className="brand-word">CSKH VIP</strong>
          <p>Bảng điều khiển</p>
          <p className="system-line">
            <span className={health === "ok" ? "system-dot" : `system-dot system-dot--${health}`} aria-hidden="true" />
            {healthText}
          </p>
        </div>
        <div className="app-sidebar__search">
          <Input allowClear size="small" placeholder="Tìm menu" prefix={<SearchOutlined />} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        </div>
        <nav className="app-sidebar__nav">
          {menus.sections.map((section) => (
            <MenuGroup key={section.id} title={section.label} items={section.items} page={page} panelId={panel?.id ?? null} unread={section.id === "operate" ? unread.count : 0} onLeaf={openLeaf} onBranch={openBranch} />
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <div className="sidebar-user">
            <div className="sidebar-user__avatar">{initial}</div>
            <div className="sidebar-user__meta">
              <p className="sidebar-user__name">{profile.display_name}</p>
              <p className="sidebar-user__role">{roleLine || profile.username}</p>
              <p className="sidebar-user__role">
                <Switch size="small" checked={accepting} loading={acceptingBusy} onChange={(checked) => void setAvailability(checked)} /> Nhận việc
              </p>
            </div>
            <button type="button" className="sidebar-user__logout" title="Đổi mật khẩu" onClick={() => setPasswordOpen(true)}>
              <KeyOutlined />
            </button>
            <button type="button" className="sidebar-user__logout" title="Đăng xuất" disabled={leaving} onClick={() => void logout()}>
              <LogoutOutlined />
            </button>
          </div>
          <p className="sidebar-copy">© {new Date().getFullYear()} CSKH VIP CMS</p>
        </div>
      </aside>
      {panel ? <SubPanel branch={panel} page={page} onOpen={openPage} onClose={() => setPanelBranchId(null)} /> : null}
      <main className="app-main bg-grid">
        <div className="app-main__inner">
          <ErrorAlert error={error} />
          {page === "overview" ? (
            <CareHome canReadTasks={canReadTasks} canReport={canReadCustomers || canReadTasks} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "inbox" && canReadTasks ? (
            <WorkBoard
              heading="Hộp thư hỗ trợ"
              lead={canReadAllTasks ? "Chọn hội thoại bên trái và gửi tin. Tin web đi qua socket, tin Telegram tới máy khách." : "Hội thoại đang giao cho bạn. Tin khách web tới ngay trên khung chat."}
              layout="chat"
              scope={canReadAllTasks ? "staff" : "own"}
              canUpdate={canUpdateTasks}
              canCancel={canAssign}
              canTransfer={canTransfer}
              canListStaff={canReadStaff}
              selfId={profile.id}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
            />
          ) : null}
          {page === "contacts" && canReadTasks ? (
            <ContactBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "tasks" && canReadTasks ? (
            <WorkBoard
              heading="Nhiệm vụ"
              lead="Việc đang giao. Bấm một dòng để cập nhật trạng thái hoặc chuyển người."
              canUpdate={canUpdateTasks}
              canCancel={canAssign}
              canTransfer={canTransfer}
              canListStaff={canReadStaff}
              selfId={profile.id}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
            />
          ) : null}
          {page === "history" && (canReadCustomers || canReadTasks) ? (
            <CareHistoryBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "personal" && (canReadCustomers || canReadTasks) ? (
            <PersonalReportBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "queue" && canReadQueue ? (
            <QueueBoard canAssign={canAssign} canListStaff={canReadStaff} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "staff" && canReadStaff ? (
            <StaffBoard
              me={profile}
              canWrite={canWriteStaff}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
              onSessionEnded={(notice) => props.onLoggedOut(notice)}
              onSelfUpdated={setProfile}
            />
          ) : null}
          {page === "schedule" || (page === "staff" && !canReadStaff) ? (
            <ScheduleBoard
              canAdmin={canReadSchedule}
              canWrite={canWriteSchedule}
              canListStaff={canReadStaff}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
              onDirtyChange={onScheduleDirty}
            />
          ) : null}
          {page === "warehouse" && canReadCustomers ? (
            <DataBoard mode="warehouse" canWrite={false} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "distribute" && canReadCustomers ? (
            <DataBoard mode="assign" canWrite={canImportCustomers && canReadSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "customers" && canReadCustomers ? (
            <CustomerBoard canImport={canImportCustomers} canRevoke={canRevokeCare} canAssignOwner={canImportCustomers && canReadSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "campaigns" && canReadCampaigns ? (
            <CampaignBoard
              canCreate={canCreateCampaigns}
              canValidate={canValidateCampaigns}
              canLaunch={canLaunchCampaigns}
              canManage={canManageCampaigns}
              canReport={canReportCampaigns}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
            />
          ) : null}
          {page === "shift" && canReportCampaigns ? <ShiftBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} /> : null}
          {page === "rewards" && canApproveRewards ? (
            <RewardBoard canReadCustomers={canReadCustomers} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "journal" && canReadAudit ? (
            <JournalBoard canListStaff={canReadStaff} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "stations" && canReadSettings ? (
            <StationBoard canWrite={canWriteSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "stationSms" && canReadCampaigns ? (
            <StationSmsBoard canWrite={canCreateCampaigns} canTest={canLaunchCampaigns} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "rateLimit" && canReadSettings ? (
            <RateLimitBoard canWrite={canWriteSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "embed" && canReadSettings ? (
            <EmbedBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "telegram" && canManageTelegram ? (
            <TelegramBoard onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
        </div>
      </main>
      <Modal
        title="Ca chưa lưu"
        open={pendingPage !== null}
        onCancel={() => setPendingPage(null)}
        footer={
          <Space>
            <Button onClick={() => setPendingPage(null)}>Ở lại</Button>
            <Button
              danger
              onClick={() => {
                if (pendingPage) {
                  setPage(pendingPage);
                }
                setScheduleDirty(false);
                setPendingPage(null);
              }}
            >
              Bỏ ca đang sửa
            </Button>
          </Space>
        }
      >
        Giờ bạn vừa chọn chưa được lưu.
      </Modal>
      {passwordOpen ? <PasswordDialog onClose={() => setPasswordOpen(false)} onChanged={() => props.onLoggedOut("Đã đổi mật khẩu. Đăng nhập lại.")} /> : null}
    </div>
  );
}

function MenuGroup(props: { title: string; items: NavNode[]; page: DeskPage; panelId: string | null; unread: number; onLeaf: (page: DeskPage) => void; onBranch: (branch: NavBranch) => void }) {
  if (props.items.length === 0) {
    return null;
  }
  return (
    <div className="nav-group">
      <p className="nav-group__title">{props.title}</p>
      <ul>
        {props.items.map((item) =>
          item.kind === "leaf" ? (
            <li key={item.id}>
              <NavButton active={props.page === item.id} icon={item.icon} label={item.label} badge={item.id === "inbox" ? props.unread : 0} onClick={() => props.onLeaf(item.id)} />
            </li>
          ) : (
            <li key={item.id}>
              <NavButton active={props.panelId === item.id || containsPage([item], props.page)} icon={item.icon} label={item.label} onClick={() => props.onBranch(item)} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function SubPanel(props: { branch: NavBranch; page: DeskPage; onOpen: (page: DeskPage) => void; onClose: () => void }) {
  return (
    <aside className="nav-panel">
      <div className="nav-panel__head">
        <p className="nav-panel__title">{props.branch.panelTitle}</p>
        <button type="button" className="nav-panel__close" title="Thu gọn" onClick={props.onClose}>
          <LeftOutlined />
        </button>
      </div>
      <nav className="nav-panel__nav">
        {props.branch.groups.map((group) => (
          <div key={group.label ?? "items"} className="nav-group">
            {group.label ? <p className="nav-group__title">{group.label}</p> : null}
            <ul>
              {group.items.map((child) => (
                <li key={child.id}>
                  <NavButton active={props.page === child.id} icon={child.icon} label={child.label} onClick={() => props.onOpen(child.id)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function NavButton(props: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) {
  return (
    <button className={props.active ? "nav-link nav-link--active" : "nav-link"} type="button" onClick={props.onClick}>
      <span className="nav-link__icon">{props.icon}</span>
      <span className="nav-link__text">{props.label}</span>
      {props.badge ? <span className="nav-link__badge">{props.badge > 9 ? "9+" : props.badge}</span> : null}
    </button>
  );
}

function findBranch(items: NavNode[], id: string | null): NavBranch | null {
  if (!id) {
    return null;
  }
  const hit = items.find((item) => item.kind === "branch" && item.id === id);
  return hit && hit.kind === "branch" ? hit : null;
}

function containsPage(items: NavNode[], page: DeskPage): boolean {
  return items.some((item) => (item.kind === "leaf" ? item.id === page : item.groups.some((group) => group.items.some((child) => child.id === page))));
}

function filterSections(sections: MenuSection[], query: string): MenuSection[] {
  if (!query) {
    return sections;
  }
  const matched: MenuSection[] = [];
  for (const section of sections) {
    if (section.label.toLocaleLowerCase("vi").includes(query)) {
      matched.push(section);
      continue;
    }
    const items = filterNav(section.items, query);
    if (items.length > 0) {
      matched.push({ ...section, items });
    }
  }
  return matched;
}

function filterNav(items: NavNode[], query: string): NavNode[] {
  const matched: NavNode[] = [];
  for (const item of items) {
    if (item.kind === "leaf") {
      if (item.label.toLocaleLowerCase("vi").includes(query)) {
        matched.push(item);
      }
      continue;
    }
    if (item.label.toLocaleLowerCase("vi").includes(query) || item.panelTitle.toLocaleLowerCase("vi").includes(query)) {
      matched.push(item);
      continue;
    }
    const groups = item.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((child) => child.label.toLocaleLowerCase("vi").includes(query) || (group.label ?? "").toLocaleLowerCase("vi").includes(query)),
      }))
      .filter((group) => group.items.length > 0);
    if (groups.length > 0) {
      matched.push({ ...item, groups });
    }
  }
  return matched;
}
