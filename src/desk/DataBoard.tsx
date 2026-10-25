import { Button, Select, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { Page, VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type StationStaff = { id: string; display_name: string };

export function DataBoard(props: {
  mode: "warehouse" | "assign";
  canWrite: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [site, setSite] = useState("");
  const [stations, setStations] = useState<string[]>([]);
  const [staffBySite, setStaffBySite] = useState<Record<string, StationStaff[]>>({});
  const [items, setItems] = useState<VipCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState<string | undefined>();
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

  const load = useCallback(async (nextSite: string) => {
    const params = new URLSearchParams({ status: "active", pool: "kho_data" });
    if (nextSite) {
      params.set("site", nextSite);
    }
    const result = await api<Page<VipCustomer>>(`/api/v1/vip-customers?${params.toString()}`);
    setItems(result.items);
    setSelected([]);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    api<{ items: { code: string }[] }>("/api/v1/stations")
      .then((result) => {
        if (!ignore) {
          setStations(result.items.map((item) => item.code));
        }
      })
      .catch(() => undefined);
    if (props.mode === "assign" && props.canWrite) {
      api<{ items: { code: string; staff: StationStaff[] }[] }>("/api/v1/admin/stations")
        .then((result) => {
          if (ignore) {
            return;
          }
          const next: Record<string, StationStaff[]> = {};
          for (const station of result.items) {
            next[station.code] = station.staff ?? [];
          }
          setStaffBySite(next);
        })
        .catch(() => undefined);
    }
    return () => {
      ignore = true;
    };
  }, [props.canWrite, props.mode]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(site)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được kho data", "");
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
  }, [failAuth, load, site]);

  async function assign() {
    if (!ownerId || selected.length === 0) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      for (const id of selected) {
        await api(`/api/v1/vip-customers/${id}/care-pool`, { method: "PUT", body: { pool: "active" } });
        await api(`/api/v1/vip-customers/${id}/owner`, { method: "PUT", body: { user_id: ownerId } });
      }
      setNotice(`Đã phân bổ ${selected.length} hội viên.`);
      setOwnerId(undefined);
      await load(site);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không phân bổ được data", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
      await load(site).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<VipCustomer> = [
    { title: "Tài khoản", ellipsis: true, render: (_, row) => row.game_account || row.display_name },
    { title: "Số", dataIndex: "phone_mask", width: 140 },
    { title: "VIP", dataIndex: "tier", width: 100, render: (tier: string | null) => (tier ? tier.toUpperCase() : "—") },
    { title: "Trang", dataIndex: "site", width: 110, render: (value: string | null) => value || "—" },
    { title: "Tạo lúc", dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
  ];
  const agents = site ? (staffBySite[site] ?? []) : [];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {props.mode === "warehouse" ? "Kho Data tập trung" : "Phân bổ Data"}
          </Typography.Title>
          <Typography.Text type="secondary">
            {props.mode === "warehouse"
              ? "Hội viên đang ở kho data, chưa có người giữ."
              : "Chọn hội viên trong kho, rồi giao cho nhân viên của đúng hậu đài. Sau khi giao, hội viên về đang chăm sóc."}
          </Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <Select
            value={site || "all"}
            style={{ width: 160 }}
            options={[{ value: "all", label: "Mọi trang" }, ...stations.map((code) => ({ value: code, label: code }))]}
            onChange={(value: string) => {
              setSite(value === "all" ? "" : value);
              setOwnerId(undefined);
            }}
          />
          {props.mode === "assign" && props.canWrite ? (
            <>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Nhân viên nhận"
                style={{ width: 220 }}
                value={ownerId}
                disabled={!site}
                options={agents.map((person) => ({ value: person.id, label: person.display_name }))}
                onChange={setOwnerId}
              />
              <Button type="primary" loading={busy} disabled={!ownerId || selected.length === 0} onClick={() => void assign()}>
                Phân bổ {selected.length > 0 ? selected.length : ""}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph type="success">{notice}</Typography.Paragraph> : null}
      {props.mode === "assign" && props.canWrite && !site ? <p className="page-note">Chọn một trang trước khi phân bổ.</p> : null}
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: loading ? " " : "Kho data trống." }}
        rowSelection={
          props.mode === "assign" && props.canWrite
            ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }
            : undefined
        }
      />
    </section>
  );
}
