import { useEffect, useState, type ReactNode } from "react";
import type { ApiError } from "./api.ts";
import { copyText } from "./password.ts";

export function ErrorAlert(props: { error: ApiError | null; action?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const requestId = props.error?.requestId ?? "";

  useEffect(() => {
    setCopied(false);
  }, [requestId, props.error?.message]);

  if (!props.error) {
    return null;
  }

  async function copy() {
    const ok = await copyText(requestId);
    if (!ok) {
      return;
    }
    setCopied(true);
  }

  return (
    <div className="notice notice--error" role="alert">
      <p className="notice__text">{props.error.message}</p>
      {requestId ? (
        <button type="button" className="notice__code" aria-label="Sao chép mã yêu cầu" title="Sao chép mã yêu cầu" onClick={() => void copy()}>
          {copied ? "Đã chép" : shortRequestId(requestId)}
        </button>
      ) : null}
      {props.action ? <div className="notice__action">{props.action}</div> : null}
    </div>
  );
}

function shortRequestId(id: string): string {
  const compact = id.replaceAll("-", "");
  return compact.length > 8 ? compact.slice(0, 8) : id;
}
