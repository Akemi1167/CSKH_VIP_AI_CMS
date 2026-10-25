import { Button, DatePicker, Select, Typography } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type Report = {
  day: string;
  site: string | null;
  touched: number;
  connected: number;
  success: number;
};

export function ShiftBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [site, setSite] = useState("");
  const [stations, setStations] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
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
    api<{ items: { code: string }[] }>("/api/v1/stations")
      .then((result) => {
        if (!ignore) {
          setStations(result.items.map((item) => item.code));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  async function load(nextDay: Dayjs, nextSite: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ day: nextDay.format("YYYY-MM-DD") });
      if (nextSite) {
        params.set("site", nextSite);
      }
      setReport(await api<Report>(`/api/v1/admin/reports/shift?${params.toString()}`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được báo cáo ca", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Báo cáo ca
          </Typography.Title>
          <Typography.Text type="secondary">Số hội viên đã liên hệ, khách trả lời và nhãn thành công trong ngày theo giờ Việt Nam.</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <DatePicker value={day} allowClear={false} onChange={(value) => value && setDay(value)} />
          <Select
            value={site || "all"}
            style={{ width: 160 }}
            options={[{ value: "all", label: "Mọi trang" }, ...stations.map((code) => ({ value: code, label: code }))]}
            onChange={(value: string) => setSite(value === "all" ? "" : value)}
          />
          <Button type="primary" loading={loading} onClick={() => void load(day, site)}>
            Xem
          </Button>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {report ? (
        <div className="shift-grid">
          <article className="shift-card">
            <p className="shift-card__label">Đã liên hệ</p>
            <p className="shift-card__hours">{report.touched}</p>
          </article>
          <article className="shift-card">
            <p className="shift-card__label">Khách trả lời</p>
            <p className="shift-card__hours">{report.connected}</p>
          </article>
          <article className="shift-card">
            <p className="shift-card__label">Thành công</p>
            <p className="shift-card__hours">{report.success}</p>
          </article>
        </div>
      ) : (
        <p className="page-note">Chọn ngày rồi bấm Xem.</p>
      )}
    </section>
  );
}
