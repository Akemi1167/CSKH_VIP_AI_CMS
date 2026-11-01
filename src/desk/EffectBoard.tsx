import { Button, DatePicker, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type Row = { site: string; touched: number; connected: number; success: number };

export function EffectBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [items, setItems] = useState<Row[]>([]);
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

  const load = useCallback(
    async (next: [Dayjs, Dayjs]) => {
      const from = next[0].format("YYYY-MM-DD");
      const to = next[1].format("YYYY-MM-DD");
      const result = await api<{ items: Row[] }>(`/api/v1/admin/reports/effect?from=${from}&to=${to}`);
      setItems(result.items);
      setError(null);
    },
    [],
  );

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(range)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thống kê", "");
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
  }, [failAuth, load, range]);

  const columns: TableColumnsType<Row> = [
    { title: "Đài", dataIndex: "site", width: 120 },
    { title: "Đã liên hệ", dataIndex: "touched", width: 130 },
    { title: "Khách trả lời", dataIndex: "connected", width: 140 },
    { title: "Thành công", dataIndex: "success", width: 130 },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Thống kê hiệu quả
          </Typography.Title>
          <Typography.Text type="secondary">Đã liên hệ, khách trả lời và nhãn thành công theo đài, giờ Việt Nam. Tối đa 31 ngày.</Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(value) => {
            if (value?.[0] && value[1]) {
              setRange([value[0], value[1]]);
            }
          }}
        />
        <Button loading={loading} onClick={() => void load(range).catch((caught: unknown) => {
          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thống kê", "");
          if (!failAuth(problem)) {
            setError(problem);
          }
        })}>
          Tải lại
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <Table rowKey="site" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "Chưa có đài đang mở." }} />
    </section>
  );
}
