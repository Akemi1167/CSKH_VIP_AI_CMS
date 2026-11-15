import { PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Segmented, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { careLabelName, formatStamp } from "../copy.ts";
import type { ImportJob, Page, VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { MemberDrawer } from "./MemberDrawer.tsx";
import { useTr } from "./language.tsx";

type StatusFilter = "all" | "active" | "disabled";

type Filters = {
  q: string;
  status: StatusFilter;
  tier: string;
  site: string;
  reach: "" | "cared" | "uncared" | "call_reached" | "call_missed";
};

const EMPTY_FILTERS: Filters = { q: "", status: "all", tier: "", site: "", reach: "" };

function importError(code: string, tr: (vi: string, zh: string) => string): string {
  switch (code) {
    case "invalid_phone":
      return tr("Số điện thoại không hợp lệ", "手机号无效");
    case "invalid_name":
      return tr("Thiếu tên", "缺少姓名");
    case "invalid_account":
      return tr("Tài khoản game không hợp lệ", "游戏账号无效");
    case "invalid_site":
      return tr("Trang game không hợp lệ", "游戏站点无效");
    case "invalid_ref":
      return tr("Mã khách không hợp lệ", "客户编号无效");
    case "invalid_tier":
      return tr("VIP không hợp lệ", "VIP无效");
    case "duplicate_phone":
      return tr("Trùng số", "手机号重复");
    case "duplicate_account":
      return tr("Trùng tài khoản trên cùng trang", "同一站点账号重复");
    case "duplicate_ref":
      return tr("Trùng mã", "编号重复");
    default:
      return code;
  }
}

type StaleCustomer = {
  id: string;
  customer_ref: string;
  site: string | null;
  created_at: string;
};

export function CustomerBoard(props: { canImport: boolean; canRevoke: boolean; canAssignOwner: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
    [props.onUnauthorized, props.onMfaSetup],
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
      if (nextFilters.reach) {
        params.set("reach", nextFilters.reach);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", view === "stale" ? tr("Không tải được hội viên lâu chưa liên hệ", "无法加载长期未联系的会员") : tr("Không tải được hội viên", "无法加载会员"), "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được trang sau", "无法加载下一页"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function upload(file: File) {
    if (file.size > 1_048_576) {
      setError(new ApiError(0, "file", tr("File vượt 1 MB", "文件超过 1 MB"), ""));
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không nhập được file", "无法导入文件"), "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được kết quả nhập", "无法加载导入结果"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setRefreshingJob(false);
    }
  }

  const columns: TableColumnsType<VipCustomer> = [
    { title: tr("Tài khoản game", "游戏账号"), ellipsis: true, render: (_, row) => row.game_account || row.display_name },
    { title: tr("Số", "号码"), dataIndex: "phone_mask", width: 140 },
    { title: "VIP", dataIndex: "tier", width: 120, render: (tier: string | null) => (tier ? tier.toUpperCase() : "—") },
    { title: tr("Trang", "站点"), dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
    {
      title: tr("Trạng thái", "状态"),
      dataIndex: "status",
      width: 120,
      render: (status: string) => <Tag color={status === "active" ? "green" : "default"}>{status === "active" ? tr("Đang dùng", "使用中") : tr("Đã khóa", "已停用")}</Tag>,
    },
    { title: tr("Chăm sóc", "关怀"), width: 150, render: (_, row) => careTag(row, tr) },
    { title: tr("Gọi", "通话"), width: 140, render: (_, row) => callTag(row.call_reach, tr) },
    { title: tr("Tạo lúc", "创建时间"), dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Hội viên VIP", "VIP会员")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Danh sách khách VIP. Cột chăm sóc và cuộc gọi phân biệt khách đã được chăm với khách chưa gọi được.", "VIP会员列表。关怀和通话列用来区分已关怀的客户和尚未接通的客户。")}</Typography.Text>
        </div>
        {props.canImport ? (
          <div className="page-header__actions">
            <Button icon={<UploadOutlined />} loading={importing} onClick={() => document.getElementById("vip-import")?.click()}>
              {tr("Nhập file", "导入文件")}
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
              {tr("Thêm hội viên", "添加会员")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="filter-bar">
        <div className="filter-bar__fields">
        <Input
          allowClear
          placeholder={tr("Tài khoản, trang hoặc số đầy đủ", "账号、站点或完整号码")}
          value={draft.q}
          onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          onPressEnter={() => setFilters(draft)}
          style={{ width: 240 }}
        />
        <Select
          value={draft.status}
          style={{ width: 140 }}
          options={[
            { value: "all", label: tr("Mọi trạng thái", "全部状态") },
            { value: "active", label: tr("Đang dùng", "使用中") },
            { value: "disabled", label: tr("Đã khóa", "已停用") },
          ]}
          onChange={(status: StatusFilter) => setDraft((current) => ({ ...current, status }))}
        />
        <Select
          value={draft.site || "all"}
          style={{ width: 140 }}
          options={[{ value: "all", label: tr("Mọi trang", "全部站点") }, ...stations.map((code) => ({ value: code, label: code }))]}
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
        <Select
          value={draft.reach || "all"}
          style={{ width: 170 }}
          options={[
            { value: "all", label: tr("Mọi liên hệ", "全部联系") },
            { value: "cared", label: tr("Đã chăm", "已关怀") },
            { value: "uncared", label: tr("Chưa chăm", "未关怀") },
            { value: "call_reached", label: tr("Đã gọi được", "已接通") },
            { value: "call_missed", label: tr("Chưa gọi được", "未接通") },
          ]}
          onChange={(reach: Filters["reach"] | "all") => setDraft((current) => ({ ...current, reach: reach === "all" ? "" : reach }))}
        />
        <Segmented
          value={view}
          options={[
            { value: "list", label: tr("Tất cả", "全部") },
            { value: "stale", label: tr("15 ngày chưa liên hệ", "15天未联系") },
          ]}
          onChange={(value) => setView(value as "list" | "stale")}
        />
        <Button type="primary" onClick={() => setFilters(draft)}>
          {tr("Lọc", "筛选")}
        </Button>
        <Button
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            setFilters(EMPTY_FILTERS);
          }}
        >
          {tr("Xóa lọc", "清除筛选")}
        </Button>
        <Button icon={<ReloadOutlined />} aria-label={tr("Tải lại", "刷新")} onClick={() => setFilters((current) => ({ ...current }))} />
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
              {tr("Tải lại kết quả", "刷新结果")}
            </Button>
          }
          message={tr(`Đã nhập ${job.created_count}/${job.total_rows} hội viên. Bỏ qua ${job.skipped_count}.`, `已导入 ${job.created_count}/${job.total_rows} 名会员，跳过 ${job.skipped_count} 名。`)}
          description={
            job.errors.length > 0 ? (
              <ul className="import-errors">
                {job.errors.map((item) => (
                  <li key={`${item.row}-${item.code}`}>
                    {tr(`Dòng ${item.row}: `, `第 ${item.row} 行：`)}
                    {importError(item.code, tr)}
                  </li>
                ))}
                {job.errors_truncated ? <li>{tr("Còn lỗi khác không hiện hết.", "还有其他错误未全部显示。")}</li> : null}
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
            { title: tr("Mã khách", "客户编号"), dataIndex: "customer_ref", ellipsis: true },
            { title: tr("Trang", "站点"), dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
            { title: tr("Tạo lúc", "创建时间"), dataIndex: "created_at", width: 160, render: (value: string) => formatStamp(value) },
          ]}
          dataSource={stale}
          pagination={false}
          locale={{ emptyText: loading ? " " : tr("Không có hội viên quá 15 ngày.", "没有超过 15 天未联系的会员。") }}
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
                cared: false,
                care_label: null,
                call_reach: "none",
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
        locale={{ emptyText: loading ? " " : tr("Chưa có hội viên.", "还没有会员。") }}
        onRow={(row) => ({ onClick: () => setMember(row) })}
      />
      )}
      {view === "list" && cursor ? (
        <Button style={{ marginTop: 12 }} loading={loadingMore} onClick={() => void more()}>
          {tr("Xem thêm", "查看更多")}
        </Button>
      ) : null}
      <p className="page-note">{tr("File .csv hoặc .xlsx, tối đa 1 MB và 2000 dòng. Dòng đầu là tiêu đề: Tài khoản game, Số điện thoại, VIP, Trang game.", "文件为 .csv 或 .xlsx，最大 1 MB、最多 2000 行。首行是表头：游戏账号、手机号、VIP、游戏站点。")}</p>

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

function careTag(row: VipCustomer, tr: (vi: string, zh: string) => string) {
  if (!row.cared) {
    return <Tag>{tr("Chưa chăm", "未关怀")}</Tag>;
  }
  if (!row.care_label || row.care_label === "da_lien_he_lai" || row.care_label === "go_thanh_cong" || row.care_label === "go_dnc") {
    return <Tag color="green">{tr("Đã chăm", "已关怀")}</Tag>;
  }
  const attention = row.care_label === "khong_phan_hoi" || row.care_label === "khach_tu_choi" || row.care_label === "dnc";
  return <Tag color={attention ? "orange" : "green"}>{careLabelName(row.care_label)}</Tag>;
}

function callTag(reach: VipCustomer["call_reach"], tr: (vi: string, zh: string) => string) {
  if (reach === "reached") {
    return <Tag color="green">{tr("Đã gọi được", "已接通")}</Tag>;
  }
  if (reach === "missed") {
    return <Tag color="orange">{tr("Chưa gọi được", "未接通")}</Tag>;
  }
  return <Tag>{tr("Chưa gọi", "未拨打")}</Tag>;
}

async function readJob(created: ImportJob): Promise<ImportJob> {
  try {
    return await api<ImportJob>(`/api/v1/import-jobs/${created.id}`);
  } catch {
    return created;
  }
}

function CreateCustomer(props: { stations: string[]; onClose: () => void; onCreated: () => void; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [tier, setTier] = useState("");
  const [site, setSite] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const next = validateCustomer(account, phone, tier, site, tr);
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không thêm được hội viên", "无法添加会员"), "");
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
    <Modal title={tr("Thêm hội viên", "添加会员")} open centered width={480} confirmLoading={saving} okText={tr("Thêm", "添加")} cancelText={tr("Đóng", "关闭")} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Tài khoản game", "游戏账号")} validateStatus={fields.game_account ? "error" : ""} help={fields.game_account}>
          <Input value={account} maxLength={32} onChange={(event) => setAccount(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Số điện thoại", "手机号")} validateStatus={fields.phone ? "error" : ""} help={fields.phone || tr("Dạng 0901234567 hoặc +84901234567. Không hiện lại số đầy đủ.", "格式如 0901234567 或 +84901234567。完整号码不会再次显示。")}>
          <Input value={phone} maxLength={16} onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label="VIP" validateStatus={fields.tier ? "error" : ""} help={fields.tier || tr("Ví dụ VIP1.", "例如 VIP1。")}>
          <Input value={tier} maxLength={32} placeholder="VIP1" onChange={(event) => setTier(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Trang game", "游戏站点")} validateStatus={fields.site ? "error" : ""} help={fields.site || tr("Ví dụ J88.", "例如 J88。")}>
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

function validateCustomer(account: string, phone: string, tier: string, site: string, tr: (vi: string, zh: string) => string): Record<string, string> {
  const fields: Record<string, string> = {};
  const username = account.trim();
  const mobile = phone.trim();
  const rank = tier.trim();
  const brand = site.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    fields.game_account = tr("Tài khoản từ 3 đến 32 ký tự: chữ, số, dấu chấm, gạch", "账号为 3 至 32 位：字母、数字、点或横线");
  }
  if (mobile.length < 9 || mobile.length > 16) {
    fields.phone = tr("Nhập số di động Việt Nam", "请输入越南手机号");
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(rank)) {
    fields.tier = tr("VIP chỉ gồm chữ, số, gạch ngang hoặc gạch dưới", "VIP只能包含字母、数字、横线或下划线");
  }
  if (!/^[A-Za-z0-9]{2,16}$/.test(brand)) {
    fields.site = tr("Trang game từ 2 đến 16 chữ hoặc số, ví dụ J88", "游戏站点为 2 至 16 位字母或数字，例如 J88");
  }
  return fields;
}
