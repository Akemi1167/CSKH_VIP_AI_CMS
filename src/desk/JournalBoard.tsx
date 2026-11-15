import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Modal, Segmented, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { useTr } from "./language.tsx";
import { careLabelName, formatStamp } from "../copy.ts";
import type { AuditEvent, Page, Staff, SystemLog } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type Kind = "audit" | "system";

export function JournalBoard(props: { canListStaff: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được nhật ký", "无法加载日志"), "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được trang sau", "无法加载下一页"), "");
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
      title: tr("Người", "人员"),
      width: 160,
      ellipsis: true,
      render: (_, row) => (row.actor_username ? (namesByUsername.get(row.actor_username) ?? row.actor_username) : tr("Hệ thống", "系统")),
    },
    {
      title: tr("Nội dung", "内容"),
      render: (_, row) => (
        <LogReason
          failed={row.outcome === "failure"}
          title={describeAudit(row, names, tr)}
          code={AUDIT_FILTERS.some((item) => item.value === row.action) ? row.action : null}
        />
      ),
    },
    {
      title: tr("Thời điểm", "时间"),
      width: 168,
      render: (_, row) => <LogWhen at={row.created_at} scope={tr("Hành động", "操作")} />,
    },
    {
      title: tr("Trạng thái", "状态"),
      width: 120,
      render: (_, row) => <Tag color={row.outcome === "failure" ? "red" : "green"}>{row.outcome === "failure" ? tr("Thất bại", "失败") : tr("Thành công", "成功")}</Tag>,
    },
    {
      title: "",
      width: 56,
      render: (_, row) => <Button type="text" aria-label={tr("Xem chi tiết", "查看详情")} icon={<EyeOutlined />} onClick={() => setOpenAudit(row)} />,
    },
  ];

  const logColumns: TableColumnsType<SystemLog> = [
    {
      title: tr("Người", "人员"),
      width: 150,
      ellipsis: true,
      render: (_, row) => (row.actor_username ? (namesByUsername.get(row.actor_username) ?? row.actor_username) : tr("Hệ thống", "系统")),
    },
    {
      title: tr("Nội dung", "内容"),
      render: (_, row) => {
        const view = presentLog(row, tr);
        return <LogReason failed={row.level === "error"} title={view.title} method={view.method} path={view.path} status={view.status} ip={row.ip} />;
      },
    },
    {
      title: tr("Thời điểm", "时间"),
      width: 168,
      render: (_, row) => <LogWhen at={row.created_at} scope={logScope(row.event, tr)} />,
    },
    {
      title: tr("Trạng thái", "状态"),
      width: 120,
      render: (_, row) => <Tag color={row.level === "error" ? "red" : "blue"}>{row.level === "error" ? tr("Lỗi", "错误") : tr("Thông tin", "信息")}</Tag>,
    },
    {
      title: "",
      width: 56,
      render: (_, row) => <Button type="text" aria-label={tr("Xem chi tiết", "查看详情")} icon={<EyeOutlined />} onClick={() => setOpenLog(row)} />,
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Nhật ký", "日志")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Mỗi dòng là một việc vừa xảy ra. Không có mật khẩu hay nội dung tin nhắn.", "每一行是刚发生的一件事。不含密码或消息内容。")}</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
        <Segmented
          value={kind}
          options={[
            { label: tr("Hành động", "操作"), value: "audit" },
            { label: tr("Log hệ thống", "系统日志"), value: "system" },
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
                placeholder={tr("Người thực hiện", "操作人")}
                style={{ width: 220 }}
                value={actorId}
                optionFilterProp="label"
                options={staff.map((person) => ({ value: person.id, label: `${person.display_name} (${person.username})` }))}
                onChange={(value) => setActorId(value)}
              />
            ) : null}
            <Select
              allowClear
              placeholder={tr("Mọi việc", "全部事项")}
              style={{ width: 220 }}
              value={action || undefined}
              options={AUDIT_FILTERS.map((item) => ({ value: item.value, label: tr(item.vi, item.zh) }))}
              onChange={(value) => setAction(value ?? "")}
            />
            <Select
              value={outcome}
              style={{ width: 150 }}
              options={[
                { value: "all", label: tr("Mọi kết quả", "全部结果") },
                { value: "success", label: tr("Thành công", "成功") },
                { value: "failure", label: tr("Thất bại", "失败") },
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
                { value: "all", label: tr("Mọi mức", "全部级别") },
                { value: "info", label: tr("Thông tin", "信息") },
                { value: "error", label: tr("Lỗi", "错误") },
              ]}
              onChange={(value: "all" | "info" | "error") => setLevel(value)}
            />
            <Select
              allowClear
              placeholder={tr("Mọi việc", "全部事项")}
              style={{ width: 260 }}
              value={eventName || undefined}
              options={LOG_FILTERS.map((item) => ({ value: item.value, label: tr(item.vi, item.zh) }))}
              onChange={(value) => setEventName(value ?? "")}
            />
          </>
        )}
        <Button type="primary" onClick={() => apply()}>
          {tr("Lọc", "筛选")}
        </Button>
        <Button icon={<ReloadOutlined />} aria-label={tr("Tải lại", "刷新")} onClick={() => setApplied((current) => ({ ...current }))} />
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
          locale={{ emptyText: loading ? " " : tr("Chưa có hành động.", "暂无操作。") }}
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
          locale={{ emptyText: loading ? " " : tr("Chưa có log.", "暂无日志。") }}
        />
      )}
      <Modal
        open={openAudit !== null}
        title={tr("Chi tiết hành động", "操作详情")}
        footer={null}
        width={720}
        onCancel={() => setOpenAudit(null)}
      >
        {openAudit ? <AuditDetail row={openAudit} names={names} /> : null}
      </Modal>
      <Modal open={openLog !== null} title={tr("Chi tiết log", "日志详情")} footer={null} width={720} onCancel={() => setOpenLog(null)}>
        {openLog ? <LogDetail row={openLog} /> : null}
      </Modal>
      {cursor ? (
        <Button style={{ marginTop: 12 }} loading={loadingMore} onClick={() => void more()}>
          {tr("Xem thêm", "查看更多")}
        </Button>
      ) : null}
    </section>
  );
}

