import { Alert, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";

export function VoiceBoard(props: { canTest: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Gọi AI
          </Typography.Title>
          <Typography.Text type="secondary">Gọi thử một số điện thoại bằng agent Laaffic. Không ghi âm.</Typography.Text>
        </div>
      </div>
      <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />
      {props.canTest ? (
        <TestVoice onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />
      ) : (
        <p className="page-note">Cần quyền chạy chiến dịch để gọi thử.</p>
      )}
    </section>
  );
}

export function TestVoice(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [phone, setPhone] = useState("");
  const [agentId, setAgentId] = useState("");
  const [dimensionId, setDimensionId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    const number = phone.trim();
    const agent = agentId.trim();
    const dimension = dimensionId.trim();
    if (number.length < 8) {
      setFieldError("Cần số điện thoại Việt Nam.");
      return;
    }
    if (!/^\d{1,12}$/.test(agent)) {
      setFieldError("Cần mã agent Laaffic.");
      return;
    }
    if (dimension.length > 0 && !/^\d{1,12}$/.test(dimension)) {
      setFieldError("Mã chiều chỉ gồm số.");
      return;
    }
    setFieldError(null);
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const result = await api<{ provider_ref: string }>("/api/v1/admin/voice/test", {
        method: "POST",
        body: { phone: number, agent_id: agent, ...(dimension ? { dimension_id: dimension } : {}) },
      });
      setPhone("");
      setNotice(`Đã giao cuộc gọi thử. Mã Laaffic: ${result.provider_ref}.`);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gọi được", "");
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
        Gọi thử một số
      </Typography.Title>
      <p className="page-note" style={{ marginTop: 0 }}>
        Một cuộc gọi AI tới số bạn nhập, từ 8 giờ đến 21 giờ giờ Việt Nam. Ghi âm tắt. Mỗi lần cách nhau 30 giây.
      </p>
      <ErrorAlert error={error} />
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Form layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label="Số điện thoại" validateStatus={fieldError ? "error" : ""} help={fieldError || "Nhập số di động, ví dụ 0901234567."}>
          <Input value={phone} maxLength={20} inputMode="tel" autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label="Mã agent Laaffic" help="Lấy trên màn hình agent của Laaffic.">
          <Input value={agentId} inputMode="numeric" onChange={(event) => setAgentId(event.target.value)} />
        </Form.Item>
        <Form.Item label="Mã chiều" help="Để trống nếu agent không dùng chiều.">
          <Input value={dimensionId} inputMode="numeric" onChange={(event) => setDimensionId(event.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={sending} disabled={phone.trim().length === 0 || agentId.trim().length === 0}>
          Gọi thử
        </Button>
      </Form>
    </div>
  );
}
