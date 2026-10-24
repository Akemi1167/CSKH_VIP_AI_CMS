import { Alert, Button, Form, Input, Space } from "antd";
import { LoginOutlined } from "@ant-design/icons";
import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { ApiError, api, fieldErrorsFrom, setCsrfToken } from "../api.ts";
import { groupSecret } from "../draft.ts";
import { copyText } from "../password.ts";
import type { UserProfile } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type Step = "credentials" | "verify" | "setup";

type LoginResult =
  | { status: "authenticated"; user: UserProfile }
  | { status: "mfa_setup_required"; user: UserProfile }
  | { status: "mfa_required"; mfa_token: string };

type MfaSetup = {
  secret: string;
  otpauth_url: string;
};

const KNOWN = ["username", "password", "code", "mfa_token"];

export function AuthScreen(props: {
  start: "login" | "mfa_setup";
  notice: string | null;
  noticeTone?: "ok" | "error";
  onReady: () => void;
  onLeave: () => void;
}) {
  const [step, setStep] = useState<Step>(props.start === "mfa_setup" ? "setup" : "credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);

  useEffect(() => {
    setStep(props.start === "mfa_setup" ? "setup" : "credentials");
    setPending(false);
    setError(null);
    setCode("");
  }, [props.start]);

  useEffect(() => {
    if (step !== "setup") {
      return;
    }
    let ignore = false;
    setPending(true);
    setError(null);
    setSetup(null);
    setQr(null);
    api<MfaSetup>("/api/v1/auth/mfa/setup", { method: "POST" })
      .then((result) => {
        if (!ignore) {
          setSetup(result);
        }
      })
      .catch((caught: unknown) => {
        if (!ignore) {
          setError(caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tạo được mã MFA", ""));
        }
      })
      .finally(() => {
        if (!ignore) {
          setPending(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [step, setupAttempt]);

  useEffect(() => {
    if (!setup) {
      return;
    }
    let ignore = false;
    QRCode.toDataURL(setup.otpauth_url, {
      margin: 1,
      width: 196,
      color: { dark: "#0e1016", light: "#ffffff" },
    })
      .then((url) => {
        if (!ignore) {
          setQr(url);
        }
      })
      .catch(() => {
        if (!ignore) {
          setQr(null);
        }
      });
    return () => {
      ignore = true;
    };
  }, [setup]);

  function fail(caught: unknown) {
    const next = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không kết nối được máy chủ", "");
    const parsed = fieldErrorsFrom(next, KNOWN);
    setError(parsed.extra ? new ApiError(next.status, next.code, `${next.message} ${parsed.extra}`, next.requestId) : next);
    setFields(parsed.fields);
    setPending(false);
  }

  async function submitLogin() {
    const nextFields: Record<string, string> = {};
    if (!username.trim()) {
      nextFields.username = "Nhập tên đăng nhập";
    } else if (!/^[A-Za-z0-9._-]{3,64}$/.test(username.trim())) {
      nextFields.username = "Tên đăng nhập từ 3 đến 64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang";
    }
    if (!password) {
      nextFields.password = "Nhập mật khẩu";
    }
    setFields(nextFields);
    setError(null);
    if (Object.keys(nextFields).length > 0) {
      return;
    }
    setPending(true);
    try {
      const result = await api<LoginResult>("/api/v1/auth/login", {
        method: "POST",
        body: { username: username.trim(), password },
      });
      setPassword("");
      if (result.status === "mfa_required") {
        setMfaToken(result.mfa_token);
        setCode("");
        setStep("verify");
        setPending(false);
        return;
      }
      props.onReady();
    } catch (caught) {
      fail(caught);
    }
  }

  async function submitCode(nextCode: string) {
    if (pending || nextCode.length !== 6) {
      return;
    }
    setPending(true);
    setError(null);
    setFields({});
    try {
      if (step === "verify") {
        await api("/api/v1/auth/mfa/verify", {
          method: "POST",
          body: { mfa_token: mfaToken, code: nextCode },
        });
      } else {
        await api("/api/v1/auth/mfa/confirm", {
          method: "POST",
          body: { code: nextCode },
        });
        setSetup(null);
      }
      props.onReady();
    } catch (caught) {
      fail(caught);
    }
  }

  function onCodeChange(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    setFields((current) => ({ ...current, code: "" }));
    if (next.length === 6) {
      void submitCode(next);
    }
  }

  async function copySecret() {
    if (!setup) {
      return;
    }
    const ok = await copyText(setup.secret);
    setCopied(ok);
  }

  async function leave() {
    setPending(true);
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
      setCsrfToken("");
    } catch (caught) {
      if (!(caught instanceof ApiError) || (caught.status !== 401 && caught.status !== 0)) {
        fail(caught);
        return;
      }
    }
    props.onLeave();
  }

  const hint = step === "verify" ? "Mã 6 số từ ứng dụng xác thực. Mã sống 5 phút." : step === "setup" ? "Quét QR rồi nhập 6 số đầu tiên." : null;
  const badge = step === "verify" ? "2FA" : step === "setup" ? "MFA" : "CMS";

  return (
    <LoginFrame>
      <div className="login-shell__brand">
        <strong>CSKH VIP</strong>
        {hint ? <p className="login-shell__hint">{hint}</p> : null}
      </div>
      <div className="login-form-card">
        <span className="login-on-air-badge">{badge}</span>
        {props.notice && step === "credentials" ? (
          <Alert style={{ marginBottom: 16 }} type={props.noticeTone === "error" ? "error" : "success"} showIcon message={props.notice} />
        ) : null}
        <ErrorAlert error={error} />

        {step === "credentials" ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void submitLogin()}>
            <Form.Item label="Tên đăng nhập" validateStatus={fields.username ? "error" : ""} help={fields.username}>
              <Input
                size="large"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setFields((current) => ({ ...current, username: "" }));
                }}
              />
            </Form.Item>
            <Form.Item label="Mật khẩu" validateStatus={fields.password ? "error" : ""} help={fields.password}>
              <Input.Password
                size="large"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFields((current) => ({ ...current, password: "" }));
                }}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" icon={<LoginOutlined />} loading={pending}>
              Đăng nhập
            </Button>
          </Form>
        ) : null}

        {step === "verify" ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void submitCode(code)}>
            <Form.Item label="Mã xác thực" validateStatus={fields.code ? "error" : ""} help={fields.code || "Tải lại trang thì đăng nhập lại từ đầu."}>
              <Input
                size="large"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                placeholder="123456"
                style={{ textAlign: "center", letterSpacing: 8 }}
                onChange={(event) => onCodeChange(event.target.value)}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={pending} disabled={code.length !== 6}>
              Xác nhận
            </Button>
            <Button
              type="link"
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                setStep("credentials");
                setMfaToken("");
                setCode("");
                setError(null);
                setPending(false);
              }}
            >
              Dùng tài khoản khác
            </Button>
          </Form>
        ) : null}

        {step === "setup" ? (
          <Form layout="vertical" requiredMark={false} onFinish={() => void submitCode(code)}>
            <p className="login-shell__hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Quản trị cần mã này mỗi lần đăng nhập. Tải lại trang sẽ tạo mã mới.
            </p>
            {qr ? <img className="qr-frame" src={qr} alt="Mã QR để thêm tài khoản vào ứng dụng xác thực" /> : null}
            {setup ? (
              <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
                <code className="secret-code">{groupSecret(setup.secret)}</code>
                <Button onClick={() => void copySecret()}>{copied ? "Đã chép" : "Chép chuỗi"}</Button>
              </Space>
            ) : (
              <p className="login-shell__hint">{pending ? "Đang tạo mã" : "Chưa có mã"}</p>
            )}
            <Form.Item
              label="Mã 6 số"
              validateStatus={fields.code ? "error" : ""}
              help={fields.code || "Nếu không quét được, nhập chuỗi ở trên vào ứng dụng xác thực."}
            >
              <Input
                size="large"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                disabled={!setup}
                style={{ textAlign: "center", letterSpacing: 8 }}
                onChange={(event) => onCodeChange(event.target.value)}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={pending} disabled={!setup || code.length !== 6}>
              Bật MFA và vào bàn
            </Button>
            <Space style={{ width: "100%", marginTop: 8, justifyContent: "space-between" }}>
              <Button disabled={pending} onClick={() => setSetupAttempt((value) => value + 1)}>
                Tạo mã mới
              </Button>
              <Button disabled={pending} onClick={() => void leave()}>
                Đăng xuất
              </Button>
            </Space>
          </Form>
        ) : null}
      </div>
      <p className="login-shell__footer">Chỉ dành cho nhân sự CSKH VIP.</p>
      <p className="login-shell__footer" style={{ marginTop: 4 }}>
        © {new Date().getFullYear()} CSKH VIP CMS
      </p>
    </LoginFrame>
  );
}

function LoginFrame(props: { children: ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden>
        <div className="login-bg__grid" />
        <div className="login-spotlight" />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        <div className="login-orb login-orb-4" />
        <div className="login-scan-line" />
      </div>
      <div className="login-page__content">
        <div className="login-shell">{props.children}</div>
      </div>
    </div>
  );
}
