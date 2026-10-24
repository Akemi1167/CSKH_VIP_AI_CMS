import { AuditOutlined, ClockCircleOutlined, CommentOutlined, GlobalOutlined, IdcardOutlined, InboxOutlined, KeyOutlined, LeftOutlined, LogoutOutlined, MailOutlined, MessageOutlined, SearchOutlined, SendOutlined, SettingOutlined, ShopOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Space } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, probe, setCsrfToken } from "../api.ts";
import { roleName } from "../copy.ts";
import type { UserProfile } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { CampaignBoard } from "./CampaignBoard.tsx";
import { CustomerBoard } from "./CustomerBoard.tsx";
import { JournalBoard } from "./JournalBoard.tsx";
import { QueueBoard } from "./QueueBoard.tsx";
import { RateLimitBoard } from "./RateLimitBoard.tsx";
import { StationBoard } from "./StationBoard.tsx";
import { StationSmsBoard } from "./StationSmsBoard.tsx";
import { TelegramBoard } from "./TelegramBoard.tsx";
import { WorkBoard } from "./WorkBoard.tsx";
import { PasswordDialog } from "./PasswordDialog.tsx";
import { ScheduleBoard } from "./ScheduleBoard.tsx";
import { StaffBoard } from "./StaffBoard.tsx";

type DeskPage = "tasks" | "queue" | "schedule" | "staff" | "customers" | "campaigns" | "journal" | "stations" | "stationSms" | "rateLimit" | "telegram";

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
  const [page, setPage] = useState<DeskPage>(canReadStaff ? "staff" : canReadTasks ? "tasks" : canReadCampaigns ? "campaigns" : "schedule");
  const [panelBranchId, setPanelBranchId] = useState<string | null>(null);
  const onScheduleDirty = useCallback((dirty: boolean) => setScheduleDirty(dirty), []);
  const menus = useMemo(() => {
    const operate: NavNode[] = [];
    if (canReadTasks) {
      operate.push({ kind: "leaf", id: "tasks", label: "Việc của tôi", icon: <MessageOutlined /> });
    }
    if (canReadQueue) {
      operate.push({ kind: "leaf", id: "queue", label: "Hàng chờ", icon: <InboxOutlined /> });
    }
    operate.push({ kind: "leaf", id: "schedule", label: "Ca làm", icon: <ClockCircleOutlined /> });
    if (canReadStaff) {
      operate.push({ kind: "leaf", id: "staff", label: "Nhân sự", icon: <TeamOutlined /> });
    }
    if (canReadCustomers) {
      operate.push({ kind: "leaf", id: "customers", label: "Hội viên", icon: <IdcardOutlined /> });
    }
    if (canReadCampaigns) {
      operate.push({ kind: "leaf", id: "campaigns", label: "Chiến dịch", icon: <MailOutlined /> });
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
    }
    if (canManageTelegram) {
      settings.push({ kind: "leaf", id: "telegram", label: "Telegram", icon: <SendOutlined /> });
    }
    const sections: MenuSection[] = [{ id: "operate", label: "Vận hành", items: operate }];
    if (settings.length > 0) {
      sections.push({
        id: "settings",
        label: "Cài đặt",
        items: [{ kind: "branch", id: "settings", label: "Cài đặt", panelTitle: "Cài đặt hệ thống", icon: <SettingOutlined />, groups: [{ label: "Hệ thống", items: settings }] }],
      });
    }
    if (canReadAudit) {
      sections.push({ id: "other", label: "Khác", items: [{ kind: "leaf", id: "journal", label: "Nhật ký", icon: <AuditOutlined /> }] });
    }
    const query = keyword.trim().toLocaleLowerCase("vi");
    return { sections: filterSections(sections, query), query };
  }, [canManageTelegram, canReadAudit, canReadCampaigns, canReadCustomers, canReadQueue, canReadSettings, canReadStaff, canReadTasks, keyword]);

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
            <MenuGroup key={section.id} title={section.label} items={section.items} page={page} panelId={panel?.id ?? null} onLeaf={openLeaf} onBranch={openBranch} />
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <div className="sidebar-user">
            <div className="sidebar-user__avatar">{initial}</div>
            <div className="sidebar-user__meta">
              <p className="sidebar-user__name">{profile.display_name}</p>
              <p className="sidebar-user__role">{roleLine || profile.username}</p>
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
          {page === "tasks" && canReadTasks ? (
            <WorkBoard
              canUpdate={canUpdateTasks}
              canCancel={canAssign}
              canTransfer={canTransfer}
              canListStaff={canReadStaff}
              selfId={profile.id}
              onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")}
              onMfaSetup={props.onMfaSetup}
            />
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
          {page === "customers" && canReadCustomers ? (
            <CustomerBoard canImport={canImportCustomers} canRevoke={canRevokeCare} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
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
          {page === "journal" && canReadAudit ? (
            <JournalBoard canListStaff={canReadStaff} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "stations" && canReadSettings ? (
            <StationBoard canWrite={canWriteSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "stationSms" && canReadCampaigns ? (
            <StationSmsBoard canWrite={canCreateCampaigns} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
          ) : null}
          {page === "rateLimit" && canReadSettings ? (
            <RateLimitBoard canWrite={canWriteSettings} onUnauthorized={() => props.onLoggedOut("Phiên đã hết. Đăng nhập lại.")} onMfaSetup={props.onMfaSetup} />
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

function MenuGroup(props: { title: string; items: NavNode[]; page: DeskPage; panelId: string | null; onLeaf: (page: DeskPage) => void; onBranch: (branch: NavBranch) => void }) {
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
              <NavButton active={props.page === item.id} icon={item.icon} label={item.label} onClick={() => props.onLeaf(item.id)} />
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

function NavButton(props: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={props.active ? "nav-link nav-link--active" : "nav-link"} type="button" onClick={props.onClick}>
      <span className="nav-link__icon">{props.icon}</span>
      <span className="nav-link__text">{props.label}</span>
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
