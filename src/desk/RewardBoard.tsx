import { ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

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
  const tr = useTr();
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
  const [rules, setRules] = useState<Array<{ title: string; detail: string }>>([]);
  const [rulesBusy, setRulesBusy] = useState(false);

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

  const load = useCallback(async (nextPeriod: string) => {
    const params = new URLSearchParams();
    if (/^[0-9]{4}-[0-9]{2}$/.test(nextPeriod)) {
      params.set("period", nextPeriod);
    }
    const result = await api<{ items: Grant[] }>(`/api/v1/rewards${params.size > 0 ? `?${params.toString()}` : ""}`);
    setItems(result.items);
    setError(null);
  }, []);

  const loadRules = useCallback(async () => {
    const result = await api<{ items: Array<{ title: string; detail: string }> }>("/api/v1/rewards/rules");
    setRules(result.items.map((rule) => ({ title: rule.title, detail: rule.detail })));
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    Promise.all([load(applied), loadRules()])
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được thưởng", "无法加载奖励"), "");
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
  }, [applied, failAuth, load, loadRules]);

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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tìm được hội viên", "无法搜索会员"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  async function approve() {
    if (!customerId || !/^[0-9]{4}-[0-9]{2}$/.test(period)) {
      setError(new ApiError(0, "validation_error", tr("Kỳ thưởng dạng năm-tháng, ví dụ 2026-10", "奖励周期格式为年-月，例如 2026-10"), ""));
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/api/v1/vip-customers/${customerId}/rewards`, { method: "POST", body: { period } });
      setNotice(tr("Đã duyệt thưởng.", "已审批奖励。"));
      setApplied(period.trim());
      await load(period.trim());
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không duyệt được thưởng", "无法审批奖励"), "");
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
      setNotice(tr("Đã gỡ duyệt thưởng.", "已撤销奖励审批。"));
      await load(applied);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gỡ được duyệt thưởng", "无法撤销奖励审批"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    const next = rules.map((rule) => ({ title: rule.title.trim(), detail: rule.detail.trim() })).filter((rule) => rule.title.length > 0 || rule.detail.length > 0);
    setRulesBusy(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api<{ items: Array<{ title: string; detail: string }> }>("/api/v1/rewards/rules", { method: "PUT", body: { rules: next } });
      setRules(saved.items.map((rule) => ({ title: rule.title, detail: rule.detail })));
      setNotice(tr("Đã lưu điều kiện thưởng.", "已保存奖励条件。"));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được điều kiện", "无法保存条件"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setRulesBusy(false);
    }
  }

  const columns: TableColumnsType<Grant> = [
    { title: tr("Tài khoản", "账号"), ellipsis: true, render: (_, row) => row.game_account || row.customer_ref },
    { title: tr("Trang", "站点"), dataIndex: "site", width: 110, render: (site: string | null) => site || "—" },
    { title: tr("Kỳ", "周期"), dataIndex: "period", width: 110 },
    {
      title: tr("Trạng thái", "状态"),
      dataIndex: "status",
      width: 130,
      render: (status: string) => <Tag color={status === "approved" ? "green" : "default"}>{status === "approved" ? tr("Đã duyệt", "已审批") : tr("Đã gỡ", "已撤销")}</Tag>,
    },
    { title: tr("Duyệt lúc", "审批时间"), dataIndex: "approved_at", width: 160, render: (value: string) => formatStamp(value) },
    {
      title: "",
      width: 100,
      render: (_, row) =>
        row.status === "approved" ? (
          <Button size="small" danger loading={busy} onClick={() => void revoke(row.id)}>
            {tr("Gỡ", "撤销")}
          </Button>
        ) : null,
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Thưởng", "奖励")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Gắn nhãn Thành công tạo lần duyệt của tháng hiện tại nếu tháng đó chưa có. Mỗi hội viên một lần duyệt trong tháng.", "标记成功会为当前月份创建审批，若该月已有则不重复。每位会员每月只能审批一次。")}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void Promise.all([load(applied), loadRules()]).catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được thưởng", "无法加载奖励"), ""); if (!failAuth(problem)) setError(problem); })}>
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph type="success">{notice}</Typography.Paragraph> : null}
      <Typography.Title level={5}>{tr("Điều kiện thưởng", "奖励条件")}</Typography.Title>
      <Typography.Paragraph type="secondary">{tr("Bảng để CSVIP đối chiếu. Để trống cho đến khi nhập điều kiện đã công bố.", "供 CSVIP 对照的表。在录入已公布的条件之前保持空白。")}</Typography.Paragraph>
      {rules.map((rule, index) => (
        <div className="filter-bar" key={index}>
          <div className="filter-bar__fields">
            <Input
              value={rule.title}
              maxLength={80}
              placeholder={tr("Tên điều kiện", "条件名称")}
              style={{ width: 220 }}
              onChange={(event) => setRules((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, title: event.target.value } : item)))}
            />
            <Input
              value={rule.detail}
              maxLength={500}
              placeholder={tr("Nội dung", "内容")}
              style={{ width: 420 }}
              onChange={(event) => setRules((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, detail: event.target.value } : item)))}
            />
            <Button onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{tr("Xóa", "删除")}</Button>
          </div>
        </div>
      ))}
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <Button disabled={rules.length >= 20} onClick={() => setRules((current) => [...current, { title: "", detail: "" }])}>{tr("Thêm dòng", "添加一行")}</Button>
          <Button type="primary" loading={rulesBusy} onClick={() => void saveRules()}>{tr("Lưu điều kiện", "保存条件")}</Button>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <Input value={period} maxLength={7} placeholder="2026-10" style={{ width: 120 }} onChange={(event) => setPeriod(event.target.value)} onPressEnter={() => setApplied(period.trim())} />
          {props.canReadCustomers ? (
            <>
              <Input value={query} placeholder={tr("Tài khoản hoặc trang", "账号或站点")} style={{ width: 220 }} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void search()} />
              <Button onClick={() => void search()}>{tr("Tìm hội viên", "搜索会员")}</Button>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={tr("Chọn hội viên", "选择会员")}
                style={{ width: 240 }}
                value={customerId}
                options={matches.map((person) => ({ value: person.id, label: `${person.game_account || person.display_name}${person.site ? ` · ${person.site}` : ""}` }))}
                onChange={setCustomerId}
              />
              <Button type="primary" loading={busy} disabled={!customerId} onClick={() => void approve()}>
                {tr("Duyệt", "审批")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: tr("Chưa có lần duyệt.", "还没有审批记录。") }} />
    </section>
  );
}
