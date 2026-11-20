import { Button, DatePicker, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { careLabelName, formatStamp, statusLabel } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type Member = {
  user_id: string;
  display_name: string;
  username: string;
  status: string;
  touched: number;
  touches: number;
  waiting: number;
  supporting: number;
  callbacks: number;
  success: number;
  refused: number;
  silent: number;
  dnc: number;
};

type Line = {
  id: string;
  created_at: string;
  customer_ref: string;
  game_account: string | null;
  site: string | null;
  label: string;
  note: string;
};

type Report = {
  from: string;
  to: string;
  members: Member[];
  lines: Line[];
  truncated: boolean;
};

const COUNT_KEYS = ["touched", "touches", "waiting", "supporting", "callbacks", "success", "refused", "silent", "dnc"] as const;

export function MemberWorkBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
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

  const load = useCallback(async (next: [Dayjs, Dayjs], userId: string | null) => {
    const params = new URLSearchParams({
      from: next[0].format("YYYY-MM-DD"),
      to: next[1].format("YYYY-MM-DD"),
    });
    if (userId) {
      params.set("user_id", userId);
    }
    const result = await api<Report>(`/api/v1/admin/reports/staff-work?${params.toString()}`);
    setReport(result);
    setError(null);
    if (userId && !result.members.some((member) => member.user_id === userId)) {
      setSelectedId(null);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(range, selectedId)
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
  }, [failAuth, load, range, selectedId]);

  const count = (title: string, key: (typeof COUNT_KEYS)[number], width: number): TableColumnsType<Member>[number] => ({
    title,
    dataIndex: key,
    width,
    align: "right",
  });

  const columns: TableColumnsType<Member> = [
    {
      title: tr("Thành viên", "成员"),
      dataIndex: "display_name",
      width: 180,
      fixed: "left",
      render: (value: string, row) => value || row.username,
    },
    { title: tr("Trạng thái", "状态"), dataIndex: "status", width: 110, render: (value: string) => statusLabel(value) },
    count(tr("Đã liên hệ", "已联系"), "touched", 110),
    count(tr("Lần chạm", "触达次数"), "touches", 110),
    count(tr("Chờ phản hồi", "等待回复"), "waiting", 120),
    count(tr("Đang hỗ trợ", "正在处理"), "supporting", 120),
    count(tr("Hẹn", "预约"), "callbacks", 80),
    count(tr("Thành công", "成功"), "success", 100),
    count(tr("Từ chối", "拒绝"), "refused", 90),
    count(tr("Không phản hồi", "无回复"), "silent", 130),
    count(tr("Không liên hệ", "不再联系"), "dnc", 120),
  ];

  const lines: TableColumnsType<Line> = [
    { title: tr("Lúc", "时间"), dataIndex: "created_at", width: 170, render: (value: string) => formatStamp(value) },
    { title: tr("Tài khoản", "账号"), width: 160, ellipsis: true, render: (_, row) => row.game_account || row.customer_ref },
    { title: tr("Đài", "站点"), dataIndex: "site", width: 90, render: (value: string | null) => value || "—" },
    { title: tr("Nhãn", "标签"), dataIndex: "label", width: 170, render: (value: string) => careLabelName(value) },
    { title: tr("Ghi chú", "备注"), dataIndex: "note", ellipsis: true, render: (value: string) => value || "—" },
  ];

  const selected = report?.members.find((member) => member.user_id === selectedId) ?? null;
  const totals = COUNT_KEYS.map((key) => (report?.members ?? []).reduce((sum, member) => sum + member[key], 0));

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Công việc thành viên", "成员工作")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {tr("Nhãn chăm sóc từng nhân viên trong khoảng ngày, theo giờ Việt Nam. Tối đa 31 ngày.", "按越南时间统计每位客服在日期范围内的关怀标签。最多 31 天。")}
          </Typography.Text>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-bar__fields">
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(value) => {
              if (value?.[0] && value[1]) {
                setRange([value[0], value[1]]);
              }
            }}
          />
          <Button
            loading={loading}
            onClick={() =>
              void load(range, selectedId).catch((caught: unknown) => {
                const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được báo cáo", "无法加载报表"), "");
                if (!failAuth(problem)) {
                  setError(problem);
                }
              })
            }
          >
            {tr("Tải lại", "刷新")}
          </Button>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <Table
        className="staff-table"
        rowKey="user_id"
        size="middle"
        loading={loading && !report}
        columns={columns}
        dataSource={report?.members ?? []}
        pagination={false}
        scroll={{ x: 1280 }}
        rowClassName={(row) => (row.user_id === selectedId ? "work-row is-on" : "work-row")}
        onRow={(row) => ({ onClick: () => setSelectedId(row.user_id === selectedId ? null : row.user_id) })}
        locale={{ emptyText: tr("Không có thành viên trong khoảng này.", "这个范围内没有成员。") }}
        summary={() =>
          report && report.members.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>{tr("Tổng", "合计")}</Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              {totals.map((value, index) => (
                <Table.Summary.Cell key={COUNT_KEYS[index]} index={index + 2} align="right">
                  {value}
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          ) : null
        }
      />
      {selected ? (
        <div className="work-detail">
          <Typography.Title level={5}>{selected.display_name || selected.username}</Typography.Title>
          {report?.truncated ? <p className="page-note">{tr("Chỉ hiện 200 việc mới nhất.", "只显示最新 200 条。")}</p> : null}
          <Table
            rowKey="id"
            size="middle"
            loading={loading}
            columns={lines}
            dataSource={report?.lines ?? []}
            pagination={false}
            locale={{ emptyText: tr("Thành viên này chưa ghi việc trong khoảng đã chọn.", "该成员在所选范围内没有记录。") }}
          />
        </div>
      ) : (
        <p className="page-note">{tr("Chọn một thành viên để xem từng việc đã ghi.", "选择一名成员查看每条工作记录。")}</p>
      )}
    </section>
  );
}
