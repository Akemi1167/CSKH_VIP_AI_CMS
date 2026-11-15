import { useEffect, useState, type ReactNode } from "react";
import type { ApiError } from "./api.ts";
import { useTr } from "./desk/language.tsx";
import { copyText } from "./password.ts";

export function ErrorAlert(props: { error: ApiError | null; action?: ReactNode }) {
  const tr = useTr();
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

  const copyLabel = tr("Sao chép mã yêu cầu", "复制请求编号");

  return (
    <div className="notice notice--error" role="alert">
      <p className="notice__text">{props.error.message}</p>
      {requestId ? (
        <button type="button" className="notice__code" aria-label={copyLabel} title={copyLabel} onClick={() => void copy()}>
          {copied ? tr("Đã chép", "已复制") : shortRequestId(requestId)}
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
