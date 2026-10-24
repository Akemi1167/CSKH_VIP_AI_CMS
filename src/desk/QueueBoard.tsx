import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Select, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
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
};

type AssignResult = {
  outside_shift: boolean;
  over_capacity: boolean;
};

export function QueueBoard(props: { canAssign: boolean; canListStaff: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [target, setTarget] = useState<QueueItem | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [reason, setReason] = useState("Giao tay");
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
    [props],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được hàng chờ", "");
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
        notes.push("Người nhận đang ngoài ca.");
      }
      if (result.over_capacity) {
        notes.push("Người nhận đã đủ 8 hội thoại mở.");
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setTarget(null);
      setUserId(undefined);
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không giao được task", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<QueueItem> = [
    { title: "Khách", dataIndex: "customer_ref", ellipsis: true },
    { title: "Kênh", width: 110, dataIndex: "channel", render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: "Chiến dịch", dataIndex: "campaign_name", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: "Tin cuối", dataIndex: "last_message_body", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: "Vào hàng", dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Hàng chờ
          </Typography.Title>
          <Typography.Text type="secondary">Task chưa có người nhận. Worker vẫn tự giao trong ca.</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load().catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được hàng chờ", ""); if (!failAuth(problem)) setError(problem); })}>
          Tải lại
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
        locale={{ emptyText: "Hàng chờ trống." }}
        onRow={
          props.canAssign
            ? (row) => ({
                onClick: () => {
                  setTarget(row);
                  setUserId(undefined);
                  setReason("Giao tay");
                },
              })
            : undefined
        }
      />
      <Modal title="Giao task" open={target !== null} okText="Giao" confirmLoading={saving} okButtonProps={{ disabled: !userId || reason.trim().length === 0 }} onOk={() => void assign()} onCancel={() => setTarget(null)}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Người nhận">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn nhân viên"
              value={userId}
              onChange={setUserId}
              options={staff.map((person) => ({ value: person.id, label: person.display_name }))}
            />
          </Form.Item>
          <Form.Item label="Lý do">
            <Input value={reason} maxLength={64} onChange={(event) => setReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
