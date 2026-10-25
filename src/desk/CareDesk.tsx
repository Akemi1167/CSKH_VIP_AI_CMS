import { Button, DatePicker, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { careLabelName, formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";

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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được tổng quan", "");
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
            Tổng quan
          </Typography.Title>
          <Typography.Text type="secondary">Việc đang mở, lịch hẹn và kết quả chăm sóc của bạn trong hôm nay.</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <div className="shift-grid">
        {props.canReadTasks ? (
          <article className="shift-card">
            <p className="shift-card__label">Việc đang mở</p>
            <p className="shift-card__hours">{loading && openTasks === null ? "…" : (openTasks ?? 0)}</p>
          </article>
        ) : null}
        {props.canReadTasks ? (
          <article className="shift-card">
            <p className="shift-card__label">Việc hẹn</p>
            <p className="shift-card__hours">{loading && reminders.length === 0 && !error ? "…" : reminders.length}</p>
          </article>
        ) : null}
        {props.canReport ? (
          <article className="shift-card">
            <p className="shift-card__label">Đã liên hệ hôm nay</p>
            <p className="shift-card__hours">{report?.touched ?? (loading ? "…" : 0)}</p>
          </article>
        ) : null}
        {props.canReport ? (
          <article className="shift-card">
            <p className="shift-card__label">Thành công hôm nay</p>
            <p className="shift-card__hours">{report?.success ?? (loading ? "…" : 0)}</p>
          </article>
        ) : null}
      </div>
      {reminders.length > 0 ? (
        <>
          <Typography.Title level={5}>Sắp đến hạn liên hệ</Typography.Title>
          <Table
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={reminders}
            columns={[
              { title: "Hội viên", dataIndex: "customer_ref", ellipsis: true },
              { title: "Trang", dataIndex: "site", width: 110, render: (value: string | null) => value || "—" },
              { title: "Hẹn", dataIndex: "due_on", width: 140, render: (value: string) => dayLabel(value) },
            ]}
          />
        </>
      ) : null}
    </section>
  );
}

export function ContactBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được liên hệ", "");
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
            Cuộc gọi & liên hệ
          </Typography.Title>
          <Typography.Text type="secondary">Lịch hẹn còn mở và các lần đã liên hệ hoặc hẹn lại.</Typography.Text>
        </div>
        <Button onClick={() => void load().catch(() => undefined)}>Tải lại</Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <Typography.Title level={5}>Việc hẹn</Typography.Title>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        pagination={false}
        dataSource={reminders}
        locale={{ emptyText: loading ? " " : "Không có lịch hẹn." }}
        columns={[
          { title: "Hội viên", dataIndex: "customer_ref", ellipsis: true },
          { title: "Trang", dataIndex: "site", width: 110, render: (value: string | null) => value || "—" },
          { title: "Hẹn", dataIndex: "due_on", width: 140, render: (value: string) => dayLabel(value) },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Đã liên hệ
      </Typography.Title>
      <HistoryTable loading={loading} items={contacts} emptyText="Chưa có lần liên hệ." />
    </section>
  );
}

export function CareHistoryBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được lịch sử", "");
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
            Lịch sử chăm sóc
          </Typography.Title>
          <Typography.Text type="secondary">Nhãn chăm sóc mới nhất. Người có quyền xem hội viên thấy mọi người; còn lại chỉ thấy việc của mình.</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <HistoryTable loading={loading} items={items} emptyText="Chưa có lịch sử." />
    </section>
  );
}

export function PersonalReportBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được báo cáo", "");
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
            Báo cáo cá nhân
          </Typography.Title>
          <Typography.Text type="secondary">Số hội viên bạn đã liên hệ, số lần hẹn và số lần thành công trong ngày.</Typography.Text>
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
          <p className="shift-card__label">Đã liên hệ</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.touched ?? 0)}</p>
        </article>
        <article className="shift-card">
          <p className="shift-card__label">Hẹn liên hệ</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.callbacks ?? 0)}</p>
        </article>
        <article className="shift-card">
          <p className="shift-card__label">Thành công</p>
          <p className="shift-card__hours">{loading && !report ? "…" : (report?.success ?? 0)}</p>
        </article>
      </div>
    </section>
  );
}

function HistoryTable(props: { loading: boolean; items: HistoryItem[]; emptyText: string }) {
  const columns: TableColumnsType<HistoryItem> = [
    { title: "Lúc", dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
    { title: "Tài khoản", ellipsis: true, render: (_, row) => row.game_account || row.customer_ref },
    { title: "Trang", dataIndex: "site", width: 100, render: (value: string | null) => value || "—" },
    { title: "Nhãn", dataIndex: "label", width: 170, render: (value: string) => careLabelName(value) },
    { title: "Ghi chú", dataIndex: "note", ellipsis: true },
    { title: "Người ghi", dataIndex: "actor_name", width: 140, render: (value: string | null) => value || "—" },
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
