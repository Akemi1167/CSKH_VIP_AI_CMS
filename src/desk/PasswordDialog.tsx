import { Form, Input, Modal } from "antd";
import { useState } from "react";
import { ApiError, api, fieldErrorsFrom, setCsrfToken } from "../api.ts";
import { passwordProblem } from "../password.ts";
import { ErrorAlert } from "../ui.tsx";

export function PasswordDialog(props: { onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    const nextFields: Record<string, string> = {};
    if (!current) {
      nextFields.current_password = "Nhập mật khẩu hiện tại";
    }
    const problem = passwordProblem(next);
    if (problem) {
      nextFields.new_password = problem;
    } else if (next === current) {
      nextFields.new_password = "Mật khẩu mới phải khác mật khẩu hiện tại";
    }
    if (again !== next) {
      nextFields.again = "Mật khẩu nhập lại chưa khớp";
    }
    setFields(nextFields);
    setError(null);
    if (Object.keys(nextFields).length > 0) {
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/auth/password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setCsrfToken("");
      props.onChanged();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không kết nối được máy chủ", "");
      if (apiError.status === 401 && apiError.message.includes("hiện tại")) {
        setFields({ current_password: apiError.message });
        setError(null);
      } else {
        const parsed = fieldErrorsFrom(apiError, ["current_password", "new_password"]);
        setFields(parsed.fields);
        setError(apiError);
      }
      setPending(false);
    }
  }

  return (
    <Modal
      title="Đổi mật khẩu"
      open
      okText="Đổi và đăng xuất"
      cancelText="Để sau"
      confirmLoading={pending}
      maskClosable={!pending}
      closable={!pending}
      onCancel={props.onClose}
      okButtonProps={{ htmlType: "submit", form: "password-form" }}
    >
      <p className="page-note" style={{ marginTop: 0 }}>
        Sau khi đổi, mọi phiên của bạn bị đăng xuất. Bạn đăng nhập lại bằng mật khẩu mới.
      </p>
      <ErrorAlert error={error} />
      <Form id="password-form" layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label="Mật khẩu hiện tại" validateStatus={fields.current_password ? "error" : ""} help={fields.current_password}>
          <Input.Password autoFocus autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Form.Item>
        <Form.Item label="Mật khẩu mới" validateStatus={fields.new_password ? "error" : ""} help={fields.new_password || "Ít nhất 12 ký tự, có chữ và số."}>
          <Input.Password autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Form.Item>
        <Form.Item label="Nhập lại mật khẩu mới" validateStatus={fields.again ? "error" : ""} help={fields.again}>
          <Input.Password autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