type Tr = (vi: string, zh: string) => string;

const AUDIT_FILTERS: { value: string; vi: string; zh: string }[] = [
  { value: "auth.login", vi: "Đăng nhập", zh: "登录" },
  { value: "auth.logout", vi: "Đăng xuất", zh: "退出" },
  { value: "auth.password_change", vi: "Đổi mật khẩu", zh: "修改密码" },
  { value: "auth.step_up", vi: "Xác nhận mật khẩu", zh: "确认密码" },
  { value: "auth.mfa_setup", vi: "Bắt đầu bật MFA", zh: "开始开启 MFA" },
  { value: "auth.mfa_confirm", vi: "Bật MFA", zh: "开启 MFA" },
  { value: "auth.mfa_verify", vi: "Nhập mã MFA", zh: "输入 MFA 验证码" },
  { value: "staff.create", vi: "Tạo nhân viên", zh: "创建员工" },
  { value: "staff.update", vi: "Sửa nhân viên", zh: "编辑员工" },
  { value: "staff.mfa_reset", vi: "Gỡ MFA", zh: "解除 MFA" },
  { value: "schedule.save", vi: "Đặt giờ ca", zh: "设置班次时间" },
  { value: "schedule.leave", vi: "Ghi nghỉ", zh: "登记休息" },
  { value: "schedule.leave_delete", vi: "Xóa nghỉ", zh: "删除休息" },
  { value: "customers.create", vi: "Thêm hội viên", zh: "添加会员" },
  { value: "customers.import", vi: "Nhập hội viên", zh: "导入会员" },
  { value: "task.update", vi: "Đổi trạng thái task", zh: "更改任务状态" },
  { value: "task.reply", vi: "Trả lời task", zh: "回复任务" },
  { value: "task.reopen", vi: "Mở lại hội thoại Telegram", zh: "重新打开 Telegram 会话" },
  { value: "task.assign", vi: "Giao task", zh: "分配任务" },
  { value: "task.transfer", vi: "Chuyển task", zh: "转交任务" },
  { value: "customers.care", vi: "Gắn nhãn chăm sóc", zh: "添加关怀标签" },
  { value: "customers.consent", vi: "Ghi đồng ý nhận tin", zh: "记录接收消息同意" },
  { value: "campaign.create", vi: "Tạo chiến dịch", zh: "创建活动" },
  { value: "campaign.call_list", vi: "Gắn danh sách gọi", zh: "添加呼叫名单" },
  { value: "voice.review", vi: "Chấm điểm cuộc gọi", zh: "通话评分" },
  { value: "campaign.launch", vi: "Chạy chiến dịch", zh: "启动活动" },
  { value: "campaign.pause", vi: "Tạm dừng chiến dịch", zh: "暂停活动" },
  { value: "campaign.resume", vi: "Chạy tiếp chiến dịch", zh: "继续活动" },
  { value: "stations.create", vi: "Thêm hậu đài", zh: "添加站点" },
  { value: "stations.update", vi: "Bật hoặc tắt hậu đài", zh: "开启或关闭站点" },
  { value: "stations.assign", vi: "Gắn nhân viên hậu đài", zh: "分配站点员工" },
  { value: "stations.logo", vi: "Đổi logo đài", zh: "更换站点 Logo" },
  { value: "staff.stations", vi: "Gắn đài cho nhân viên", zh: "为员工分配站点" },
  { value: "stations.lead", vi: "Gắn tổ trưởng hậu đài", zh: "分配站点组长" },
  { value: "staff.availability", vi: "Bật hoặc tắt nhận việc", zh: "开启或关闭接单" },
  { value: "customers.owner", vi: "Gán người giữ hội viên", zh: "指定会员负责人" },
  { value: "customers.pool", vi: "Chuyển kho chăm sóc", zh: "转移关怀库" },
  { value: "rewards.approve", vi: "Duyệt thưởng", zh: "审批奖励" },
  { value: "rewards.revoke", vi: "Gỡ duyệt thưởng", zh: "取消奖励审批" },
  { value: "stations.sms", vi: "Sửa mẫu tin theo đài", zh: "按站点修改消息模板" },
  { value: "sms.test", vi: "Gửi thử SMS", zh: "试发 SMS" },
  { value: "voice.test", vi: "Gọi thử AI", zh: "试呼 AI" },
  { value: "laaffic.sync", vi: "Đồng bộ Laaffic", zh: "同步 Laaffic" },
  { value: "settings.rate_limit", vi: "Cập nhật IP không bị chặn", zh: "更新不限制的 IP" },
  { value: "settings.voice_call", vi: "Đổi thời lượng cuộc gọi", zh: "修改通话时长" },
  { value: "settings.hangup_sms", vi: "Đổi tin sau cuộc gọi", zh: "修改通话后短信" },
  { value: "task.verify_claim", vi: "Nhận hội thoại xác minh", zh: "领取验证会话" },
  { value: "task.verify_account", vi: "Gắn tài khoản và chuyển đài", zh: "绑定账号并转移站点" },
  { value: "task.verify_reject", vi: "Báo không thuộc danh sách khuyến mãi", zh: "标记不属于优惠名单" },
  { value: "telegram.configure", vi: "Cấu hình bot Telegram", zh: "配置 Telegram 机器人" },
];

