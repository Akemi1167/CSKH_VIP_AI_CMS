import { Button, DatePicker, Drawer, Form, Input, Select, Space, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { CARE_LABELS, careLabelHelp, careLabelName, formatStamp } from "../copy.ts";
import type { VipCustomer } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";

type CareItem = {
  id: string;
  label: string;
  note: string;
  callback_at: string | null;
  created_at: string;
};

type CareList = {
  current_label: string | null;
  items: CareItem[];
};

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "ai_voice", label: "Giọng nói AI" },
] as const;

const POOLS = [
  { value: "active", label: "Đang chăm sóc" },
  { value: "kho_data", label: "Kho data" },
  { value: "nuoi_sms", label: "Nuôi SMS" },
] as const;

export function MemberDrawer(props: {
  customer: VipCustomer;
  canImport: boolean;
  canRevoke: boolean;
  canAssignOwner: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const [care, setCare] = useState<CareList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [label, setLabel] = useState("da_lien_he_lai");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState<Record<string, string>>({});
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [pool, setPool] = useState(props.customer.care_pool);
  const [ownerId, setOwnerId] = useState<string | null>(props.customer.owner_user_id);
  const [owners, setOwners] = useState<{ id: string; display_name: string }[]>([]);
  const [savingCare, setSavingCare] = useState(false);

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
    const result = await api<CareList>(`/api/v1/vip-customers/${props.customer.id}/care-labels`);
    setCare(result);
    setError(null);
  }, [props.customer.id]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    load()
      .catch((caught: unknown) => {
        if (ignore) {
          return;
        }
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được nhãn chăm sóc", "");
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

  useEffect(() => {
    if (!props.canAssignOwner || !props.customer.site) {
      return;
    }
    let ignore = false;
    api<{ items: { code: string; staff: { id: string; display_name: string }[] }[] }>("/api/v1/admin/stations")
      .then((result) => {
        if (ignore) {
          return;
        }
        const station = result.items.find((item) => item.code === props.customer.site);
        setOwners(station?.staff ?? []);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [props.canAssignOwner, props.customer.site]);

  async function savePool(next: "active" | "kho_data" | "nuoi_sms") {
    setSavingCare(true);
    setError(null);
    try {
      const saved = await api<{ care_pool: "active" | "kho_data" | "nuoi_sms" }>(`/api/v1/vip-customers/${props.customer.id}/care-pool`, {
        method: "PUT",
        body: { pool: next },
      });
      setPool(saved.care_pool);
      if (saved.care_pool === "kho_data") {
        setOwnerId(null);
      }
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không chuyển được kho chăm sóc", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSavingCare(false);
    }
  }

  async function saveOwner(next: string | null) {
    setSavingCare(true);
    setError(null);
    try {
      const saved = await api<{ owner_user_id: string | null }>(`/api/v1/vip-customers/${props.customer.id}/owner`, {
        method: "PUT",
        body: { user_id: next },
      });
      setOwnerId(saved.owner_user_id);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gán được người giữ", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSavingCare(false);
    }
  }

  async function saveLabel() {
    const text = note.trim();
    if (text.length === 0) {
      return;
    }
    if (label === "hen_lien_he_lai" && (!when || when.valueOf() <= Date.now())) {
      setError(new ApiError(0, "validation_error", "Giờ hẹn phải ở tương lai", ""));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: { label: string; note: string; callback_at?: string } = { label, note: text };
      if (label === "hen_lien_he_lai" && when) {
        body.callback_at = when.toDate().toISOString();
      }
      await api(`/api/v1/vip-customers/${props.customer.id}/care-labels`, { method: "POST", body });
      setNote("");
      setWhen(null);
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không gắn được nhãn", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveConsent(channel: string, status: "granted" | "revoked") {
    setConsentBusy(`${channel}:${status}`);
    setError(null);
    try {
      await api(`/api/v1/vip-customers/${props.customer.id}/consent`, { method: "POST", body: { channel, status } });
      setConsent((current) => ({ ...current, [channel]: status }));
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không ghi được đồng ý nhận tin", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setConsentBusy(null);
    }
  }

  const choices = CARE_LABELS.filter((item) => props.canRevoke || !item.revoke);
  const title = props.customer.game_account || props.customer.display_name;
  const help = careLabelHelp(label);

  return (
    <Drawer title={props.customer.site ? `${title} · ${props.customer.site}` : title} open width={480} onClose={props.onClose}>
      {error ? <ErrorAlert error={error} /> : null}
      {props.canImport ? (
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Kho chăm sóc" help={pool === "kho_data" ? "Kho data không giữ người phụ trách." : pool === "nuoi_sms" ? "Nuôi SMS không vào chiến dịch giọng nói AI." : undefined}>
            <Select value={pool} loading={savingCare} options={POOLS.map((item) => ({ value: item.value, label: item.label }))} onChange={(value: "active" | "kho_data" | "nuoi_sms") => void savePool(value)} />
          </Form.Item>
          {props.canAssignOwner ? (
            <Form.Item label="Người giữ" help="Chỉ nhân viên chăm sóc của đúng hậu đài.">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Chưa gán"
                disabled={pool === "kho_data"}
                value={ownerId ?? undefined}
                options={[
                  ...owners.map((person) => ({ value: person.id, label: person.display_name })),
                  ...(ownerId && props.customer.owner_name && !owners.some((person) => person.id === ownerId) ? [{ value: ownerId, label: props.customer.owner_name }] : []),
                ]}
                onChange={(value: string | undefined) => void saveOwner(value ?? null)}
              />
            </Form.Item>
          ) : null}
        </Form>
      ) : null}
      <Typography.Text type="secondary">{loading && !care ? "Đang tải nhãn…" : `Nhãn hiện tại: ${care?.current_label ? careLabelName(care.current_label) : "Chưa có"}`}</Typography.Text>
      <div className="task-thread">
        {(care?.items ?? []).map((item) => (
          <p key={item.id} className="page-note">
            <Tag>{careLabelName(item.label)}</Tag> {item.note}
            {item.callback_at ? ` · Hẹn ${formatStamp(item.callback_at)}` : ""} · {formatStamp(item.created_at)}
          </p>
        ))}
        {care && care.items.length === 0 ? <p className="page-note">Chưa có nhãn.</p> : null}
      </div>
      {props.canImport ? (
        <Form layout="vertical" requiredMark={false} onFinish={() => void saveLabel()}>
          <Form.Item label="Nhãn" help={help || undefined}>
            <Select
              value={label}
              options={choices.map((item) => ({ value: item.value, label: item.label }))}
              onChange={(value: string) => {
                setLabel(value);
                if (value !== "hen_lien_he_lai") {
                  setWhen(null);
                }
              }}
            />
          </Form.Item>
          {label === "hen_lien_he_lai" ? (
            <Form.Item label="Giờ hẹn">
              <DatePicker showTime value={when} style={{ width: "100%" }} onChange={(value) => setWhen(value)} />
            </Form.Item>
          ) : null}
          <Form.Item label="Ghi chú">
            <Input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={note.trim().length === 0}>
            Gắn nhãn
          </Button>
        </Form>
      ) : null}
      {props.canImport ? (
        <div className="shift-form">
          <p className="shift-card__label">Đồng ý nhận tin</p>
          {CHANNELS.map((channel) => (
            <div key={channel.value}>
              <Space wrap style={{ marginBottom: 8 }}>
                <Typography.Text>{channel.label}</Typography.Text>
                {consent[channel.value] ? <Tag>{consent[channel.value] === "granted" ? "Đã đồng ý" : "Đã thu hồi"}</Tag> : null}
                <Button size="small" loading={consentBusy === `${channel.value}:granted`} onClick={() => void saveConsent(channel.value, "granted")}>
                  Ghi nhận
                </Button>
                <Button size="small" loading={consentBusy === `${channel.value}:revoked`} onClick={() => void saveConsent(channel.value, "revoked")}>
                  Thu hồi
                </Button>
              </Space>
            </div>
          ))}
          <p className="page-note">Chỉ hiện kết quả vừa ghi trong lần mở này.</p>
        </div>
      ) : null}
    </Drawer>
  );
}
