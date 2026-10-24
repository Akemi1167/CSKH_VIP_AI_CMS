import { Alert } from "antd";
import type { ApiError } from "./api.ts";

export function ErrorAlert(props: { error: ApiError | null }) {
  if (!props.error) {
    return null;
  }
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={props.error.message}
      description={props.error.requestId ? `Mã yêu cầu ${props.error.requestId}` : undefined}
    />
  );
}
