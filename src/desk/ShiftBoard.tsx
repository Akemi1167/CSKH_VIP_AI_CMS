import { Button, DatePicker, Select, Typography } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { useTr } from "./language.tsx";
import { ErrorAlert } from "../ui.tsx";

type Report = {
  day: string;
  site: string | null;
  touched: number;
  connected: number;
  success: number;
};

export function ShiftBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
    [props.onUnauthorized, props.onMfaSetup],
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được báo cáo ca", "无法加载班次报表"), "");
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
            {tr("Báo cáo ca", "班次报表")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Số hội viên đã liên hệ, khách trả lời và nhãn thành công trong ngày theo giờ Việt Nam.", "按越南时间统计当天已联系的会员、会员回复和成功标签数量。")}</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <DatePicker value={day} allowClear={false} onChange={(value) => value && setDay(value)} />
          <Select
            value={site || "all"}
            style={{ width: 160 }}
            options={[{ value: "all", label: tr("Mọi trang", "全部站点") }, ...stations.map((code) => ({ value: code, label: code }))]}
            onChange={(value: string) => setSite(value === "all" ? "" : value)}
          />
          <Button type="primary" loading={loading} onClick={() => void load(day, site)}>
            {tr("Xem", "查看")}
          </Button>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {report ? (
        <div className="shift-grid">
          <article className="shift-card">
            <p className="shift-card__label">{tr("Đã liên hệ", "已联系")}</p>
            <p className="shift-card__hours">{report.touched}</p>
          </article>
          <article className="shift-card">
            <p className="shift-card__label">{tr("Khách trả lời", "会员回复")}</p>
            <p className="shift-card__hours">{report.connected}</p>
          </article>
          <article className="shift-card">
            <p className="shift-card__label">{tr("Thành công", "成功")}</p>
            <p className="shift-card__hours">{report.success}</p>
          </article>
        </div>
      ) : (
        <p className="page-note">{tr("Chọn ngày rồi bấm Xem.", "选择日期后点击查看。")}</p>
      )}
    </section>
  );
}
