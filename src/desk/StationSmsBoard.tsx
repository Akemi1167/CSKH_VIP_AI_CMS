import { Alert, Button, Form, Input, Modal, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
import { ErrorAlert } from "../ui.tsx";

type StationSms = {
  code: string;
  body: string;
  destination_url: string | null;
};

export function StationSmsBoard(props: { canWrite: boolean; canTest: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [items, setItems] = useState<StationSms[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<StationSms | null>(null);

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
    const stations = await api<{ items: { code: string }[] }>("/api/v1/stations");
    const templates = await Promise.all(stations.items.map((station) => api<StationSms>(`/api/v1/stations/${encodeURIComponent(station.code)}/sms`)));
    setItems(templates);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được mẫu tin", "");
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
  }, [failAuth, load]);

  const columns: TableColumnsType<StationSms> = [
    { title: "Đài", dataIndex: "code", width: 120 },
    {
      title: "Nội dung",
      dataIndex: "body",
      ellipsis: true,
      render: (body: string) => body.trim() || "Chưa có",
    },
    {
      title: "Link đích",
      dataIndex: "destination_url",
      width: 240,
      ellipsis: true,
      render: (value: string | null) => value || "—",
    },
    {
      title: "",
      width: 90,
      render: (_, row) =>
        props.canWrite ? (
          <Button size="small" onClick={() => setEditing(row)}>
            Sửa
          </Button>
        ) : null,
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Tin nhắn theo đài
          </Typography.Title>
          <Typography.Text type="secondary">Mẫu SMS của từng hậu đài. Chiến dịch để trống nội dung sẽ dùng mẫu của đài đó.</Typography.Text>
        </div>
      </div>
      <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />
      {props.canTest ? <TestSms onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} /> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Table rowKey="code" columns={columns} dataSource={items} loading={loading} pagination={false} />
      {editing ? (
        <EditSms
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setItems((current) => current.map((item) => (item.code === saved.code ? saved : item)));
            setEditing(null);
            setNotice(`Đã lưu mẫu tin của ${saved.code}.`);
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
    </section>
  );
}

function TestSms(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const number = phone.trim();
    const text = body.trim();
    if (number.length < 8) {
      setFieldError("Cần số điện thoại Việt Nam.");
      return;
    }
    if (text.length === 0) {
      setFieldError("Cần nội dung tin.");
      return;
    }
    if (text.includes("{link}")) {
      setFieldError("Tin thử không gắn {link}.");
      return;
    }
    setFieldError(null);
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const result = await api<{ provider_ref: string }>("/api/v1/admin/sms/test", {
        method: "POST",
        body: { phone: number, body: text },
      });
      setPhone("");
      setNotice(`Đã gửi tin thử. Mã nhà mạng: ${result.provider_ref}.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gửi được tin thử", "");
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
      setSending(false);
    }
  }

  return (
    <div className="shift-form" style={{ marginBottom: 16, maxWidth: 520 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Gửi thử một tin
      </Typography.Title>
      <p className="page-note" style={{ marginTop: 0 }}>
        Gửi một SMS tới số bạn nhập, từ 8 giờ đến 21 giờ giờ Việt Nam. Mỗi lần cách nhau 30 giây.
      </p>
      <ErrorAlert error={error} />
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Form layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label="Số điện thoại" validateStatus={fieldError ? "error" : ""} help={fieldError || "Nhập số di động, ví dụ 0901234567."}>
          <Input value={phone} maxLength={20} inputMode="tel" autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label="Nội dung">
          <Input.TextArea rows={3} value={body} maxLength={320} onChange={(event) => setBody(event.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={sending} disabled={phone.trim().length === 0 || body.trim().length === 0}>
          Gửi thử
        </Button>
      </Form>
    </div>
  );
}

function EditSms(props: {
  template: StationSms;
  onClose: () => void;
  onSaved: (template: StationSms) => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [body, setBody] = useState(props.template.body);
  const [destination, setDestination] = useState(props.template.destination_url ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const text = body.trim();
    const url = destination.trim();
    if (text.length === 0) {
      setFieldError("Cần nội dung tin.");
      return;
    }
    if (text.includes("{link}") && url.length === 0) {
      setFieldError("Nội dung có {link} thì cần link đích https.");
      return;
    }
    if (url.length > 0 && !url.startsWith("https://")) {
      setFieldError("Link đích phải bắt đầu bằng https://.");
      return;
    }
    setFieldError(null);
    setError(null);
    setSaving(true);
    try {
      const saved = await api<StationSms>(`/api/v1/stations/${encodeURIComponent(props.template.code)}/sms`, {
        method: "PUT",
        body: { body: text, destination_url: url.length > 0 ? url : null },
      });
      props.onSaved(saved);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được mẫu tin", "");
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
    <Modal title={`Tin nhắn ${props.template.code}`} open centered width={520} confirmLoading={saving} okText="Lưu" cancelText="Đóng" onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="Nội dung" validateStatus={fieldError ? "error" : ""} help={fieldError || "Viết {link} ở chỗ cần gắn mã chiến dịch. Mẫu mới không đổi chiến dịch đã tạo."}>
          <Input.TextArea rows={5} value={body} maxLength={1024} onChange={(event) => setBody(event.target.value)} />
        </Form.Item>
        <Form.Item label="Link đích">
          <Input value={destination} maxLength={300} placeholder="https://" onChange={(event) => setDestination(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
