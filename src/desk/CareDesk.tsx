import { Button, DatePicker, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { careLabelName, formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type Reminder = { id: string; customer_ref: string; site: string | null; due_on: string };
type HistoryItem = {
  id: string;
  customer_ref: string;
  game_account: string | null;
  site: string | null;
  label: string;
  note: string;
  callback_at: string | null;
  actor_name: string | null;
  created_at: string;
};
type Personal = { day: string; touched: number; callbacks: number; success: number };

const CONTACT_LABELS = new Set(["da_lien_he_lai", "hen_lien_he_lai"]);

function vietnamToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function dayLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function CareHome(props: { canReadTasks: boolean; canReport: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [openTasks, setOpenTasks] = useState<number | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [report, setReport] = useState<Personal | null>(null);
  const [loading, setLoading] = useState(true);
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
    [props.onUnauthorized, props.onMfaSetup],
  );

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    const jobs: Promise<void>[] = [];
    if (props.canReport) {
      jobs.push(
        api<Personal>(`/api/v1/care/report?day=${vietnamToday()}`).then((result) => {
          if (!ignore) {
            setReport(result);
          }
        }),
      );
    }
    if (props.canReadTasks) {
      jobs.push(
        api<{ items: unknown[] }>("/api/v1/tasks").then((result) => {
          if (!ignore) {
            setOpenTasks(result.items.length);
          }
        }),
        api<{ items: Reminder[] }>("/api/v1/care/callbacks").then((result) => {
          if (!ignore) {
            setReminders(result.items);
          }
        }),
      );
    }
    Promise.all(jobs)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được tổng quan", "无法加载总览"), "");
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
  }, [failAuth, props.canReadTasks, props.canReport]);

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Tổng quan", "总览")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Việc đang mở, lịch hẹn và kết quả chăm sóc của bạn trong hôm nay.", "今天的未完成工作、预约和您的关怀结果。")}</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <div className="shift-grid">
        {props.canReadTasks ? (
          <article className="shift-card">
            <p className="shift-card__label">{tr("Việc đang mở", "未完成")}</p>
            <p className="shift-card__hours">{loading && openTasks === null ? "…" : (openTasks ?? 0)}</p>
          </article>
        ) : null}
        {props.canReadTasks ? (
          <article className="shift-card">
            <p className="shift-card__label">{tr("Việc hẹn", "预约")}</p>
            <p className="shift-card__hours">{loading && reminders.length === 0 && !error ? "…" : reminders.length}</p>
          </article>
        ) : null}
        {props.canReport ? (
          <article className="shift-card">
            <p className="shift-card__label">{tr("Đã liên hệ hôm nay", "今日已联系")}</p>
            <p className="shift-card__hours">{report?.touched ?? (loading ? "…" : 0)}</p>
          </article>
        ) : null}
        {props.canReport ? (
          <article className="shift-card">
            <p className="shift-card__label">{tr("Thành công hôm nay", "今日成功")}</p>
            <p className="shift-card__hours">{report?.success ?? (loading ? "…" : 0)}</p>
          </article>
        ) : null}
      </div>
      {reminders.length > 0 ? (
        <>
          <Typography.Title level={5}>{tr("Sắp đến hạn liên hệ", "即将联系")}</Typography.Title>
          <Table
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={reminders}
            columns={[
              { title: tr("Hội viên", "会员"), dataIndex: "customer_ref", ellipsis: true },
              { title: tr("Trang", "站点"), dataIndex: "site", width: 110, render: (value: string | null) => value || "—" },
              { title: tr("Hẹn", "预约"), dataIndex: "due_on", width: 140, render: (value: string) => dayLabel(value) },
            ]}
          />
        </>
      ) : null}
    </section>
  );
}

