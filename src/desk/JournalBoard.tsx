import { ReloadOutlined } from "@ant-design/icons";
import { Button, Segmented, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { careLabelName, formatStamp } from "../copy.ts";
import type { AuditEvent, Page, Staff, SystemLog } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type Kind = "audit" | "system";

export function JournalBoard(props: { canListStaff: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [kind, setKind] = useState<Kind>("audit");
  const [actorId, setActorId] = useState<string | undefined>(undefined);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<"all" | "success" | "failure">("all");
  const [level, setLevel] = useState<"all" | "info" | "error">("all");
  const [eventName, setEventName] = useState("");
  const [applied, setApplied] = useState({ kind: "audit" as Kind, actorId: "", action: "", outcome: "all", level: "all", eventName: "" });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const failAuth = useCallback(
    (caught: ApiError) => {
      if (caught.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (caught.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props],
  );

  useEffect(() => {
    if (!props.canListStaff) {
      return;
    }
    let ignore = false;
    api<{ items: Staff[] }>("/api/v1/admin/staff")
      .then((result) => {
        if (!ignore) {
          setStaff(result.items);
        }
      })
      .catch(() => {
        if (!ignore) {
          setStaff([]);
        }
      });
    return () => {
      ignore = true;
    };
  }, [props.canListStaff]);

  const load = useCallback(
    async (nextCursor?: string) => {
      const params = new URLSearchParams();
      if (nextCursor) {
        params.set("cursor", nextCursor);
      }
      if (applied.kind === "audit") {
        if (applied.actorId) {
          params.set("actor_id", applied.actorId);
        }
        if (applied.action.trim()) {
          params.set("action", applied.action.trim());
        }
        if (applied.outcome !== "all") {
          params.set("outcome", applied.outcome);
        }
        const query = params.toString();
        const result = await api<Page<AuditEvent>>(`/api/v1/admin/audit-events${query ? `?${query}` : ""}`);
        setAudit((current) => (nextCursor ? [...current, ...result.items] : result.items));
        setCursor(result.next_cursor);
      } else {
        if (applied.level !== "all") {
          params.set("level", applied.level);
        }
        if (applied.eventName.trim()) {
          params.set("event", applied.eventName.trim());
        }
        const query = params.toString();
        const result = await api<Page<SystemLog>>(`/api/v1/admin/system-logs${query ? `?${query}` : ""}`);
        setLogs((current) => (nextCursor ? [...current, ...result.items] : result.items));
        setCursor(result.next_cursor);
      }
      setError(null);
    },
    [applied],
  );

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được nhật ký", "");
        if (!failAuth(problem)) {
          setError(problem);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [failAuth, load]);

  function apply(nextKind = kind) {
    setApplied({
      kind: nextKind,
      actorId: actorId ?? "",
      action,
      outcome,
      level,
      eventName,
    });
  }

  async function more() {
    if (!cursor) {
      return;
    }
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được trang sau", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const names = new Map(staff.map((person) => [person.id, person.display_name || person.username]));
  const namesByUsername = new Map(staff.map((person) => [person.username, person.display_name || person.username]));

  const auditColumns: TableColumnsType<AuditEvent> = [
    { title: "Thời điểm", dataIndex: "created_at", width: 170, render: (value: string) => formatStamp(value) },
    {
      title: "Người",
      width: 160,
      ellipsis: true,
      render: (_, row) => (row.actor_username ? (namesByUsername.get(row.actor_username) ?? row.actor_username) : "Hệ thống"),
    },
    {
      title: "Việc đã làm",
      render: (_, row) => (
        <span>
          {row.outcome === "failure" ? <Tag color="red">Không xong</Tag> : null}
          {describeAudit(row, names)}
        </span>
      ),
    },
  ];

  const logColumns: TableColumnsType<SystemLog> = [
    { title: "Thời điểm", dataIndex: "created_at", width: 170, render: (value: string) => formatStamp(value) },
    {
      title: "Mức",
      dataIndex: "level",
      width: 110,
      render: (value: string) => <Tag color={value === "error" ? "red" : "blue"}>{value === "error" ? "Lỗi" : "Thông tin"}</Tag>,
    },
    { title: "Việc đã xảy ra", render: (_, row) => describeLog(row) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Nhật ký
          </Typography.Title>
          <Typography.Text type="secondary">Mỗi dòng là một việc vừa xảy ra. Không có mật khẩu hay nội dung tin nhắn.</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
        <Segmented
          value={kind}
          options={[
            { label: "Hành động", value: "audit" },
            { label: "Log hệ thống", value: "system" },
          ]}
          onChange={(value) => {
            const next = value as Kind;
            setKind(next);
            setApplied((current) => ({ ...current, kind: next }));
          }}
        />
        {kind === "audit" ? (
          <>
            {props.canListStaff ? (
              <Select
                allowClear
                showSearch
                placeholder="Người thực hiện"
                style={{ width: 220 }}
                value={actorId}
                optionFilterProp="label"
                options={staff.map((person) => ({ value: person.id, label: `${person.display_name} (${person.username})` }))}
                onChange={(value) => setActorId(value)}
              />
            ) : null}
            <Select
              allowClear
              placeholder="Mọi việc"
              style={{ width: 220 }}
              value={action || undefined}
              options={AUDIT_FILTERS}
              onChange={(value) => setAction(value ?? "")}
            />
            <Select
              value={outcome}
              style={{ width: 150 }}
              options={[
                { value: "all", label: "Mọi kết quả" },
                { value: "success", label: "Thành công" },
                { value: "failure", label: "Thất bại" },
              ]}
              onChange={(value: "all" | "success" | "failure") => setOutcome(value)}
            />
          </>
        ) : (
          <>
            <Select
              value={level}
              style={{ width: 150 }}
              options={[
                { value: "all", label: "Mọi mức" },
                { value: "info", label: "Thông tin" },
                { value: "error", label: "Lỗi" },
              ]}
              onChange={(value: "all" | "info" | "error") => setLevel(value)}
            />
            <Select
              allowClear
              placeholder="Mọi việc"
              style={{ width: 220 }}
              value={eventName || undefined}
              options={LOG_FILTERS}
              onChange={(value) => setEventName(value ?? "")}
            />
          </>
        )}
        <Button type="primary" onClick={() => apply()}>
          Lọc
        </Button>
        <Button icon={<ReloadOutlined />} aria-label="Tải lại" onClick={() => setApplied((current) => ({ ...current }))} />
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {applied.kind === "audit" ? (
        <Table<AuditEvent>
          className="staff-table"
          rowKey="id"
          size="middle"
          loading={loading}
          columns={auditColumns}
          dataSource={audit}
          pagination={false}
          locale={{ emptyText: loading ? " " : "Chưa có hành động." }}
        />
      ) : (
        <Table<SystemLog>
          className="staff-table"
          rowKey="id"
          size="middle"
          loading={loading}
          columns={logColumns}
          dataSource={logs}
          pagination={false}
          locale={{ emptyText: loading ? " " : "Chưa có log." }}
        />
      )}
      {cursor ? (
        <Button style={{ marginTop: 12 }} loading={loadingMore} onClick={() => void more()}>
          Xem thêm
        </Button>
      ) : null}
    </section>
  );
}

const AUDIT_FILTERS = [
  { value: "auth.login", label: "Đăng nhập" },
  { value: "auth.logout", label: "Đăng xuất" },
  { value: "auth.password_change", label: "Đổi mật khẩu" },
  { value: "auth.mfa_setup", label: "Bắt đầu bật MFA" },
  { value: "auth.mfa_confirm", label: "Bật MFA" },
  { value: "auth.mfa_verify", label: "Nhập mã MFA" },
  { value: "staff.create", label: "Tạo nhân viên" },
  { value: "staff.update", label: "Sửa nhân viên" },
  { value: "schedule.save", label: "Đặt giờ ca" },
  { value: "schedule.leave", label: "Ghi nghỉ" },
  { value: "schedule.leave_delete", label: "Xóa nghỉ" },
  { value: "customers.create", label: "Thêm hội viên" },
  { value: "customers.import", label: "Nhập hội viên" },
  { value: "task.update", label: "Đổi trạng thái task" },
  { value: "task.reply", label: "Trả lời task" },
  { value: "task.assign", label: "Giao task" },
  { value: "task.transfer", label: "Chuyển task" },
  { value: "customers.care", label: "Gắn nhãn chăm sóc" },
  { value: "customers.consent", label: "Ghi đồng ý nhận tin" },
  { value: "campaign.create", label: "Tạo chiến dịch" },
  { value: "campaign.launch", label: "Chạy chiến dịch" },
  { value: "campaign.pause", label: "Tạm dừng chiến dịch" },
  { value: "campaign.resume", label: "Chạy tiếp chiến dịch" },
  { value: "stations.create", label: "Thêm hậu đài" },
  { value: "stations.update", label: "Bật hoặc tắt hậu đài" },
  { value: "stations.assign", label: "Gắn nhân viên hậu đài" },
  { value: "stations.lead", label: "Gắn tổ trưởng hậu đài" },
  { value: "staff.availability", label: "Bật hoặc tắt nhận việc" },
  { value: "customers.owner", label: "Gán người giữ hội viên" },
  { value: "customers.pool", label: "Chuyển kho chăm sóc" },
  { value: "rewards.approve", label: "Duyệt thưởng" },
  { value: "rewards.revoke", label: "Gỡ duyệt thưởng" },
  { value: "stations.sms", label: "Sửa mẫu tin theo đài" },
  { value: "settings.rate_limit", label: "Cập nhật IP không bị chặn" },
  { value: "telegram.configure", label: "Cấu hình bot Telegram" },
];

const LOG_FILTERS = [
  { value: "dispatch.completed", label: "Giao task" },
  { value: "http.server_error", label: "Lỗi máy chủ" },
];

const ACTION_LABELS: Record<string, string> = Object.fromEntries(AUDIT_FILTERS.map((item) => [item.value, item.label]));

function describeAudit(row: AuditEvent, names: Map<string, string>): string {
  const summary = row.summary;
  const person = text(summary.user_id) ? (names.get(text(summary.user_id)) ?? "một nhân viên") : "";
  const kind = summary.kind === "absence" ? "nghỉ đột xuất" : summary.kind === "leave" ? "nghỉ phép" : "";
  if (row.action === "schedule.leave") {
    const released = numberOf(summary.released_task_count);
    const returned = released > 0 ? ` Đã trả ${released} hội thoại về hàng chờ.` : "";
    return `Ghi ${kind || "nghỉ"} cho ${person || "một nhân viên"}.${returned}`;
  }
  if (row.action === "schedule.leave_delete") {
    return `Xóa ${kind || "một khoảng nghỉ"} của ${person || "một nhân viên"}.`;
  }
  if (row.action === "schedule.save") {
    const start = text(summary.start_local).slice(0, 5);
    const end = text(summary.end_local).slice(0, 5);
    return start && end ? `Đặt ca team ${start}–${end}.` : "Đặt giờ ca của team.";
  }
  if (row.action === "staff.create") {
    const username = text(summary.username);
    return username ? `Tạo nhân viên ${username}.` : "Tạo nhân viên.";
  }
  if (row.action === "staff.update") {
    const changes: string[] = [];
    if (summary.status === "disabled") {
      changes.push("khóa tài khoản");
    } else if (summary.status === "active") {
      changes.push("mở lại tài khoản");
    }
    if (Array.isArray(summary.roles)) {
      changes.push("đổi vai trò");
    }
    if (summary.password_reset === true) {
      changes.push("đổi mật khẩu");
    }
    const name = text(summary.username);
    const who = name ? ` ${name}` : "";
    const detail = changes.length > 0 ? `: ${changes.join(", ")}` : "";
    return `Sửa hồ sơ${who}${detail}.`;
  }
  if (row.action === "customers.create") {
    const account = text(summary.game_account);
    const site = text(summary.site);
    if (account && site) {
      return `Thêm hội viên ${account} trên ${site}.`;
    }
    const ref = text(summary.customer_ref);
    return ref ? `Thêm hội viên ${ref}.` : "Thêm một hội viên.";
  }
  if (row.action === "customers.import") {
    return `Nhập file hội viên: thêm ${numberOf(summary.created_count)}, bỏ qua ${numberOf(summary.skipped_count)}.`;
  }
  if (row.action === "task.update") {
    return `Đổi trạng thái task sang ${text(summary.status) || "trạng thái mới"}.`;
  }
  if (row.action === "task.reply") {
    return "Trả lời một task.";
  }
  if (row.action === "task.assign" || row.action === "task.transfer") {
    const who = text(summary.to_user_id) ? (names.get(text(summary.to_user_id)) ?? "một nhân viên") : "một nhân viên";
    return row.action === "task.assign" ? `Giao task cho ${who}.` : `Chuyển task cho ${who}.`;
  }
  if (row.action === "customers.care") {
    const name = careLabelName(text(summary.label));
    return name ? `Gắn nhãn ${name}.` : "Gắn nhãn chăm sóc cho một hội viên.";
  }
  if (row.action === "customers.consent") {
    const channel = text(summary.channel) === "sms" ? "SMS" : text(summary.channel) === "ai_voice" ? "giọng nói AI" : "";
    const target = channel ? ` nhận tin ${channel}` : " nhận tin";
    if (text(summary.status) === "revoked") {
      return `Thu hồi đồng ý${target}.`;
    }
    if (text(summary.status) === "granted") {
      return `Ghi đồng ý${target}.`;
    }
    return "Cập nhật đồng ý nhận tin của hội viên.";
  }
  if (row.action === "campaign.create") {
    const site = text(summary.site);
    return site ? `Tạo chiến dịch nháp cho ${site}.` : "Tạo chiến dịch nháp.";
  }
  if (row.action === "campaign.launch") {
    return "Chạy một chiến dịch.";
  }
  if (row.action === "campaign.pause") {
    return "Tạm dừng một chiến dịch.";
  }
  if (row.action === "campaign.resume") {
    return "Chạy tiếp một chiến dịch.";
  }
  if (row.action === "staff.availability") {
    return summary.status === "paused" ? "Tắt nhận việc mới." : "Bật nhận việc mới.";
  }
  if (row.action === "customers.owner") {
    return summary.status === "cleared" ? "Bỏ người giữ hội viên." : "Gán người giữ hội viên.";
  }
  if (row.action === "customers.pool") {
    const pool = text(summary.status);
    const name = pool === "kho_data" ? "kho data" : pool === "nuoi_sms" ? "nuôi SMS" : pool === "active" ? "đang chăm sóc" : "";
    return name ? `Chuyển hội viên sang ${name}.` : "Chuyển kho chăm sóc của hội viên.";
  }
  if (row.action === "rewards.approve") {
    const period = text(summary.period);
    return period ? `Duyệt thưởng kỳ ${period}.` : "Duyệt thưởng.";
  }
  if (row.action === "rewards.revoke") {
    const period = text(summary.period);
    return period ? `Gỡ duyệt thưởng kỳ ${period}.` : "Gỡ duyệt thưởng.";
  }
  if (row.action === "stations.lead") {
    const code = row.entity_id || text(summary.station);
    return code ? `Gắn tổ trưởng cho ${code}.` : "Gắn tổ trưởng hậu đài.";
  }
  if (row.action === "stations.create") {
    const code = row.entity_id || text(summary.station);
    return code ? `Thêm hậu đài ${code}.` : "Thêm một hậu đài.";
  }
  if (row.action === "stations.update") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    return summary.status === "disabled" ? `Tắt hậu đài${name}.` : `Mở lại hậu đài${name}.`;
  }
  if (row.action === "stations.sms") {
    const code = row.entity_id || text(summary.station);
    return code ? `Cập nhật mẫu tin của ${code}.` : "Cập nhật mẫu tin của một đài.";
  }
  if (row.action === "stations.assign") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    const count = Array.isArray(summary.user_ids) ? summary.user_ids.length : 0;
    return count === 0 ? `Bỏ nhân viên chăm sóc khỏi hậu đài${name}.` : `Gắn ${count} nhân viên chăm sóc cho hậu đài${name}.`;
  }
  if (row.action === "settings.rate_limit") {
    return `Cập nhật danh sách IP không bị chặn, còn ${numberOf(summary.count)} địa chỉ.`;
  }
  if (row.action === "telegram.configure") {
    const username = text(summary.username);
    const name = username ? ` @${username}` : "";
    return summary.status === "disabled" ? `Tắt bot Telegram${name}.` : `Cấu hình bot Telegram${name}.`;
  }
  if (row.action === "auth.login" && row.outcome === "failure") {
    const username = text(summary.username);
    return username ? `Đăng nhập thất bại với tên ${username}.` : "Đăng nhập thất bại.";
  }
  if (row.action === "auth.mfa_verify" && row.outcome === "failure") {
    return "Mã MFA không đúng.";
  }
  return ACTION_LABELS[row.action] ? `${ACTION_LABELS[row.action]}.` : row.action;
}

function describeLog(row: SystemLog): string {
  if (row.event === "dispatch.completed") {
    const assigned = numberOf(row.context.assigned);
    const released = numberOf(row.context.released);
    const parts: string[] = [];
    if (assigned > 0) {
      parts.push(`giao ${assigned} task`);
    }
    if (released > 0) {
      parts.push(`trả ${released} task về hàng chờ`);
    }
    return parts.length > 0 ? `Đã ${parts.join(" và ")}.` : "Đã chạy vòng giao task.";
  }
  if (row.event === "http.server_error") {
    return row.message ? `Lỗi máy chủ: ${row.message}` : "Lỗi máy chủ.";
  }
  return row.message || row.event;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
