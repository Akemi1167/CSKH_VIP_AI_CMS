import { Alert, Button, Form, Input, Modal, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
import { useTr } from "./language.tsx";
import { ErrorAlert } from "../ui.tsx";

type StationSms = {
  code: string;
  body: string;
  destination_url: string | null;
};

export function StationSmsBoard(props: { canWrite: boolean; canTest: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
    [props.onUnauthorized, props.onMfaSetup],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được mẫu tin", "无法加载短信模板"), "");
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
    { title: tr("Đài", "站点"), dataIndex: "code", width: 120 },
    {
      title: tr("Nội dung", "内容"),
      dataIndex: "body",
      ellipsis: true,
      render: (body: string) => body.trim() || tr("Chưa có", "暂无"),
    },
    {
      title: tr("Link đích", "目标链接"),
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
            {tr("Sửa", "编辑")}
          </Button>
        ) : null,
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Tin nhắn theo đài", "按站点的短信")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Mẫu SMS của từng hậu đài. Chiến dịch để trống nội dung sẽ dùng mẫu của đài đó.", "各站点的短信模板。活动内容留空时会使用该站点的模板。")}</Typography.Text>
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
            setNotice(tr(`Đã lưu mẫu tin của ${saved.code}.`, `已保存 ${saved.code} 的短信模板。`));
          }}
          onUnauthorized={props.onUnauthorized}
          onMfaSetup={props.onMfaSetup}
        />
      ) : null}
    </section>
  );
}

function TestSms(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
      setFieldError(tr("Cần số điện thoại Việt Nam.", "请填写越南电话号码。"));
      return;
    }
    if (text.length === 0) {
      setFieldError(tr("Cần nội dung tin.", "请填写短信内容。"));
      return;
    }
    if (text.includes("{link}")) {
      setFieldError(tr("Tin thử không gắn {link}.", "试发短信不能包含 {link}。"));
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
      setNotice(tr(`Đã gửi tin thử. Mã nhà mạng: ${result.provider_ref}.`, `试发短信已发送。运营商编号：${result.provider_ref}。`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gửi được tin thử", "无法发送试发短信"), "");
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
        {tr("Gửi thử một tin", "试发一条短信")}
      </Typography.Title>
      <p className="page-note" style={{ marginTop: 0 }}>
        {tr("Gửi một SMS tới số bạn nhập, từ 8 giờ đến 21 giờ giờ Việt Nam. Mỗi lần cách nhau 30 giây.", "向你输入的号码发送一条短信，时间为越南时间 8 点至 21 点。每次间隔 30 秒。")}
      </p>
      <ErrorAlert error={error} />
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Form layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label={tr("Số điện thoại", "电话号码")} validateStatus={fieldError ? "error" : ""} help={fieldError || tr("Nhập số di động, ví dụ 0901234567.", "输入手机号，例如 0901234567。")}>
          <Input value={phone} maxLength={20} inputMode="tel" autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Nội dung", "内容")}>
          <Input.TextArea rows={3} value={body} maxLength={320} onChange={(event) => setBody(event.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={sending} disabled={phone.trim().length === 0 || body.trim().length === 0}>
          {tr("Gửi thử", "试发")}
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
  const tr = useTr();
  const [body, setBody] = useState(props.template.body);
  const [destination, setDestination] = useState(props.template.destination_url ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const text = body.trim();
    const url = destination.trim();
    if (text.length === 0) {
      setFieldError(tr("Cần nội dung tin.", "请填写短信内容。"));
      return;
    }
    if (text.includes("{link}") && url.length === 0) {
      setFieldError(tr("Nội dung có {link} thì cần link đích https.", "内容包含 {link} 时需要 https 目标链接。"));
      return;
    }
    if (url.length > 0 && !url.startsWith("https://")) {
      setFieldError(tr("Link đích phải bắt đầu bằng https://.", "目标链接必须以 https:// 开头。"));
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được mẫu tin", "无法保存短信模板"), "");
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
    <Modal title={tr(`Tin nhắn ${props.template.code}`, `短信 ${props.template.code}`)} open centered width={520} confirmLoading={saving} okText={tr("Lưu", "保存")} cancelText={tr("Đóng", "关闭")} onCancel={props.onClose} onOk={() => void submit()}>
      <ErrorAlert error={error} />
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={tr("Nội dung", "内容")} validateStatus={fieldError ? "error" : ""} help={fieldError || tr("Viết {link} ở chỗ cần gắn mã chiến dịch. Mẫu mới không đổi chiến dịch đã tạo.", "在需要插入活动码的位置写 {link}。新模板不会改变已创建的活动。")}>
          <Input.TextArea rows={5} value={body} maxLength={1024} onChange={(event) => setBody(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Link đích", "目标链接")}>
          <Input value={destination} maxLength={300} placeholder="https://" onChange={(event) => setDestination(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