const LOG_FILTERS: { value: string; vi: string; zh: string }[] = [
  { value: "campaign.webhook", vi: "Báo cáo Laaffic", zh: "Laaffic 报告" },
  { value: "campaign.sent", vi: "Gửi chiến dịch", zh: "发送活动" },
  { value: "campaign.send_failed", vi: "Lỗi gửi chiến dịch", zh: "活动发送失败" },
  { value: "provider.test", vi: "Gửi hoặc gọi thử", zh: "试发或试呼" },
  { value: "dispatch.completed", vi: "Giao task", zh: "分配任务" },
  { value: "dispatch.failed", vi: "Lỗi giao task", zh: "任务分配失败" },
  { value: "telegram.delivered", vi: "Gửi Telegram", zh: "发送 Telegram" },
  { value: "telegram.deliver_failed", vi: "Lỗi Telegram", zh: "Telegram 失败" },
  { value: "care.stale", vi: "Hội viên lâu chưa liên hệ", zh: "长期未联系的会员" },
  { value: "care.worker_failed", vi: "Lỗi nhắc hẹn", zh: "预约提醒失败" },
  { value: "http.server_error", vi: "Lỗi máy chủ", zh: "服务器错误" },
  { value: "outbox.publish_failed", vi: "Lỗi outbox", zh: "Outbox 错误" },
];

function auditSentence(action: string, tr: Tr): string | null {
  const item = AUDIT_FILTERS.find((row) => row.value === action);
  return item ? tr(`${item.vi}.`, `${item.zh}。`) : null;
}

