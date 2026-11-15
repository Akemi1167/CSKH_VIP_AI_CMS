import { Form, Input, Modal } from "antd";
import { useState } from "react";
import { ApiError, api, fieldErrorsFrom, setCsrfToken } from "../api.ts";
import { passwordProblem } from "../password.ts";
import { PASSWORD_TEXT, useDeskLang } from "./language.tsx";
import { ErrorAlert } from "../ui.tsx";

export function PasswordDialog(props: { onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const lang = useDeskLang();

  async function submit() {
    const nextFields: Record<string, string> = {};
    if (!current) {
      nextFields.current_password = PASSWORD_TEXT.currentRequired[lang];
    }
    const problem = passwordProblem(next);
    if (problem) {
      nextFields.new_password = PASSWORD_TEXT.nextRule[lang];
    } else if (next === current) {
      nextFields.new_password = PASSWORD_TEXT.different[lang];
    }
    if (again !== next) {
      nextFields.again = PASSWORD_TEXT.mismatch[lang];
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
      const apiError = caught instanceof ApiError ? caught : new ApiError(0, "network", PASSWORD_TEXT.offline[lang], "");
      if ((apiError.status === 401 || apiError.status === 403) && apiError.message.includes("hiện tại")) {
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
      title={PASSWORD_TEXT.title[lang]}
      open
      okText={PASSWORD_TEXT.ok[lang]}
      cancelText={PASSWORD_TEXT.later[lang]}
      confirmLoading={pending}
      maskClosable={!pending}
      closable={!pending}
      onCancel={props.onClose}
      okButtonProps={{ htmlType: "submit", form: "password-form" }}
    >
      <p className="page-note" style={{ marginTop: 0 }}>
        {PASSWORD_TEXT.note[lang]}
      </p>
      <ErrorAlert error={error} />
      <Form id="password-form" layout="vertical" requiredMark={false} onFinish={() => void submit()}>
        <Form.Item label={PASSWORD_TEXT.current[lang]} validateStatus={fields.current_password ? "error" : ""} help={fields.current_password}>
          <Input.Password autoFocus autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Form.Item>
        <Form.Item label={PASSWORD_TEXT.next[lang]} validateStatus={fields.new_password ? "error" : ""} help={fields.new_password || PASSWORD_TEXT.nextHint[lang]}>
          <Input.Password autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Form.Item>
        <Form.Item label={PASSWORD_TEXT.again[lang]} validateStatus={fields.again ? "error" : ""} help={fields.again}>
          <Input.Password autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
