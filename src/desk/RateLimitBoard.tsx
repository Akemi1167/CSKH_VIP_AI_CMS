import { Alert, Button, Input, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";

type Policy = {
  ips: string[];
  saved: boolean;
  client_ip: string;
};

export function RateLimitBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [ips, setIps] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const [clientIp, setClientIp] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = ips.join("\n") !== baseline.join("\n");

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
    const result = await api<Policy>("/api/v1/admin/rate-limit");
    setIps(result.ips);
    setBaseline(result.ips);
    setSaved(result.saved);
    setClientIp(result.client_ip);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được danh sách IP", "");
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

  function addIp(value: string) {
    const next = value.trim();
    if (!next || ips.includes(next)) {
      setDraft("");
      return;
    }
    setIps((current) => [...current, next]);
    setDraft("");
    setNotice(null);
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api<Policy>("/api/v1/admin/rate-limit", { method: "PUT", body: { ips } });
      setIps(result.ips);
      setBaseline(result.ips);
      setSaved(true);
      setClientIp(result.client_ip);
      setNotice("Đã lưu. Các địa chỉ này không bị giới hạn request nữa.");
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được danh sách IP", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Không chặn IP
          </Typography.Title>
          <Typography.Text type="secondary">
            Địa chỉ trong danh sách không bị giới hạn 120 request mỗi phút. Đăng nhập sai mật khẩu và mã MFA vẫn bị khóa.
          </Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            Lưu
          </Button>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      {!saved && !loading ? <p className="page-note">Chưa lưu trên CMS. Danh sách dưới đây là mặc định của server. Bấm Lưu để giữ danh sách này.</p> : null}
      <div className="shift-form">
        <p className="shift-card__label">Địa chỉ được bỏ qua</p>
        <div className="rate-ip-list">
          {ips.length === 0 ? <span className="page-note">Chưa có địa chỉ. Mọi IP đều bị đếm.</span> : null}
          {ips.map((ip) => (
            <Tag
              key={ip}
              closable={props.canWrite}
              onClose={(event) => {
                event.preventDefault();
                setIps((current) => current.filter((item) => item !== ip));
              }}
            >
              {ip}
            </Tag>
          ))}
        </div>
        {props.canWrite ? (
          <div className="rate-ip-add">
            <Input
              value={draft}
              placeholder="127.0.0.1 hoặc 10.0.0.0/8"
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={() => addIp(draft)}
            />
            <Button onClick={() => addIp(draft)}>Thêm</Button>
            {clientIp && !ips.includes(clientIp) ? <Button onClick={() => addIp(clientIp)}>Thêm IP của tôi ({clientIp})</Button> : null}
          </div>
        ) : null}
        {clientIp ? <p className="page-note">Request này đang đến từ {clientIp}.</p> : null}
      </div>
    </section>
  );
}
