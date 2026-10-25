import { PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Segmented, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { ImportJob, Page, VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { MemberDrawer } from "./MemberDrawer.tsx";

type StatusFilter = "all" | "active" | "disabled";

type Filters = {
  q: string;
  status: StatusFilter;
  tier: string;
  site: string;
};

const EMPTY_FILTERS: Filters = { q: "", status: "all", tier: "", site: "" };

const IMPORT_ERRORS: Record<string, string> = {
  invalid_phone: "Số điện thoại không hợp lệ",
  invalid_name: "Thiếu tên",
  invalid_account: "Tài khoản game không hợp lệ",
  invalid_site: "Trang game không hợp lệ",
  invalid_ref: "Mã khách không hợp lệ",
  invalid_tier: "VIP không hợp lệ",
  duplicate_phone: "Trùng số",
  duplicate_account: "Trùng tài khoản trên cùng trang",
  duplicate_ref: "Trùng mã",
};

type StaleCustomer = {
  id: string;
  customer_ref: string;
  site: string | null;
  created_at: string;
};

export function CustomerBoard(props: { canImport: boolean; canRevoke: boolean; canAssignOwner: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<VipCustomer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [importing, setImporting] = useState(false);
  const [refreshingJob, setRefreshingJob] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  const [member, setMember] = useState<VipCustomer | null>(null);
  const [view, setView] = useState<"list" | "stale">("list");
  const [stale, setStale] = useState<StaleCustomer[]>([]);

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
    async (nextFilters: Filters, nextCursor?: string) => {
      const params = new URLSearchParams();
      const q = nextFilters.q.trim();
      const tier = nextFilters.tier.trim().toLowerCase();
      if (q) {
        params.set("q", q);
      }
      if (nextFilters.status !== "all") {
        params.set("status", nextFilters.status);
      }
      if (tier) {
        params.set("tier", tier);
      }
      if (nextFilters.site) {
        params.set("site", nextFilters.site);
      }
      if (nextCursor) {
        params.set("cursor", nextCursor);
      }
      const query = params.toString();
      const result = await api<Page<VipCustomer>>(`/api/v1/vip-customers${query ? `?${query}` : ""}`);
      setItems((current) => (nextCursor ? [...current, ...result.items] : result.items));
      setCursor(result.next_cursor);
      setError(null);
    },
    [],
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

  const loadStale = useCallback(async (site: string) => {
    const params = new URLSearchParams();
    if (site) {
      params.set("site", site);
    }
    const result = await api<{ items: StaleCustomer[] }>(`/api/v1/admin/care/stale${params.size > 0 ? `?${params.toString()}` : ""}`);
    setStale(result.items);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    const request = view === "stale" ? loadStale(filters.site) : load(filters);
    request
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", view === "stale" ? "Không tải được hội viên lâu chưa liên hệ" : "Không tải được hội viên", "");
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
  }, [failAuth, filters, load, loadStale, view]);

  async function more() {
    if (!cursor) {
      return;
    }
    setLoadingMore(true);
    try {
      await load(filters, cursor);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được trang sau", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function upload(file: File) {
    if (file.size > 1_048_576) {
      setError(new ApiError(0, "file", "File vượt 1 MB", ""));
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setImporting(true);
    setError(null);
    try {
      const created = await api<ImportJob>("/api/v1/vip-customers/import-jobs", { method: "POST", body });
      setJob(await readJob(created));
      setFilters((current) => ({ ...current }));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không nhập được file", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setImporting(false);
    }
  }

  async function refreshJob() {
    if (!job) {
      return;
    }
    setRefreshingJob(true);
    setError(null);
    try {
      setJob(await api<ImportJob>(`/api/v1/import-jobs/${job.id}`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được kết quả nhập", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setRefreshingJob(false);
    }
  }

  const columns: TableColumnsType<VipCustomer> = [
    { title: "Tài khoản game", ellipsis: true, render: (_, row) => row.game_account || row.display_name },
    { title: "Số", dataIndex: "phone_mask", width: 140 },
    { title: "VIP", dataIndex: "tier", width: 120, render: (tier: string | null) => (tier ? tier.toUpperCase() : "—") },
    { title: "Trang", dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
    {
      title: "Trạng thái",
      dataIndex: "status",
      width: 120,
      render: (status: string) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? "Đang dùng" : "Đã khóa"}</Tag>,
    },
    { title: "Tạo lúc", dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Hội viên VIP
          </Typography.Title>
          <Typography.Text type="secondary">Danh sách khách VIP. Bấm một dòng để xem nhãn chăm sóc và đồng ý nhận tin.</Typography.Text>
        </div>
        {props.canImport ? (
          <div className="page-header__actions">
            <Button icon={<UploadOutlined />} loading={importing} onClick={() => document.getElementById("vip-import")?.click()}>
              Nhập file
            </Button>
            <input
              id="vip-import"
              hidden
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void upload(file);
                }
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Thêm hội viên
            </Button>
          </div>
        ) : null}
      </div>

      <div className="filter-bar">
        <div className="filter-bar__fields">
        <Input
          allowClear
          placeholder="Tài khoản, trang hoặc số đầy đủ"
          value={draft.q}
          onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          onPressEnter={() => setFilters(draft)}
          style={{ width: 240 }}
        />
        <Select
          value={draft.status}
          style={{ width: 140 }}
          options={[
            { value: "all", label: "Mọi trạng thái" },
            { value: "active", label: "Đang dùng" },
            { value: "disabled", label: "Đã khóa" },
          ]}
          onChange={(status: StatusFilter) => setDraft((current) => ({ ...current, status }))}
        />
        <Select
          value={draft.site || "all"}
          style={{ width: 140 }}
          options={[{ value: "all", label: "Mọi trang" }, ...stations.map((code) => ({ value: code, label: code }))]}
          onChange={(site: string) => setDraft((current) => ({ ...current, site: site === "all" ? "" : site }))}
        />
        <Input
          allowClear
          placeholder="VIP"
          value={draft.tier}
          onChange={(event) => setDraft((current) => ({ ...current, tier: event.target.value }))}
          onPressEnter={() => setFilters(draft)}
          style={{ width: 140 }}
        />
        <Segmented
          value={view}
          options={[
            { value: "list", label: "Tất cả" },
            { value: "stale", label: "15 ngày chưa liên hệ" },
          ]}
          onChange={(value) => setView(value as "list" | "stale")}
        />
        <Button type="primary" onClick={() => setFilters(draft)}>
          Lọc
        </Button>
        <Button
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            setFilters(EMPTY_FILTERS);
          }}
        >
          Xóa lọc
        </Button>
        <Button icon={<ReloadOutlined />} aria-label="Tải lại" onClick={() => setFilters((current) => ({ ...current }))} />
        </div>
      </div>

      {error ? <ErrorAlert error={error} /> : null}
      {job ? (
        <Alert
          type={job.skipped_count > 0 ? "warning" : "success"}
          showIcon
          closable
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" loading={refreshingJob} onClick={() => void refreshJob()}>
              Tải lại kết quả
            </Button>
          }
          message={`Đã nhập ${job.created_count}/${job.total_rows} hội viên. Bỏ qua ${job.skipped_count}.`}
          description={
            job.errors.length > 0 ? (
              <ul className="import-errors">
                {job.errors.map((item) => (
                  <li key={`${item.row}-${item.code}`}>
                    Dòng {item.row}: {IMPORT_ERRORS[item.code] ?? item.code}
                  </li>
                ))}
                {job.errors_truncated ? <li>Còn lỗi khác không hiện hết.</li> : null}
              </ul>
            ) : null
          }
          onClose={() => setJob(null)}
        />
      ) : null}

      {view === "stale" ? (
        <Table<StaleCustomer>
          className="staff-table"
          rowKey="id"
          size="middle"
          loading={loading}
          columns={[
            { title: "Mã khách", dataIndex: "customer_ref", ellipsis: true },
            { title: "Trang", dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
            { title: "Tạo lúc", dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
          ]}
          dataSource={stale}
          pagination={false}
          locale={{ emptyText: loading ? " " : "Không có hội viên quá 15 ngày." }}
          onRow={(row) => ({
            onClick: () =>
              setMember({
                id: row.id,
                customer_ref: row.customer_ref,
                display_name: row.customer_ref,
                game_account: null,
                site: row.site,
                phone_mask: "—",
                tier: null,
                status: "active",
                care_pool: "active",
                owner_user_id: null,
                owner_name: null,
                created_at: row.created_at,
              }),
          })}
        />
      ) : (
      <Table<VipCustomer>
        className="staff-table"
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: loading ? " " : "Chưa có hội viên." }}
        onRow={(row) => ({ onClick: () => setMember(row) })}
      />
      )}
      {view === "list" && cursor ? (
        <Button style={{ marginTop: 12 }} loading={loadingMore} onClick={() => void more()}>
          Xem thêm
        </Button>
      ) : null}
      <p className="page-note">File .csv hoặc .xlsx, tối đa 1 MB và 2000 dòng. Dòng đầu là tiêu đề: Tài khoản game, Số điện thoại, VIP, Trang game.</p>

      {member ? (
        <MemberDrawer
          customer={member}
          canImport={props.canImport}
          canRevoke={props.canRevoke}
          canAssignOwner={props.canAssignOwner}
          onClose={() => setMember(null)}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
      {createOpen ? (
        <CreateCustomer
          stations={stations}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setFilters((current) => ({ ...current }));
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
    </section>
  );
}

async function readJob(created: ImportJob): Promise<ImportJob> {
  try {
    return await api<ImportJob>(`/api/v1/import-jobs/${created.id}`);
  } catch {
    return created;
  }
}

function CreateCustomer(props: { stations: string[]; onClose: () => void; onCreated: () => void; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [tier, setTier] = useState("");
  const [site, setSite] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const next = validateCustomer(account, phone, tier, site);
    setFields(next);
    setError(null);
    if (Object.keys(next).length > 0) {
      return;
    }
    setSaving(true);
    try {
      await api<VipCustomer>("/api/v1/vip-customers", {
        method: "POST",
        body: {
          game_account: account.trim(),
          phone: phone.trim(),
          tier: tier.trim().toLowerCase(),
          site: site.trim().toUpperCase(),
        },
      });
      props.onCreated();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không thêm được hội viên", "");
      if (problem.status === 401) {
        props.onUnauthorized();
        return;
      }
      if (problem.code === "mfa_setup_required") {
        props.onMfaSetup();
        return;
      }
      setError(problem);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Thêm hội viên" open centered width={480} confirmLoading={saving} okText="Thêm" cancelText="Đóng" onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="Tài khoản game" validateStatus={fields.game_account ? "error" : ""} help={fields.game_account}>
          <Input value={account} maxLength={32} onChange={(event) => setAccount(event.target.value)} />
        </Form.Item>
        <Form.Item label="Số điện thoại" validateStatus={fields.phone ? "error" : ""} help={fields.phone || "Dạng 0901234567 hoặc +84901234567. Không hiện lại số đầy đủ."}>
          <Input value={phone} maxLength={16} onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label="VIP" validateStatus={fields.tier ? "error" : ""} help={fields.tier || "Ví dụ VIP1."}>
          <Input value={tier} maxLength={32} placeholder="VIP1" onChange={(event) => setTier(event.target.value)} />
        </Form.Item>
        <Form.Item label="Trang game" validateStatus={fields.site ? "error" : ""} help={fields.site || "Ví dụ J88."}>
          <Select
            showSearch
            placeholder="J88"
            value={site || undefined}
            options={props.stations.map((code) => ({ value: code, label: code }))}
            onChange={setSite}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function validateCustomer(account: string, phone: string, tier: string, site: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const username = account.trim();
  const mobile = phone.trim();
  const rank = tier.trim();
  const brand = site.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    fields.game_account = "Tài khoản từ 3 đến 32 ký tự: chữ, số, dấu chấm, gạch";
  }
  if (mobile.length < 9 || mobile.length > 16) {
    fields.phone = "Nhập số di động Việt Nam";
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(rank)) {
    fields.tier = "VIP chỉ gồm chữ, số, gạch ngang hoặc gạch dưới";
  }
  if (!/^[A-Za-z0-9]{2,16}$/.test(brand)) {
    fields.site = "Trang game từ 2 đến 16 chữ hoặc số, ví dụ J88";
  }
  return fields;
}