export function ContactBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [contacts, setContacts] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    [props.onUnauthorized, props.onMfaSetup],
  );

  const load = useCallback(async () => {
    const [calls, history] = await Promise.all([
      api<{ items: Reminder[] }>("/api/v1/care/callbacks"),
      api<{ items: HistoryItem[] }>("/api/v1/care/history?limit=100"),
    ]);
    setReminders(calls.items);
    setContacts(history.items.filter((item) => CONTACT_LABELS.has(item.label)));
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được liên hệ", "无法加载联系记录"), "");
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

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Cuộc gọi & liên hệ", "通话与联系")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Lịch hẹn còn mở và các lần đã liên hệ hoặc hẹn lại.", "未完成的预约，以及已联系或改约的记录。")}</Typography.Text>
        </div>
        <Button onClick={() => void load().catch(() => undefined)}>{tr("Tải lại", "刷新")}</Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <Typography.Title level={5}>{tr("Việc hẹn", "预约")}</Typography.Title>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        pagination={false}
        dataSource={reminders}
        locale={{ emptyText: loading ? " " : tr("Không có lịch hẹn.", "没有预约。") }}
        columns={[
          { title: tr("Hội viên", "会员"), dataIndex: "customer_ref", ellipsis: true },
          { title: tr("Trang", "站点"), dataIndex: "site", width: 110, render: (value: string | null) => value || "—" },
          { title: tr("Hẹn", "预约"), dataIndex: "due_on", width: 140, render: (value: string) => dayLabel(value) },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {tr("Đã liên hệ", "已联系")}
      </Typography.Title>
      <HistoryTable loading={loading} items={contacts} emptyText={tr("Chưa có lần liên hệ.", "还没有联系记录。")} />
    </section>
  );
}

export function CareHistoryBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
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
    [props.onUnauthorized, props.onMfaSetup],
  );

  useEffect(() => {
    let ignore = false;
    api<{ items: HistoryItem[] }>("/api/v1/care/history?limit=100")
      .then((result) => {
        if (!ignore) {
          setItems(result.items);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được lịch sử", "无法加载记录"), "");
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
  }, [failAuth]);

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Lịch sử chăm sóc", "关怀记录")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Nhãn chăm sóc mới nhất. Người có quyền xem hội viên thấy mọi người; còn lại chỉ thấy việc của mình.", "最新关怀标签。可查看会员的人能看到全部，其他人只看到自己的工作。")}</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <HistoryTable loading={loading} items={items} emptyText={tr("Chưa có lịch sử.", "还没有记录。")} />
    </section>
  );
}

export function PersonalReportBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [day, setDay] = useState<Dayjs>(dayjs(vietnamToday()));
  const [report, setReport] = useState<Personal | null>(null);
  const [loading, setLoading] = useState(true);
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
    [props.onUnauthorized, props.onMfaSetup],
  );

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    api<Personal>(`/api/v1/care/report?day=${day.format("YYYY-MM-DD")}`)
      .then((result) => {
        if (!ignore) {
          setReport(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được báo cáo", "无法加载报表"), "");
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
  }, [day, failAuth]);

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Báo cáo cá nhân", "个人报表")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Số hội viên bạn đã liên hệ, số lần hẹn và số lần thành công trong ngày.", "当天您联系的会员数、预约次数和成功次数。")}</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <DatePicker value={day} allowClear={false} onChange={(value) => value && setDay(value)} />
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <div className="shift-grid">
        <article className="shift-card">
          <p className="shift-card__label">{tr("Đã liên hệ", "已联系")}</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.touched ?? 0)}</p>
        </article>
        <article className="shift-card">
          <p className="shift-card__label">{tr("Hẹn liên hệ", "预约联系")}</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.callbacks ?? 0)}</p>
        </article>
        <article className="shift-card">
          <p className="shift-card__label">{tr("Thành công", "成功")}</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.success ?? 0)}</p>
        </article>
      </div>
    </section>
  );
}

function HistoryTable(props: { loading: boolean; items: HistoryItem[]; emptyText: string }) {
  const tr = useTr();
  const columns: TableColumnsType<HistoryItem> = [
    { title: tr("Lúc", "时间"), dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
    { title: tr("Tài khoản", "账号"), ellipsis: true, render: (_, row) => row.game_account || row.customer_ref },
    { title: tr("Trang", "站点"), dataIndex: "site", width: 100, render: (value: string | null) => value || "—" },
    { title: tr("Nhãn", "标签"), dataIndex: "label", width: 170, render: (value: string) => careLabelName(value) },
    { title: tr("Ghi chú", "备注"), dataIndex: "note", ellipsis: true },
    { title: tr("Người ghi", "记录人"), dataIndex: "actor_name", width: 140, render: (value: string | null) => value || "—" },
  ];
  return (
    <Table
      rowKey="id"
      size="middle"
      loading={props.loading}
      columns={columns}
      dataSource={props.items}
      pagination={false}
      locale={{ emptyText: props.loading ? " " : props.emptyText }}
    />
  );
}
