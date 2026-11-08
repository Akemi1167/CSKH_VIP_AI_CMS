import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Modal, Segmented, Select, Table, Tag, Typography } from "antd";
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
  const [openAudit, setOpenAudit] = useState<AuditEvent | null>(null);
  const [openLog, setOpenLog] = useState<SystemLog | null>(null);

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
    [props.onUnauthorized, props.onMfaSetup],
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
    {
      title: "Người",
      width: 160,
      ellipsis: true,
      render: (_, row) => (row.actor_username ? (namesByUsername.get(row.actor_username) ?? row.actor_username) : "Hệ thống"),
    },
    {
      title: "Nội dung",
      render: (_, row) => (
        <LogReason
          failed={row.outcome === "failure"}
          title={describeAudit(row, names)}
          code={ACTION_LABELS[row.action] ? row.action : null}
        />
      ),
    },
    {
      title: "Thời điểm",
      width: 168,
      render: (_, row) => <LogWhen at={row.created_at} scope="Hành động" />,
    },
    {
      title: "Trạng thái",
      width: 120,
      render: (_, row) => <Tag color={row.outcome === "failure" ? "red" : "green"}>{row.outcome === "failure" ? "Thất bại" : "Thành công"}</Tag>,
    },
    {
      title: "",
      width: 56,
      render: (_, row) => <Button type="text" aria-label="Xem chi tiết" icon={<EyeOutlined />} onClick={() => setOpenAudit(row)} />,
    },
  ];

  const logColumns: TableColumnsType<SystemLog> = [
    {
      title: "Người",
      width: 150,
      ellipsis: true,
      render: (_, row) => (row.actor_username ? (namesByUsername.get(row.actor_username) ?? row.actor_username) : "Hệ thống"),
    },
    {
      title: "Nội dung",
      render: (_, row) => {
        const view = presentLog(row);
        return <LogReason failed={row.level === "error"} title={view.title} method={view.method} path={view.path} status={view.status} ip={row.ip} />;
      },
    },
    {
      title: "Thời điểm",
      width: 168,
      render: (_, row) => <LogWhen at={row.created_at} scope={logScope(row.event)} />,
    },
    {
      title: "Trạng thái",
      width: 120,
      render: (_, row) => <Tag color={row.level === "error" ? "red" : "blue"}>{row.level === "error" ? "Lỗi" : "Thông tin"}</Tag>,
    },
    {
      title: "",
      width: 56,
      render: (_, row) => <Button type="text" aria-label="Xem chi tiết" icon={<EyeOutlined />} onClick={() => setOpenLog(row)} />,
    },
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
              style={{ width: 260 }}
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
      <Modal
        open={openAudit !== null}
        title="Chi tiết hành động"
        footer={null}
        width={720}
        onCancel={() => setOpenAudit(null)}
      >
        {openAudit ? <AuditDetail row={openAudit} names={names} /> : null}
      </Modal>
      <Modal open={openLog !== null} title="Chi tiết log" footer={null} width={720} onCancel={() => setOpenLog(null)}>
        {openLog ? <LogDetail row={openLog} /> : null}
      </Modal>
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
  { value: "staff.mfa_reset", label: "Gỡ MFA" },
  { value: "schedule.save", label: "Đặt giờ ca" },
  { value: "schedule.leave", label: "Ghi nghỉ" },
  { value: "schedule.leave_delete", label: "Xóa nghỉ" },
  { value: "customers.create", label: "Thêm hội viên" },
  { value: "customers.import", label: "Nhập hội viên" },
  { value: "task.update", label: "Đổi trạng thái task" },
  { value: "task.reply", label: "Trả lời task" },
  { value: "task.reopen", label: "Mở lại hội thoại Telegram" },
  { value: "task.assign", label: "Giao task" },
  { value: "task.transfer", label: "Chuyển task" },
  { value: "customers.care", label: "Gắn nhãn chăm sóc" },
  { value: "customers.consent", label: "Ghi đồng ý nhận tin" },
  { value: "campaign.create", label: "Tạo chiến dịch" },
  { value: "campaign.call_list", label: "Gắn danh sách gọi" },
  { value: "voice.review", label: "Chấm điểm cuộc gọi" },
  { value: "campaign.launch", label: "Chạy chiến dịch" },
  { value: "campaign.pause", label: "Tạm dừng chiến dịch" },
  { value: "campaign.resume", label: "Chạy tiếp chiến dịch" },
  { value: "stations.create", label: "Thêm hậu đài" },
  { value: "stations.update", label: "Bật hoặc tắt hậu đài" },
  { value: "stations.assign", label: "Gắn nhân viên hậu đài" },
  { value: "stations.logo", label: "Đổi logo đài" },
  { value: "staff.stations", label: "Gắn đài cho nhân viên" },
  { value: "stations.lead", label: "Gắn tổ trưởng hậu đài" },
  { value: "staff.availability", label: "Bật hoặc tắt nhận việc" },
  { value: "customers.owner", label: "Gán người giữ hội viên" },
  { value: "customers.pool", label: "Chuyển kho chăm sóc" },
  { value: "rewards.approve", label: "Duyệt thưởng" },
  { value: "rewards.revoke", label: "Gỡ duyệt thưởng" },
  { value: "stations.sms", label: "Sửa mẫu tin theo đài" },
  { value: "sms.test", label: "Gửi thử SMS" },
  { value: "voice.test", label: "Gọi thử AI" },
  { value: "laaffic.sync", label: "Đồng bộ Laaffic" },
  { value: "settings.rate_limit", label: "Cập nhật IP không bị chặn" },
  { value: "settings.voice_call", label: "Đổi thời lượng cuộc gọi" },
  { value: "task.verify_claim", label: "Nhận hội thoại xác minh" },
  { value: "task.verify_account", label: "Gắn tài khoản và chuyển đài" },
  { value: "task.verify_reject", label: "Báo không thuộc danh sách khuyến mãi" },
  { value: "telegram.configure", label: "Cấu hình bot Telegram" },
];