function describeAudit(row: AuditEvent, names: Map<string, string>, tr: Tr): string {
  const summary = row.summary;
  const personVi = text(summary.user_id) ? (names.get(text(summary.user_id)) ?? "một nhân viên") : "";
  const personZh = text(summary.user_id) ? (names.get(text(summary.user_id)) ?? "一名员工") : "";
  const kindVi = summary.kind === "absence" ? "nghỉ đột xuất" : summary.kind === "leave" ? "nghỉ phép" : "";
  const kindZh = summary.kind === "absence" ? "临时缺勤" : summary.kind === "leave" ? "请假" : "";
  if (row.action === "schedule.leave") {
    const released = numberOf(summary.released_task_count);
    const returnedVi = released > 0 ? ` Đã trả ${released} hội thoại về hàng chờ.` : "";
    const returnedZh = released > 0 ? `已将 ${released} 个会话退回队列。` : "";
    return tr(`Ghi ${kindVi || "nghỉ"} cho ${personVi || "một nhân viên"}.${returnedVi}`, `为${personZh || "一名员工"}登记${kindZh || "休息"}。${returnedZh}`);
  }
  if (row.action === "schedule.leave_delete") {
    return tr(
      `Xóa ${kindVi || "một khoảng nghỉ"} của ${personVi || "một nhân viên"}.`,
      `删除${personZh || "一名员工"}的${kindZh || "一段休息"}。`,
    );
  }
  if (row.action === "schedule.save") {
    const start = text(summary.start_local).slice(0, 5);
    const end = text(summary.end_local).slice(0, 5);
    return start && end ? tr(`Đặt ca team ${start}–${end}.`, `设置团队班次 ${start}–${end}。`) : tr("Đặt giờ ca của team.", "设置团队班次时间。");
  }
  if (row.action === "staff.create") {
    const username = text(summary.username);
    return username ? tr(`Tạo nhân viên ${username}.`, `创建员工 ${username}。`) : tr("Tạo nhân viên.", "创建员工。");
  }
  if (row.action === "staff.update") {
    const changesVi: string[] = [];
    const changesZh: string[] = [];
    if (summary.status === "disabled") {
      changesVi.push("khóa tài khoản");
      changesZh.push("锁定账号");
    } else if (summary.status === "active") {
      changesVi.push("mở lại tài khoản");
      changesZh.push("重新启用账号");
    }
    if (Array.isArray(summary.roles)) {
      changesVi.push("đổi vai trò");
      changesZh.push("更改角色");
    }
    if (Array.isArray(summary.work_functions)) {
      changesVi.push("đổi chức năng làm việc");
      changesZh.push("更改工作职能");
    }
    if (summary.password_reset === true) {
      changesVi.push("đổi mật khẩu");
      changesZh.push("修改密码");
    }
    const name = text(summary.username);
    const who = name ? ` ${name}` : "";
    const detailVi = changesVi.length > 0 ? `: ${changesVi.join(", ")}` : "";
    const detailZh = changesZh.length > 0 ? `：${changesZh.join("、")}` : "";
    return tr(`Sửa hồ sơ${who}${detailVi}.`, `编辑资料${who}${detailZh}。`);
  }
  if (row.action === "staff.stations") {
    const username = text(summary.username);
    const stations = Array.isArray(summary.stations) ? summary.stations.filter((item): item is string => typeof item === "string") : [];
    const who = username ? ` ${username}` : "";
    const listed = stations.join(", ");
    return stations.length === 0
      ? tr(`Bỏ đài chăm sóc của nhân viên${who}.`, who ? `取消员工${who} 的负责站点。` : "取消员工的负责站点。")
      : tr(`Gắn đài ${listed} cho nhân viên${who}.`, who ? `为员工${who} 分配站点 ${listed}。` : `为员工分配站点 ${listed}。`);
  }
  if (row.action === "staff.mfa_reset") {
    const username = text(summary.username);
    return username ? tr(`Gỡ MFA của ${username}.`, `解除 ${username} 的 MFA。`) : tr("Gỡ MFA của một nhân viên.", "解除一名员工的 MFA。");
  }
  if (row.action === "customers.create") {
    const account = text(summary.game_account);
    const site = text(summary.site);
    if (account && site) {
      return tr(`Thêm hội viên ${account} trên ${site}.`, `在 ${site} 添加会员 ${account}。`);
    }
    const ref = text(summary.customer_ref);
    return ref ? tr(`Thêm hội viên ${ref}.`, `添加会员 ${ref}。`) : tr("Thêm một hội viên.", "添加一名会员。");
  }
  if (row.action === "customers.import") {
    const created = numberOf(summary.created_count);
    const skipped = numberOf(summary.skipped_count);
    return tr(`Nhập file hội viên: thêm ${created}, bỏ qua ${skipped}.`, `导入会员文件：新增 ${created}，跳过 ${skipped}。`);
  }
  if (row.action === "task.update") {
    const status = text(summary.status);
    return tr(`Đổi trạng thái task sang ${status || "trạng thái mới"}.`, `将任务状态改为 ${status || "新状态"}。`);
  }
  if (row.action === "task.reply") {
    return tr("Trả lời một task.", "回复一个任务。");
  }
  if (row.action === "task.reopen") {
    return tr("Mở lại hội thoại Telegram đã đóng.", "重新打开已关闭的 Telegram 会话。");
  }
  if (row.action === "task.assign" || row.action === "task.transfer") {
    const whoVi = text(summary.to_user_id) ? (names.get(text(summary.to_user_id)) ?? "một nhân viên") : "một nhân viên";
    const whoZh = text(summary.to_user_id) ? (names.get(text(summary.to_user_id)) ?? "一名员工") : "一名员工";
    return row.action === "task.assign" ? tr(`Giao task cho ${whoVi}.`, `把任务分配给 ${whoZh}。`) : tr(`Chuyển task cho ${whoVi}.`, `把任务转交给 ${whoZh}。`);
  }
  if (row.action === "customers.care") {
    const name = careLabelName(text(summary.label));
    return name ? tr(`Gắn nhãn ${name}.`, `添加标签 ${name}。`) : tr("Gắn nhãn chăm sóc cho một hội viên.", "为一名会员添加关怀标签。");
  }
  if (row.action === "customers.consent") {
    const channelVi = text(summary.channel) === "sms" ? "SMS" : text(summary.channel) === "ai_voice" ? "giọng nói AI" : "";
    const channelZh = text(summary.channel) === "sms" ? "SMS" : text(summary.channel) === "ai_voice" ? "AI 语音" : "";
    const targetVi = channelVi ? ` nhận tin ${channelVi}` : " nhận tin";
    const targetZh = channelZh ? `接收 ${channelZh}` : "接收消息";
    if (text(summary.status) === "revoked") {
      return tr(`Thu hồi đồng ý${targetVi}.`, `收回${targetZh}的同意。`);
    }
    if (text(summary.status) === "granted") {
      return tr(`Ghi đồng ý${targetVi}.`, `记录${targetZh}的同意。`);
    }
    return tr("Cập nhật đồng ý nhận tin của hội viên.", "更新会员接收消息的同意。");
  }
  if (row.action === "campaign.create") {
    const site = text(summary.site);
    return site ? tr(`Tạo chiến dịch nháp cho ${site}.`, `为 ${site} 创建活动草稿。`) : tr("Tạo chiến dịch nháp.", "创建活动草稿。");
  }
  if (row.action === "voice.review") {
    const score = numberOf(summary.score);
    return tr(`Chấm ${score} điểm cho một cuộc gọi.`, `为一通通话打了 ${score} 分。`);
  }
  if (row.action === "campaign.call_list") {
    const listed = numberOf(summary.listed);
    const missing = numberOf(summary.missing);
    return missing > 0
      ? tr(`Gắn ${listed} hội viên vào danh sách gọi. Không thấy ${missing}.`, `已将 ${listed} 名会员加入呼叫名单。有 ${missing} 名未找到。`)
      : tr(`Gắn ${listed} hội viên vào danh sách gọi.`, `已将 ${listed} 名会员加入呼叫名单。`);
  }
  if (row.action === "campaign.launch") {
    return tr("Chạy một chiến dịch.", "启动一个活动。");
  }
  if (row.action === "campaign.pause") {
    return tr("Tạm dừng một chiến dịch.", "暂停一个活动。");
  }
  if (row.action === "campaign.resume") {
    return tr("Chạy tiếp một chiến dịch.", "继续一个活动。");
  }
  if (row.action === "staff.availability") {
    return summary.status === "paused" ? tr("Tắt nhận việc mới.", "关闭接收新任务。") : tr("Bật nhận việc mới.", "开启接收新任务。");
  }
  if (row.action === "customers.owner") {
    return summary.status === "cleared" ? tr("Bỏ người giữ hội viên.", "取消会员负责人。") : tr("Gán người giữ hội viên.", "指定会员负责人。");
  }
  if (row.action === "customers.pool") {
    const pool = text(summary.status);
    const nameVi = pool === "kho_data" ? "kho data" : pool === "nuoi_sms" ? "nuôi SMS" : pool === "active" ? "đang chăm sóc" : "";
    const nameZh = pool === "kho_data" ? "数据集中库" : pool === "nuoi_sms" ? "短信养护" : pool === "active" ? "正在关怀" : "";
    return nameVi ? tr(`Chuyển hội viên sang ${nameVi}.`, `将会员转到${nameZh}。`) : tr("Chuyển kho chăm sóc của hội viên.", "转移会员的关怀库。");
  }
  if (row.action === "rewards.approve") {
    const period = text(summary.period);
    return period ? tr(`Duyệt thưởng kỳ ${period}.`, `审批 ${period} 期奖励。`) : tr("Duyệt thưởng.", "审批奖励。");
  }
  if (row.action === "rewards.revoke") {
    const period = text(summary.period);
    return period ? tr(`Gỡ duyệt thưởng kỳ ${period}.`, `取消 ${period} 期奖励审批。`) : tr("Gỡ duyệt thưởng.", "取消奖励审批。");
  }
  if (row.action === "stations.lead") {
    const code = row.entity_id || text(summary.station);
    return code ? tr(`Gắn tổ trưởng cho ${code}.`, `为 ${code} 分配组长。`) : tr("Gắn tổ trưởng hậu đài.", "分配站点组长。");
  }
  if (row.action === "stations.create") {
    const code = row.entity_id || text(summary.station);
    return code ? tr(`Thêm hậu đài ${code}.`, `添加站点 ${code}。`) : tr("Thêm một hậu đài.", "添加一个站点。");
  }
  if (row.action === "stations.update") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    return summary.status === "disabled"
      ? tr(`Tắt hậu đài${name}.`, name ? `停用站点${name}。` : "停用站点。")
      : tr(`Mở lại hậu đài${name}.`, name ? `重新开启站点${name}。` : "重新开启站点。");
  }
  if (row.action === "stations.sms") {
    const code = row.entity_id || text(summary.station);
    return code ? tr(`Cập nhật mẫu tin của ${code}.`, `更新 ${code} 的消息模板。`) : tr("Cập nhật mẫu tin của một đài.", "更新一个站点的消息模板。");
  }
  if (row.action === "sms.test") {
    const who = text(summary.recipient);
    return who ? tr(`Gửi thử SMS tới ${who}.`, `向 ${who} 试发 SMS。`) : tr("Gửi thử SMS.", "试发 SMS。");
  }
  if (row.action === "voice.test") {
    const who = text(summary.recipient);
    return who ? tr(`Gọi thử AI tới ${who}.`, `向 ${who} 试呼 AI。`) : tr("Gọi thử AI.", "试呼 AI。");
  }
  if (row.action === "laaffic.sync") {
    const count = typeof summary.pulled === "number" ? summary.pulled : 0;
    return summary.channel === "ai_voice"
      ? tr(`Đồng bộ ${count} cuộc gọi từ Laaffic.`, `从 Laaffic 同步了 ${count} 通呼叫。`)
      : tr(`Đồng bộ ${count} tin nhắn từ Laaffic.`, `从 Laaffic 同步了 ${count} 条短信。`);
  }
  if (row.action === "stations.logo") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    return summary.status === "cleared"
      ? tr(`Gỡ logo hậu đài${name}.`, name ? `移除站点${name} 的 Logo。` : "移除站点 Logo。")
      : tr(`Đổi logo hậu đài${name}.`, name ? `更换站点${name} 的 Logo。` : "更换站点 Logo。");
  }
  if (row.action === "stations.assign") {
    const code = row.entity_id || text(summary.station);
    const name = code ? ` ${code}` : "";
    const count = Array.isArray(summary.user_ids) ? summary.user_ids.length : 0;
    return count === 0
      ? tr(`Bỏ nhân viên chăm sóc khỏi hậu đài${name}.`, name ? `移除站点${name} 的客服。` : "移除站点的客服。")
      : tr(`Gắn ${count} nhân viên chăm sóc cho hậu đài${name}.`, name ? `为站点${name} 分配 ${count} 名客服。` : `为站点分配 ${count} 名客服。`);
  }
  if (row.action === "settings.rate_limit") {
    const count = numberOf(summary.count);
    return tr(`Cập nhật danh sách IP không bị chặn, còn ${count} địa chỉ.`, `已更新不限制的 IP 列表，现有 ${count} 个地址。`);
  }
  if (row.action === "settings.voice_call") {
    const seconds = numberOf(summary.max_call_seconds);
    return tr(`Đổi thời lượng cuộc gọi AI còn ${seconds} giây.`, `已将 AI 通话时长改为 ${seconds} 秒。`);
  }
  if (row.action === "settings.hangup_sms") {
    const length = numberOf(summary.content_length);
    if (length === 0) {
      return tr("Tắt tin nhắn sau cuộc gọi.", "关闭通话后短信。");
    }
    const fields = numberOf(summary.text_fields);
    return tr(
      `Đổi tin nhắn sau cuộc gọi, nội dung ${length} ký tự và ${fields} biến text.`,
      `已修改通话后短信，内容 ${length} 个字符，${fields} 个文本变量。`,
    );
  }
  if (row.action === "telegram.configure") {
    const username = text(summary.username);
    const name = username ? ` @${username}` : "";
    return summary.status === "disabled"
      ? tr(`Tắt bot Telegram${name}.`, `关闭 Telegram 机器人${name}。`)
      : tr(`Cấu hình bot Telegram${name}.`, `配置 Telegram 机器人${name}。`);
  }
  if (row.action === "auth.step_up" && row.outcome === "failure") {
    return tr("Mật khẩu xác nhận không đúng.", "确认密码不正确。");
  }
  if (row.action === "auth.login" && row.outcome === "failure") {
    const username = text(summary.username);
    return username ? tr(`Đăng nhập thất bại với tên ${username}.`, `用户名 ${username} 登录失败。`) : tr("Đăng nhập thất bại.", "登录失败。");
  }
  if (row.action === "auth.mfa_verify" && row.outcome === "failure") {
    return tr("Mã MFA không đúng.", "MFA 验证码不正确。");
  }
  return auditSentence(row.action, tr) ?? row.action;
}

