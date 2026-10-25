import { ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type Grant = {
  id: string;
  customer_id: string;
  customer_ref: string;
  game_account: string | null;
  site: string | null;
  period: string;
  status: string;
  approved_at: string;
};

function currentPeriod(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function RewardBoard(props: { canReadCustomers: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [period, setPeriod] = useState(currentPeriod);
  const [applied, setApplied] = useState(period);
  const [items, setItems] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<VipCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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

  const load = useCallback(async (nextPeriod: string) => {
    const params = new URLSearchParams();
    if (/^[0-9]{4}-[0-9]{2}$/.test(nextPeriod)) {
      params.set("period", nextPeriod);
    }
    const result = await api<{ items: Grant[] }>(`/api/v1/rewards${params.size > 0 ? `?${params.toString()}` : ""}`);
    setItems(result.items);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(applied)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thưởng", "");
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
  }, [applied, failAuth, load]);

  async function search() {
    const q = query.trim();
    if (!props.canReadCustomers || q.length === 0) {
      return;
    }
    setError(null);
    try {
      const result = await api<{ items: VipCustomer[] }>(`/api/v1/vip-customers?q=${encodeURIComponent(q)}`);
      setMatches(result.items);
      setCustomerId(result.items[0]?.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tìm được hội viên", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  async function approve() {
    if (!customerId || !/^[0-9]{4}-[0-9]{2}$/.test(period)) {
      setError(new ApiError(0, "validation_error", "Kỳ thưởng dạng năm-tháng, ví dụ 2026-10", ""));
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/api/v1/vip-customers/${customerId}/rewards`, { method: "POST", body: { period } });
      setNotice("Đã duyệt thưởng.");
      setApplied(period.trim());
      await load(period.trim());
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không duyệt được thưởng", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/api/v1/rewards/${id}/revoke`, { method: "POST", body: {} });
      setNotice("Đã gỡ duyệt thưởng.");
      await load(applied);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gỡ được duyệt thưởng", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<Grant> = [
    { title: "Tài khoản", ellipsis: true, render: (_, row) => row.game_account || row.customer_ref },
    { title: "Trang", dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
    { title: "Kỳ", dataIndex: "period", width: 110 },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 130,
      render: (status: string) => <Tag color={status === "approved" ? "green" : "default"}>{status === "approved" ? "Đã duyệt" : "Đã gỡ"}</Tag>,
    },
    { title: "Duyệt lúc", dataIndex: "approved_at", width: 160, render: (value: string) => formatStamp(value) },
    {
      title: "",
      width: 100,
      render: (_, row) =>
        row.status === "approved" ? (
          <Button size="small" danger loading={busy} onClick={() => void revoke(row.id)}>
            Gỡ
          </Button>
        ) : null,
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Thưởng
          </Typography.Title>
          <Typography.Text type="secondary">Mỗi hội viên một lần duyệt trong tháng. Chỉ duyệt khi nhãn thành công còn hiệu lực.</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load(applied).catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được thưởng", ""); if (!failAuth(problem)) setError(problem); })}>
          Tải lại
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph type="success">{notice}</Typography.Paragraph> : null}
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <Input value={period} maxLength={7} placeholder="2026-10" style={{ width: 120 }} onChange={(event) => setPeriod(event.target.value)} onPressEnter={() => setApplied(period.trim())} />
          {props.canReadCustomers ? (
            <>
              <Input value={query} placeholder="Tài khoản hoặc trang" style={{ width: 220 }} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void search()} />
              <Button onClick={() => void search()}>Tìm hội viên</Button>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn hội viên"
                style={{ width: 240 }}
                value={customerId}
                options={matches.map((person) => ({ value: person.id, label: `${person.game_account || person.display_name}${person.site ? ` · ${person.site}` : ""}` }))}
                onChange={setCustomerId}
              />
              <Button type="primary" loading={busy} disabled={!customerId} onClick={() => void approve()}>
                Duyệt
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "Chưa có lần duyệt." }} />
    </section>
  );
}