const LOG_FILTERS = [
  { value: "campaign.webhook", label: "Báo cáo Laaffic" },
  { value: "campaign.sent", label: "Gửi chiến dịch" },
  { value: "campaign.send_failed", label: "Lỗi gửi chiến dịch" },
  { value: "provider.test", label: "Gửi hoặc gọi thử" },
  { value: "dispatch.completed", label: "Giao task" },
  { value: "dispatch.failed", label: "Lỗi giao task" },
  { value: "telegram.delivered", label: "Gửi Telegram" },
  { value: "telegram.deliver_failed", label: "Lỗi Telegram" },
  { value: "care.stale", label: "Hội viên lâu chưa liên hệ" },
  { value: "care.worker_failed", label: "Lỗi nhắc hẹn" },
  { value: "http.server_error", label: "Lỗi máy chủ" },
  { value: "outbox.publish_failed", label: "Lỗi outbox" },
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
    if (Array.isArray(summary.work_functions)) {
      changes.push("đổi chức năng làm việc");
    }
    if (summary.password_reset === true) {
      changes.push("đổi mật khẩu");
    }
    const name = text(summary.username);
    const who = name ? ` ${name}` : "";
    const detail = changes.length > 0 ? `: ${changes.join(", ")}` : "";
    return `Sửa hồ sơ${who}${detail}.`;
  }
  if (row.action === "staff.stations") {
    const username = text(summary.username);
    const stations = Array.isArray(summary.stations) ? summary.stations.filter((item): item is string => typeof item === "string") : [];
    const who = username ? ` ${username}` : "";
    return stations.length === 0 ? `Bỏ đài chăm sóc của nhân viên${who}.` : `Gắn đài ${stations.join(", ")} cho nhân viên${who}.`;
  }
  if (row.action === "staff.mfa_reset") {
    const username = text(summary.username);
    return username ? `Gỡ MFA của ${username}.` : "Gỡ MFA của một nhân viên.";
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
  if (row.action === "task.reopen") {
    return "Mở lại hội thoại Telegram đã đóng.";
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
  if (row.action === "voice.review") {
    return `Chấm ${numberOf(summary.score)} điểm cho một cuộc gọi.`;
  }
  if (row.action === "campaign.call_list") {
    const listed = numberOf(summary.listed);
    const missing = numberOf(summary.missing);
    return missing > 0 ? `Gắn ${listed} hội viên vào danh sách gọi. Không thấy ${missing}.` : `Gắn ${listed} hội viên vào danh sách gọi.`;
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
  if (row.action === "sms.test") {
    const who = text(summary.recipient);
    return who ? `Gửi thử SMS tới ${who}.` : "Gửi thử SMS.";
  }
  if (row.action === "voice.test") {
    const who = text(summary.recipient);
    return who ? `Gọi thử AI tới ${who}.` : "Gọi thử AI.";
  }
  if (row.action === "laaffic.sync") {
    const count = typeof summary.pulled === "number" ? summary.pulled : 0;
    return summary.channel === "ai_voice" ? `Đồng bộ ${count} cuộc gọi từ Laaffic.` : `Đồng bộ ${count} tin nhắn từ Laaffic.`;
  }
  if (row.action === "stations.logo") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    return summary.status === "cleared" ? `Gỡ logo hậu đài${name}.` : `Đổi logo hậu đài${name}.`;
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
  if (row.action === "settings.voice_call") {
    return `Đổi thời lượng cuộc gọi AI còn ${numberOf(summary.max_call_seconds)} giây.`;
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
  const context = row.context;
  if (row.event === "dispatch.completed") {
    const assigned = numberOf(context.assigned);
    const released = numberOf(context.released);
    const parts: string[] = [];
    if (assigned > 0) {
      parts.push(`giao ${assigned} task`);
    }
    if (released > 0) {
      parts.push(`trả ${released} task về hàng chờ`);
    }
    return parts.length > 0 ? `Đã ${parts.join(" và ")}.` : "Đã chạy vòng giao task.";
  }
  if (row.event === "campaign.webhook") {
    const channel = text(context.channel) === "ai_voice" ? "gọi AI" : text(context.channel) === "sms" ? "SMS" : "nhà cung cấp";
    if (text(context.outcome) === "rejected") {
      const reason = text(context.reason);
      const why = reason === "bad_signature" ? "chữ ký sai" : reason === "missing_signature" ? "thiếu chữ ký" : reason === "invalid_json" ? "nội dung không đọc được" : "không hợp lệ";
      return `Từ chối báo cáo ${channel} vì ${why}.`;
    }
    return `Nhận báo cáo ${channel}: ${numberOf(context.received)} tin, cập nhật ${numberOf(context.updated)}.${dialogueCount(context.dialogue) > 0 ? ` Có ${dialogueCount(context.dialogue)} câu hội thoại.` : ""}`;
  }
  if (row.event === "campaign.sent") {
    const failed = numberOf(context.failed);
    const accepted = numberOf(context.accepted);
    return failed > 0 ? `Gửi chiến dịch: ${accepted} thành công, ${failed} lỗi.` : `Đã gửi ${accepted} tin chiến dịch.`;
  }
  if (row.event === "provider.test") {
    return row.message;
  }
  if (row.event === "care.stale") {
    return `Có ${numberOf(context.count)} hội viên quá 15 ngày chưa liên hệ.`;
  }
  if (row.event === "telegram.delivered") {
    const failed = numberOf(context.failed);
    const sent = numberOf(context.sent);
    return failed > 0 ? `Telegram: gửi được ${sent}, lỗi ${failed}.` : `Đã gửi ${sent} tin Telegram.`;
  }
  if (row.event === "http.server_error") {
    const method = text(context.method);
    const path = text(context.path);
    const status = numberOf(context.status);
    const where = method && path ? ` ${method} ${path}` : "";
    const reason = text(context.detail);
    const head = status > 0 ? `Lỗi ${status}${where}` : row.message || "Lỗi máy chủ";
    return reason ? `${head}. ${reason}` : `${head}.`;
  }
  return row.message || row.event;
}

function LogReason(props: { failed: boolean; title: string; method?: string | null; path?: string | null; status?: number | null; ip?: string | null; code?: string | null }) {
  const method = props.method?.toLowerCase() ?? "";
  return (
    <div className={props.failed ? "log-reason log-reason--fail" : "log-reason"}>
      <p className="log-reason__title">{props.title}</p>
      {props.path ? (
        <p className="log-reason__path">
          <LogPath path={props.path} />
        </p>
      ) : null}
      {props.method || props.status || props.code ? (
        <div className="log-reason__badges">
          {props.method ? <span className={`log-method log-method--${method}`}>{props.method}</span> : null}
          {props.code ? <span className="log-code">{props.code}</span> : null}
          {props.status ? <Tag color={props.status >= 500 ? "red" : "default"}>{props.status}</Tag> : null}
        </div>
      ) : null}
      {props.ip ? <p className="log-reason__ip">IP {props.ip}</p> : null}
    </div>
  );
}

function LogWhen(props: { at: string; scope: string }) {
  return (
    <div className="log-when">
      <p>{formatStamp(props.at)}</p>
      <p className="log-when__scope">{props.scope}</p>
    </div>
  );
}

function LogPath(props: { path: string }) {
  const leading = props.path.startsWith("/");
  const parts = props.path.replace(/^\/+/, "").split("/").filter(Boolean);
  return (
    <span title={props.path}>
      {leading ? <span className="is-dim">/</span> : null}
      {parts.map((part, index) => {
        const dim = part === "api" || part === "v1" || part === "admin" || /^[0-9a-f-]{8,}$/i.test(part) || /^\d+$/.test(part);
        return (
          <span key={`${part}-${index}`}>
            {index > 0 ? <span className="is-dim">/</span> : null}
            <span className={dim ? "is-dim" : undefined}>{part}</span>
          </span>
        );
      })}
    </span>
  );
}

function presentLog(row: SystemLog): { title: string; method: string | null; path: string | null; status: number | null } {
  const route = readRoute(row);
  return { title: stripRoute(describeLog(row), route), ...route };
}

function readRoute(row: SystemLog): { method: string | null; path: string | null; status: number | null } {
  const contextMethod = text(row.context.method).toUpperCase();
  const contextPath = text(row.context.path);
  const contextStatus = numberOf(row.context.status);
  const match = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/.exec(`${row.message} ${text(row.context.detail)}`);
  const statusMatch = /\b([45]\d{2})\b/.exec(row.message);
  const method = /^(GET|POST|PUT|PATCH|DELETE)$/.test(contextMethod) ? contextMethod : (match?.[1] ?? null);
  const rawPath = contextPath.startsWith("/") ? contextPath : (match?.[2] ?? "");
  const path = rawPath.replace(/[.,;]+$/, "") || null;
  const status = contextStatus >= 400 ? contextStatus : statusMatch ? Number(statusMatch[1]) : null;
  return { method, path, status };
}

function stripRoute(sentence: string, route: { method: string | null; path: string | null; status: number | null }): string {
  let next = sentence;
  if (route.method && route.path) {
    next = next.replace(`${route.method} ${route.path}`, " ");
  }
  if (route.status) {
    next = next.replace(`Lỗi ${route.status}`, " ");
  }
  next = next.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").replace(/\s+\./g, ".");
  return next || sentence;
}

function logScope(event: string): string {
  if (event.startsWith("http.")) {
    return "API";
  }
  if (event.startsWith("campaign.") || event.startsWith("provider.") || event.startsWith("laaffic.")) {
    return "Laaffic";
  }
  if (event.startsWith("dispatch.")) {
    return "Giao việc";
  }
  if (event.startsWith("chat.")) {
    return "Chat";
  }
  if (event.startsWith("telegram.")) {
    return "Telegram";
  }
  if (event.startsWith("care.")) {
    return "Chăm sóc";
  }
  return "Hệ thống";
}

function dialogueCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function logTurns(value: unknown): Array<{ role: string; text: string; at?: string | null }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as { role?: unknown; text?: unknown; at?: unknown };
    const text = typeof row.text === "string" ? row.text : "";
    if (!text) {
      return [];
    }
    return [{ role: typeof row.role === "string" ? row.role : "Khác", text, at: typeof row.at === "string" ? row.at : null }];
  });
}