function describeLog(row: SystemLog, tr: Tr): string {
  const context = row.context;
  if (row.event === "dispatch.completed") {
    const assigned = numberOf(context.assigned);
    const released = numberOf(context.released);
    const partsVi: string[] = [];
    const partsZh: string[] = [];
    if (assigned > 0) {
      partsVi.push(`giao ${assigned} task`);
      partsZh.push(`分配 ${assigned} 个任务`);
    }
    if (released > 0) {
      partsVi.push(`trả ${released} task về hàng chờ`);
      partsZh.push(`将 ${released} 个任务退回队列`);
    }
    return partsVi.length > 0 ? tr(`Đã ${partsVi.join(" và ")}.`, `已${partsZh.join("，并")}。`) : tr("Đã chạy vòng giao task.", "已执行一轮任务分配。");
  }
  if (row.event === "campaign.webhook") {
    const channelVi = text(context.channel) === "ai_voice" ? "gọi AI" : text(context.channel) === "sms" ? "SMS" : "nhà cung cấp";
    const channelZh = text(context.channel) === "ai_voice" ? "AI 呼叫" : text(context.channel) === "sms" ? "SMS" : "供应商";
    if (text(context.outcome) === "rejected") {
      const reason = text(context.reason);
      const whyVi = reason === "bad_signature" ? "chữ ký sai" : reason === "missing_signature" ? "thiếu chữ ký" : reason === "invalid_json" ? "nội dung không đọc được" : "không hợp lệ";
      const whyZh = reason === "bad_signature" ? "签名错误" : reason === "missing_signature" ? "缺少签名" : reason === "invalid_json" ? "内容无法读取" : "无效";
      return tr(`Từ chối báo cáo ${channelVi} vì ${whyVi}.`, `已拒绝${channelZh}报告，因为${whyZh}。`);
    }
    const received = numberOf(context.received);
    const updated = numberOf(context.updated);
    const turns = dialogueCount(context.dialogue);
    const dialogueVi = turns > 0 ? ` Có ${turns} câu hội thoại.` : "";
    const dialogueZh = turns > 0 ? `有 ${turns} 句会话。` : "";
    return tr(`Nhận báo cáo ${channelVi}: ${received} tin, cập nhật ${updated}.${dialogueVi}`, `收到${channelZh}报告：${received} 条，更新 ${updated} 条。${dialogueZh}`);
  }
  if (row.event === "campaign.sent") {
    const failed = numberOf(context.failed);
    const accepted = numberOf(context.accepted);
    return failed > 0
      ? tr(`Gửi chiến dịch: ${accepted} thành công, ${failed} lỗi.`, `发送活动：成功 ${accepted}，失败 ${failed}。`)
      : tr(`Đã gửi ${accepted} tin chiến dịch.`, `已发送 ${accepted} 条活动消息。`);
  }
  if (row.event === "provider.test") {
    return row.message;
  }
  if (row.event === "care.stale") {
    const count = numberOf(context.count);
    return tr(`Có ${count} hội viên quá 15 ngày chưa liên hệ.`, `有 ${count} 名会员超过 15 天未联系。`);
  }
  if (row.event === "telegram.delivered") {
    const failed = numberOf(context.failed);
    const sent = numberOf(context.sent);
    return failed > 0
      ? tr(`Telegram: gửi được ${sent}, lỗi ${failed}.`, `Telegram：已发送 ${sent}，失败 ${failed}。`)
      : tr(`Đã gửi ${sent} tin Telegram.`, `已发送 ${sent} 条 Telegram 消息。`);
  }
  if (row.event === "http.server_error") {
    const method = text(context.method);
    const path = text(context.path);
    const status = numberOf(context.status);
    const where = method && path ? ` ${method} ${path}` : "";
    const reason = text(context.detail);
    const head = status > 0 ? tr(`Lỗi ${status}${where}`, `错误 ${status}${where}`) : row.message || tr("Lỗi máy chủ", "服务器错误");
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

function presentLog(row: SystemLog, tr: Tr): { title: string; method: string | null; path: string | null; status: number | null } {
  const route = readRoute(row);
  return { title: stripRoute(describeLog(row, tr), route, tr), ...route };
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

function stripRoute(sentence: string, route: { method: string | null; path: string | null; status: number | null }, tr: Tr): string {
  let next = sentence;
  if (route.method && route.path) {
    next = next.replace(`${route.method} ${route.path}`, " ");
  }
  if (route.status) {
    next = next.replace(tr(`Lỗi ${route.status}`, `错误 ${route.status}`), " ");
  }
  next = next.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").replace(/\s+\./g, ".");
  return next || sentence;
}

function logScope(event: string, tr: Tr): string {
  if (event.startsWith("http.")) {
    return "API";
  }
  if (event.startsWith("campaign.") || event.startsWith("provider.") || event.startsWith("laaffic.")) {
    return "Laaffic";
  }
  if (event.startsWith("dispatch.")) {
    return tr("Giao việc", "分配");
  }
  if (event.startsWith("chat.")) {
    return "Chat";
  }
  if (event.startsWith("telegram.")) {
    return "Telegram";
  }
  if (event.startsWith("care.")) {
    return tr("Chăm sóc", "关怀");
  }
  return tr("Hệ thống", "系统");
}

function dialogueCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function logTurns(value: unknown, tr: Tr): Array<{ role: string; text: string; at?: string | null }> {
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
    return [{ role: typeof row.role === "string" ? row.role : tr("Khác", "其他"), text, at: typeof row.at === "string" ? row.at : null }];
  });
}

function AuditDetail(props: { row: AuditEvent; names: Map<string, string> }) {
  const tr = useTr();
  const failed = props.row.outcome === "failure";
  const extra = plainRows(props.row.summary, tr);
  return (
    <div className="log-view">
      <section className={failed ? "log-sheet log-sheet--fail" : "log-sheet"}>
        <div className="log-reason__badges">
          <Tag color={failed ? "red" : "green"}>{failed ? tr("Thất bại", "失败") : tr("Thành công", "成功")}</Tag>
          <span className="log-code">{props.row.action}</span>
        </div>
        <p className="log-sheet__title">{describeAudit(props.row, props.names, tr)}</p>
      </section>
      <section className="log-panel">
        <h3>{tr("Thông tin", "信息")}</h3>
        <div className="log-detail">
          <Field label={tr("Thời điểm", "时间")} value={formatStamp(props.row.created_at)} />
          <Field label={tr("Người", "人员")} value={props.row.actor_username || tr("Hệ thống", "系统")} />
          <Field label={tr("Đối tượng", "对象")} value={props.row.entity} />
          <Field label={tr("Mã yêu cầu", "请求编号")} value={props.row.request_id} mono />
        </div>
      </section>
      {extra.length > 0 ? (
        <section className="log-panel">
          <h3>{tr("Ghi thêm", "补充记录")}</h3>
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
  const tr = useTr();
  const view = presentLog(props.row, tr);
  const failed = props.row.level === "error";
  const turns = logTurns(props.row.context.dialogue, tr);
  const extra = plainRows(props.row.context, tr);
  return (
    <div className="log-view">
      <section className={failed ? "log-sheet log-sheet--fail" : "log-sheet"}>
        <div className="log-reason__badges">
          <Tag color={failed ? "red" : "blue"}>{failed ? tr("Lỗi", "错误") : tr("Thông tin", "信息")}</Tag>
          {view.method ? <span className={`log-method log-method--${view.method.toLowerCase()}`}>{view.method}</span> : null}
          {view.status ? <Tag color={view.status >= 500 ? "red" : "default"}>{view.status}</Tag> : null}
          <span className="log-code">{logScope(props.row.event, tr)}</span>
        </div>
        <p className="log-sheet__title">{view.title}</p>
        {view.path ? (
          <p className="log-reason__path">
            <LogPath path={view.path} />
          </p>
        ) : null}
      </section>
      <section className="log-panel">
        <h3>{tr("Thông tin", "信息")}</h3>
        <div className="log-detail">
          <Field label={tr("Thời điểm", "时间")} value={formatStamp(props.row.created_at)} />
          <Field label={tr("Người", "人员")} value={props.row.actor_username || tr("Hệ thống", "系统")} />
          <Field label="IP" value={props.row.ip} mono />
          <Field label={tr("Mã yêu cầu", "请求编号")} value={props.row.request_id} mono />
        </div>
      </section>
      {turns.length > 0 ? (
        <section className="log-panel">
          <h3>{tr("Hội thoại", "会话")}</h3>
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
          <h3>{tr("Ghi thêm", "补充记录")}</h3>
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

function contextLabel(key: string, tr: Tr): string | null {
  if (key === "error_name") return tr("Mã lỗi", "错误码");
  if (key === "channel") return tr("Kênh", "渠道");
  if (key === "outcome") return tr("Kết quả", "结果");
  if (key === "reason") return tr("Lý do", "原因");
  if (key === "received") return tr("Đã nhận", "已接收");
  if (key === "updated") return tr("Đã cập nhật", "已更新");
  if (key === "assigned") return tr("Đã giao", "已分配");
  if (key === "released") return tr("Đã trả hàng chờ", "已退回队列");
  if (key === "failed") return tr("Số lỗi", "失败数");
  if (key === "accepted") return tr("Đã gửi được", "已发送成功");
  if (key === "sent") return tr("Đã gửi", "已发送");
  if (key === "count") return tr("Số lượng", "数量");
  if (key === "idle_minutes") return tr("Số phút im lặng", "无消息分钟数");
  if (key === "max_call_seconds") return tr("Số giây cuộc gọi", "通话秒数");
  if (key === "closed") return tr("Hội thoại đã đóng", "已关闭的会话");
  if (key === "pulled") return tr("Số dòng", "行数");
  if (key === "username") return tr("Tên đăng nhập", "用户名");
  if (key === "ip") return tr("Địa chỉ IP", "IP 地址");
  if (key === "game_account") return tr("Tài khoản", "账号");
  if (key === "site") return tr("Hậu đài", "站点");
  if (key === "status") return tr("Trạng thái", "状态");
  if (key === "label") return tr("Nhãn", "标签");
  return null;
}

const SKIP_CONTEXT = new Set(["path", "method", "detail", "dialogue", "payload", "message", "body", "content"]);

function plainRows(record: Record<string, unknown>, tr: Tr): Array<{ label: string; value: string }> {
  return Object.entries(record).flatMap(([key, value]) => {
    if (SKIP_CONTEXT.has(key) || value == null || value === "" || (key === "status" && typeof value === "number")) {
      return [];
    }
    if (typeof value === "object") {
      return [];
    }
    return [{ label: contextLabel(key, tr) ?? key.replaceAll("_", " "), value: shownValue(key, value, tr) }];
  });
}

function shownValue(key: string, value: unknown, tr: Tr): string {
  if (key === "channel") {
    if (value === "ai_voice") {
      return tr("Gọi AI", "AI 呼叫");
    }
    if (value === "sms") {
      return "SMS";
    }
  }
  if (key === "outcome") {
    if (value === "rejected") {
      return tr("Từ chối", "已拒绝");
    }
    if (value === "accepted") {
      return tr("Đã nhận", "已接收");
    }
  }
  if (key === "reason") {
    if (value === "bad_signature") {
      return tr("Chữ ký sai", "签名错误");
    }
    if (value === "missing_signature") {
      return tr("Thiếu chữ ký", "缺少签名");
    }
    if (value === "invalid_json") {
      return tr("Nội dung không đọc được", "内容无法读取");
    }
  }
  if (typeof value === "boolean") {
    return value ? tr("Có", "是") : tr("Không", "否");
  }
  return String(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
