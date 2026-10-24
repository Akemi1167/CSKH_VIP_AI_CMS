import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import type { Staff } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type TaskStatus = "ASSIGNED" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "COMPLETED" | "CANCELLED";

type TaskRow = {
  id: string;
  status: TaskStatus;
  version: number;
  received_at: string;
  customer_ref: string;
  channel: string;
  campaign_name: string | null;
  note: string | null;
  first_response: { state: string; due_at: string | null };
  last_message: { body: string; sender_type: string; created_at: string | null } | null;
};

type TaskDetail = TaskRow & {
  messages: { id: string; sender_type: string; body: string; created_at: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Đã giao",
  IN_PROGRESS: "Đang xử lý",
  WAITING_CUSTOMER: "Chờ khách",
  COMPLETED: "Xong",
  CANCELLED: "Đã hủy",
};

const NEXT_STATUS: Record<string, TaskStatus[]> = {
  ASSIGNED: ["IN_PROGRESS", "WAITING_CUSTOMER", "COMPLETED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "COMPLETED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "COMPLETED"],
};

const SLA_LABEL: Record<string, string> = {
  open: "Đang tính giờ",
  paused: "Tạm dừng",
  met: "Đúng hạn",
  breached: "Trễ",
  unscheduled: "Ngoài ca",
};

type AssignResult = {
  outside_shift: boolean;
  over_capacity: boolean;
};

export function WorkBoard(props: {
  canUpdate: boolean;
  canCancel: boolean;
  canTransfer: boolean;
  canListStaff: boolean;
  selfId: string;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [status, setStatus] = useState<string>("open");
  const [items, setItems] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [reply, setReply] = useState("");
  const [careNote, setCareNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const [reason, setReason] = useState("Chuyển việc");
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

  const load = useCallback(async (nextStatus: string) => {
    const query = nextStatus === "open" ? "" : `?status=${nextStatus}`;
    const result = await api<{ items: TaskRow[] }>(`/api/v1/tasks${query}`);
    setItems(result.items);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load(status)
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được task", "");
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
  }, [failAuth, load, status]);

  async function openTask(id: string) {
    setError(null);
    try {
      const result = await api<TaskDetail>(`/api/v1/tasks/${id}`);
      setDetail(result);
      setReply("");
      setCareNote("");
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không mở được task", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  async function changeStatus(next: TaskStatus) {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/tasks/${detail.id}`, { method: "PATCH", body: { version: detail.version, status: next } });
      await load(status);
      await openTask(detail.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không đổi được trạng thái", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!detail || reply.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const note = careNote.trim();
    try {
      await api(`/api/v1/tasks/${detail.id}/messages`, {
        method: "POST",
        body: note ? { version: detail.version, body: reply.trim(), care_label: "da_lien_he_lai", care_note: note } : { version: detail.version, body: reply.trim() },
      });
      await load(status);
      await openTask(detail.id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gửi được câu trả lời", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  async function openTransfer() {
    setTransferOpen(true);
    setUserId(undefined);
    setReason("Chuyển việc");
    if (!props.canListStaff || staff.length > 0) {
      return;
    }
    try {
      const people = await api<{ items: Staff[] }>("/api/v1/admin/staff");
      setStaff(people.items.filter((person) => person.status === "active" && person.id !== props.selfId && person.roles.some((role) => role === "agent" || role === "team_lead")));
      setStaffLoaded(true);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được nhân viên", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    }
  }

  async function transfer() {
    if (!detail || !userId || reason.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await api<AssignResult>(`/api/v1/tasks/${detail.id}/transfer`, {
        method: "POST",
        body: { version: detail.version, to_user_id: userId, reason_code: reason.trim() },
      });
      const notes: string[] = [];
      if (result.outside_shift) {
        notes.push("Người nhận đang ngoài ca.");
      }
      if (result.over_capacity) {
        notes.push("Người nhận đã đủ 8 hội thoại mở.");
      }
      setWarning(notes.length > 0 ? notes.join(" ") : null);
      setTransferOpen(false);
      setDetail(null);
      await load(status);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không chuyển được task", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<TaskRow> = [
    { title: "Khách", dataIndex: "customer_ref", ellipsis: true },
    { title: "Kênh", dataIndex: "channel", width: 110, render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: "Tin cuối", ellipsis: true, render: (_, row) => row.last_message?.body || "—" },
    { title: "Trạng thái", dataIndex: "status", width: 130, render: (value: string) => STATUS_LABEL[value] ?? value },
    { title: "Hạn trả lời", width: 140, render: (_, row) => SLA_LABEL[row.first_response.state] ?? row.first_response.state },
    { title: "Nhận lúc", dataIndex: "received_at", width: 160, render: (value: string) => formatStamp(value) },
  ];

  const nextStatuses = detail ? (NEXT_STATUS[detail.status] ?? []) : [];
  const open = detail ? nextStatuses.length > 0 : false;

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Việc của tôi
          </Typography.Title>
          <Typography.Text type="secondary">Hội thoại đang giao cho bạn. Bấm một dòng để trả lời.</Typography.Text>
        </div>
        <Space>
          <Select
            value={status}
            style={{ width: 160 }}
            onChange={setStatus}
            options={[
              { value: "open", label: "Đang mở" },
              { value: "ASSIGNED", label: "Đã giao" },
              { value: "IN_PROGRESS", label: "Đang xử lý" },
              { value: "WAITING_CUSTOMER", label: "Chờ khách" },
              { value: "COMPLETED", label: "Xong" },
              { value: "CANCELLED", label: "Đã hủy" },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load(status).catch((caught: unknown) => { const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được task", ""); if (!failAuth(problem)) setError(problem); })}>
            Tải lại
          </Button>
        </Space>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {warning ? <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={warning} /> : null}
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "Không có task." }} onRow={(row) => ({ onClick: () => void openTask(row.id) })} />
      <Drawer title={detail ? detail.customer_ref : "Task"} open={detail !== null} width={480} onClose={() => setDetail(null)}>
        {detail ? (
          <>
            <p className="page-note">
              {detail.channel === "telegram" ? "Telegram" : "Web"}
              {detail.campaign_name ? ` · ${detail.campaign_name}` : ""} · {STATUS_LABEL[detail.status] ?? detail.status}
            </p>
            <div className="task-thread">
              {detail.messages.map((message) => (
                <p key={message.id} className={message.sender_type === "agent" ? "task-line task-line--agent" : "task-line"}>
                  <span>{message.sender_type === "agent" ? "Bạn" : "Khách"}</span>
                  {message.body}
                </p>
              ))}
            </div>
            {props.canUpdate && open ? (
              <Form layout="vertical" requiredMark={false} onFinish={() => void sendReply()}>
                <Form.Item label="Câu trả lời">
                  <Input.TextArea rows={3} value={reply} onChange={(event) => setReply(event.target.value)} />
                </Form.Item>
                <Form.Item label="Ghi chú liên hệ" help="Bắt buộc khi hội thoại đã gắn hội viên.">
                  <Input value={careNote} maxLength={200} onChange={(event) => setCareNote(event.target.value)} />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" htmlType="submit" loading={busy} disabled={reply.trim().length === 0}>
                    Gửi
                  </Button>
                  {nextStatuses.map((next) => (
                    <Button key={next} loading={busy} onClick={() => void changeStatus(next)}>
                      {STATUS_LABEL[next]}
                    </Button>
                  ))}
                  {props.canCancel ? (
                    <Button danger loading={busy} onClick={() => void changeStatus("CANCELLED")}>
                      Hủy
                    </Button>
                  ) : null}
                  {props.canTransfer && props.canListStaff ? (
                    <Button loading={busy} onClick={() => void openTransfer()}>
                      Chuyển
                    </Button>
                  ) : null}
                </Space>
              </Form>
            ) : (
              <Tag>{STATUS_LABEL[detail.status] ?? detail.status}</Tag>
            )}
          </>
        ) : null}
      </Drawer>
      <Modal
        title="Chuyển task"
        open={transferOpen}
        okText="Chuyển"
        confirmLoading={busy}
        okButtonProps={{ disabled: !userId || reason.trim().length === 0 }}
        onOk={() => void transfer()}
        onCancel={() => setTransferOpen(false)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Người nhận" help={staffLoaded && staff.length === 0 ? "Không có nhân viên CSKH hoặc tổ trưởng đang làm." : undefined}>
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