function AuditDetail(props: { row: AuditEvent; names: Map<string, string> }) {
  const failed = props.row.outcome === "failure";
  const extra = plainRows(props.row.summary);
  return (
    <div className="log-view">
      <section className={failed ? "log-sheet log-sheet--fail" : "log-sheet"}>
        <div className="log-reason__badges">
          <Tag color={failed ? "red" : "green"}>{failed ? "Thất bại" : "Thành công"}</Tag>
          <span className="log-code">{props.row.action}</span>
        </div>
        <p className="log-sheet__title">{describeAudit(props.row, props.names)}</p>
      </section>
      <section className="log-panel">
        <h3>Thông tin</h3>
        <div className="log-detail">
          <Field label="Thời điểm" value={formatStamp(props.row.created_at)} />
          <Field label="Người" value={props.row.actor_username || "Hệ thống"} />
          <Field label="Đối tượng" value={props.row.entity} />
          <Field label="Mã yêu cầu" value={props.row.request_id} mono />
        </div>
      </section>
      {extra.length > 0 ? (
        <section className="log-panel">
          <h3>Ghi thêm</h3>
          <dl className="log-pairs">
            {extra.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function LogDetail(props: { row: SystemLog }) {
  const view = presentLog(props.row);
  const failed = props.row.level === "error";
  const turns = logTurns(props.row.context.dialogue);
  const extra = plainRows(props.row.context);
  return (
    <div className="log-view">
      <section className={failed ? "log-sheet log-sheet--fail" : "log-sheet"}>
        <div className="log-reason__badges">
          <Tag color={failed ? "red" : "blue"}>{failed ? "Lỗi" : "Thông tin"}</Tag>
          {view.method ? <span className={`log-method log-method--${view.method.toLowerCase()}`}>{view.method}</span> : null}
          {view.status ? <Tag color={view.status >= 500 ? "red" : "default"}>{view.status}</Tag> : null}
          <span className="log-code">{logScope(props.row.event)}</span>
        </div>
        <p className="log-sheet__title">{view.title}</p>
        {view.path ? (
          <p className="log-reason__path">
            <LogPath path={view.path} />
          </p>
        ) : null}
      </section>
      <section className="log-panel">
        <h3>Thông tin</h3>
        <div className="log-detail">
          <Field label="Thời điểm" value={formatStamp(props.row.created_at)} />
          <Field label="Người" value={props.row.actor_username || "Hệ thống"} />
          <Field label="IP" value={props.row.ip} mono />
          <Field label="Mã yêu cầu" value={props.row.request_id} mono />
        </div>
      </section>
      {turns.length > 0 ? (
        <section className="log-panel">
          <h3>Hội thoại</h3>
          <div className="log-dialogue">
            {turns.map((turn, index) => (
              <p key={`${turn.role}-${index}`}>
                <strong>{turn.role}.</strong> {turn.text}
                {turn.at ? <time>{formatStamp(turn.at)}</time> : null}
              </p>
            ))}
          </div>
        </section>
      ) : null}
      {extra.length > 0 ? (
        <section className="log-panel">
          <h3>Ghi thêm</h3>
          <dl className="log-pairs">
            {extra.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function Field(props: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <p>
      <span>{props.label}</span>
      <strong className={props.mono ? "is-mono" : undefined}>{props.value || "—"}</strong>
    </p>
  );
}

const CONTEXT_LABELS: Record<string, string> = {
  error_name: "Mã lỗi",
  channel: "Kênh",
  outcome: "Kết quả",
  reason: "Lý do",
  received: "Đã nhận",
  updated: "Đã cập nhật",
  assigned: "Đã giao",
  released: "Đã trả hàng chờ",
  failed: "Số lỗi",
  accepted: "Đã gửi được",
  sent: "Đã gửi",
  count: "Số lượng",
  idle_minutes: "Số phút im lặng",
  max_call_seconds: "Số giây cuộc gọi",
  closed: "Hội thoại đã đóng",
  pulled: "Số dòng",
  username: "Tên đăng nhập",
  game_account: "Tài khoản",
  site: "Hậu đài",
  status: "Trạng thái",
  label: "Nhãn",
};

const SKIP_CONTEXT = new Set(["path", "method", "detail", "dialogue", "payload", "message", "body", "content"]);

function plainRows(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(record).flatMap(([key, value]) => {
    if (SKIP_CONTEXT.has(key) || value == null || value === "" || (key === "status" && typeof value === "number")) {
      return [];
    }
    if (typeof value === "object") {
      return [];
    }
    return [{ label: CONTEXT_LABELS[key] ?? key.replaceAll("_", " "), value: shownValue(key, value) }];
  });
}

function shownValue(key: string, value: unknown): string {
  if (key === "channel") {
    if (value === "ai_voice") {
      return "Gọi AI";
    }
    if (value === "sms") {
      return "SMS";
    }
  }
  if (key === "outcome") {
    if (value === "rejected") {
      return "Từ chối";
    }
    if (value === "accepted") {
      return "Đã nhận";
    }
  }
  if (key === "reason") {
    if (value === "bad_signature") {
      return "Chữ ký sai";
    }
    if (value === "missing_signature") {
      return "Thiếu chữ ký";
    }
    if (value === "invalid_json") {
      return "Nội dung không đọc được";
    }
  }
  if (typeof value === "boolean") {
    return value ? "Có" : "Không";
  }
  return String(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
