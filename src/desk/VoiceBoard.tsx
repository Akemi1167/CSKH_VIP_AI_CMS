import { Alert, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { LaafficWebhooks } from "./LaafficWebhooks.tsx";
import { useTr } from "./language.tsx";

export function VoiceBoard(props: { canTest: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Gọi thử", "试呼")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Gọi thử một số điện thoại bằng agent Laaffic. Cuộc gọi được ghi âm.", "用 Laaffic 坐席试呼一个号码。通话会录音。")}</Typography.Text>
        </div>
      </div>
      <LaafficWebhooks onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />
      {props.canTest ? (
        <TestVoice onUnauthorized={props.onUnauthorized} onMfaSetup={props.onMfaSetup} />
      ) : (
        <p className="page-note">{tr("Cần quyền chạy chiến dịch để gọi thử.", "试呼需要活动执行权限。")}</p>
      )}
    </section>
  );
}

export function TestVoice(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
      setFieldError(tr("Cần số điện thoại Việt Nam.", "请填写越南电话号码。"));
      return;
    }
    if (!/^\d{1,12}$/.test(agent)) {
      setFieldError(tr("Cần mã agent Laaffic.", "请填写 Laaffic 坐席编号。"));
      return;
    }
    if (dimension.length > 0 && !/^\d{1,12}$/.test(dimension)) {
      setFieldError(tr("Mã chiều chỉ gồm số.", "维度编号只能是数字。"));
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
      setNotice(tr(`Đã giao cuộc gọi thử. Mã Laaffic: ${result.provider_ref}.`, `试呼已提交。Laaffic 编号：${result.provider_ref}。`));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không gọi được", "无法呼叫"), "");
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
        {tr("Gọi thử một số", "试呼一个号码")}
      </Typography.Title>
      <p className="page-note" style={{ marginTop: 0 }}>
        {tr("Một cuộc gọi AI tới số bạn nhập, từ 8 giờ đến 23 giờ giờ Việt Nam. Ghi âm bật. Mỗi lần cách nhau 30 giây.", "向你输入的号码发起一通 AI 呼叫，时间为越南时间 8 点至 23 点。已开启录音。每次间隔 30 秒。")}
      </p>
      <ErrorAlert error={error} />
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      <Form layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label={tr("Số điện thoại", "电话号码")} validateStatus={fieldError ? "error" : ""} help={fieldError || tr("Nhập số di động, ví dụ 0901234567.", "输入手机号，例如 0901234567。")}>
          <Input value={phone} maxLength={20} inputMode="tel" autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Mã agent Laaffic", "Laaffic 坐席编号")} help={tr("Lấy trên màn hình agent của Laaffic.", "在 Laaffic 的坐席页面获取。")}>
          <Input value={agentId} inputMode="numeric" onChange={(event) => setAgentId(event.target.value)} />
        </Form.Item>
        <Form.Item label={tr("Mã chiều", "维度编号")} help={tr("Để trống nếu agent không dùng chiều.", "坐席不用维度时留空。")}>
          <Input value={dimensionId} inputMode="numeric" onChange={(event) => setDimensionId(event.target.value)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={sending} disabled={phone.trim().length === 0 || agentId.trim().length === 0}>
          {tr("Gọi thử", "试呼")}
        </Button>
      </Form>
    </div>
  );
}
