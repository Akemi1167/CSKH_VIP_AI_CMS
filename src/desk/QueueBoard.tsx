import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Select, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { useTr } from "./language.tsx";
import { formatStamp } from "../copy.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type QueueItem = {
  id: string;
  version: number;
  received_at: string;
  customer_ref: string;
  channel: string;
  campaign_name: string | null;
  last_message_body: string | null;
  member?: { site?: string | null } | null;
};

type AssignResult = {
  outside_shift: boolean;
  over_capacity: boolean;
};

export function QueueBoard(props: { canAssign: boolean; canListStaff: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
  const [items, setItems] = useState<QueueItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [target, setTarget] = useState<QueueItem | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [reason, setReason] = useState(() => tr("Giao tay", "手动分配"));
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    const result = await api<{ items: QueueItem[] }>("/api/v1/admin/queues/pending");
    setItems(result.items);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    const staffLoad = props.canListStaff ? api<{ items: Staff[] }>("/api/v1/admin/staff") : Promise.resolve({ items: [] as Staff[] });
    Promise.all([load(), staffLoad])
      .then(([, people]) => {
        if (!ignore) {
          setStaff(people.items.filter((person) => person.status === "active"));
        }
      })
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được hàng chờ", "无法加载队列"), "");
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
  }, [failAuth, load, props.canListStaff]);

  async function assign() {
    if (!target || !userId || reason.trim().length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const result = await api<AssignResult>(`/api/v1/admin/queues/${target.id}/assign`, {
        method: "POST",
        body: { version: target.version, to_user_id: userId, reason_code: reason.trim() },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push(tr("Người nhận đang ngoài ca.", "接收人当前不在班。"));
      }
      if (result.over_capacity) {
        notes.push(tr("Người nhận đã đủ 8 hội thoại mở.", "接收人已有 8 个进行中的会话。"));
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setTarget(null);
      setUserId(undefined);
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không giao được task", "无法分配任务"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<QueueItem> = [
    { title: tr("Khách", "会员"), dataIndex: "customer_ref", ellipsis: true },
    { title: tr("Đài", "站点"), width: 110, render: (_, row) => row.member?.site || "—" },
    { title: tr("Kênh", "渠道"), width: 110, dataIndex: "channel", render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: tr("Chiến dịch", "活动"), dataIndex: "campaign_name", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: tr("Tin cuối", "最后一条消息"), dataIndex: "last_message_body", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: tr("Vào hàng", "入队时间"), dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Hàng chờ", "队列")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Task chưa có người nhận. Worker vẫn tự giao trong ca.", "尚未分配的任务。班次内系统仍会自动分配。")}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load().catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được hàng chờ", "无法加载队列"), ""); if (!failAuth(problem)) setError(problem); })}>
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {warning ? <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={warning} /> : null}
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        locale={{ emptyText: tr("Hàng chờ trống.", "队列是空的。") }}
        onRow={
          props.canAssign
            ? (row) => ({
                onClick: () => {
                  setTarget(row);
                  setUserId(undefined);
                  setReason(tr("Giao tay", "手动分配"));
                },
              })
            : undefined
        }
      />
      <Modal title={tr("Giao task", "分配任务")} open={target !== null} okText={tr("Giao", "分配")} confirmLoading={saving} okButtonProps={{ disabled: !userId || reason.trim().length === 0 }} onOk={() => void assign()} onCancel={() => setTarget(null)}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label={tr("Người nhận", "接收人")}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={tr("Chọn nhân viên", "选择员工")}
              value={userId}
              onChange={setUserId}
              options={staff.map((person) => ({ value: person.id, label: person.display_name }))}
            />
          </Form.Item>
          <Form.Item label={tr("Lý do", "原因")}>
            <Input value={reason} maxLength={64} onChange={(event) => setReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
