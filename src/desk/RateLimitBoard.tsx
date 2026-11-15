import { Alert, Button, Input, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type Policy = {
  ips: string[];
  saved: boolean;
  client_ip: string;
};

export function RateLimitBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
    [props.onUnauthorized, props.onMfaSetup],
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được danh sách IP", "无法加载 IP 列表"), "");
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
      setNotice(tr("Đã lưu. Các địa chỉ này không bị giới hạn request và không bị chặn khi giả lập nhiều khách chat.", "已保存。这些地址不受请求次数限制，模拟多名客户聊天时也不会被拦截。"));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được danh sách IP", "无法保存 IP 列表"), "");
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
            {tr("Không chặn IP", "不限制IP")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {tr("Địa chỉ trong danh sách không bị giới hạn 120 request mỗi phút. Cùng địa chỉ mở được nhiều chat khách và gửi tin nhanh, dùng khi giả lập nhiều người. Đăng nhập sai mật khẩu và mã MFA vẫn bị khóa.", "列表中的地址不受每分钟 120 次请求的限制。同一地址可以打开多个客户聊天并快速发消息，用于模拟多人。密码或 MFA 验证码错误时仍会锁定。")}
          </Typography.Text>
        </div>
        {props.canWrite ? (
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
            {tr("Lưu", "保存")}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} /> : null}
      {!saved && !loading ? <p className="page-note">{tr("Chưa lưu trên CMS. Danh sách dưới đây là mặc định của server. Bấm Lưu để giữ danh sách này.", "尚未保存到 CMS。下面的列表是服务器默认值。点击保存以保留此列表。")}</p> : null}
      <div className="shift-form">
        <p className="shift-card__label">{tr("Địa chỉ được bỏ qua", "已排除的地址")}</p>
        <div className="rate-ip-list">
          {ips.length === 0 ? <span className="page-note">{tr("Chưa có địa chỉ. Mọi IP đều bị đếm.", "还没有地址。所有 IP 都会被计数。")}</span> : null}
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
              placeholder={tr("127.0.0.1 hoặc 10.0.0.0/8", "127.0.0.1 或 10.0.0.0/8")}
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={() => addIp(draft)}
            />
            <Button onClick={() => addIp(draft)}>{tr("Thêm", "添加")}</Button>
            {clientIp && !ips.includes(clientIp) ? <Button onClick={() => addIp(clientIp)}>{tr(`Thêm IP của tôi (${clientIp})`, `添加我的 IP（${clientIp}）`)}</Button> : null}
          </div>
        ) : null}
        {clientIp ? <p className="page-note">{tr(`Request này đang đến từ ${clientIp}.`, `此请求来自 ${clientIp}。`)}</p> : null}
      </div>
    </section>
  );
}
