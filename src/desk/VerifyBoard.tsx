import { ReloadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";

type VerifyItem = {
  id: string;
  version: number;
  received_at: string;
  channel: string;
  reason: "account_unknown" | "account_forgotten";
  attempted_account: string | null;
  last_message_body: string | null;
};

const REASON: Record<VerifyItem["reason"], string> = {
  account_unknown: "Sai tên",
  account_forgotten: "Không nhớ tài khoản",
};

export function VerifyBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const [items, setItems] = useState<VerifyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<VerifyItem | null>(null);
  const [account, setAccount] = useState("");
  const [site, setSite] = useState("");
  const [saving, setSaving] = useState(false);

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
    const result = await api<{ items: VerifyItem[] }>("/api/v1/tasks/verify");
    setItems(result.items);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được hàng xác minh", "");
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

  async function run(work: () => Promise<void>) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không xử lý được hội thoại", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<VerifyItem> = [
    { title: "Lý do", width: 170, dataIndex: "reason", render: (value: VerifyItem["reason"]) => REASON[value] },
    { title: "Tên đã nhập", dataIndex: "attempted_account", render: (value: string | null) => value || "—" },
    { title: "Tin khách", dataIndex: "last_message_body", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: "Kênh", width: 110, dataIndex: "channel", render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: "Vào hàng", width: 160, dataIndex: "received_at", render: (value: string) => formatStamp(value) },
    {
      title: "",
      width: 320,
      render: (_value, row) => (
        <Space>
          <Button
            size="small"
            loading={saving}
            onClick={() =>
              void run(async () => {
                await api(`/api/v1/tasks/${row.id}/verify-claim`, { method: "POST", body: { version: row.version } });
                setNotice("Đã nhận. Mở Hộp thư hỗ trợ để chat với khách.");
              })
            }
          >
            Nhận chat
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              setTarget(row);
              setAccount(row.attempted_account ?? "");
              setSite("");
              setNotice(null);
            }}
          >
            Gắn tài khoản
          </Button>
          <Button
            size="small"
            danger
            loading={saving}
            onClick={() =>
              void run(async () => {
                await api(`/api/v1/tasks/${row.id}/verify-reject`, { method: "POST", body: { version: row.version } });
                setNotice("Đã báo khách không nằm trong danh sách khuyến mãi.");
              })
            }
          >
            Không thuộc KM
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Xác minh tài khoản
          </Typography.Title>
          <Typography.Text type="secondary">
            Khách nhập sai tên hoặc không nhớ tài khoản. Nhận để chat, gắn đúng tài khoản để chuyển về đài, hoặc báo khách không thuộc danh sách khuyến mãi.
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() =>
            void load().catch((caught: unknown) => {
              const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được hàng xác minh", "");
              if (!failAuth(problem)) {
                setError(problem);
              }
            })
          }
        >
          Tải lại
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: "Không có hội thoại cần xác minh." }} />
      <Modal
        title="Gắn tài khoản"
        open={target !== null}
        okText="Chuyển đúng đài"
        confirmLoading={saving}
        okButtonProps={{ disabled: account.trim().length < 3 }}
        onOk={() => {
          if (!target) {
            return;
          }
          const row = target;
          void run(async () => {
            const result = await api<{ game_account: string; site: string }>(`/api/v1/tasks/${row.id}/verify-account`, {
              method: "POST",
              body: { version: row.version, account: account.trim(), site: site.trim() || undefined },
            });
            setTarget(null);
            setNotice(`Đã gắn ${result.game_account} tại đài ${result.site}. Hội thoại sẽ về nhân viên đài đó.`);
          });
        }}
        onCancel={() => setTarget(null)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Tài khoản game">
            <Input value={account} maxLength={32} onChange={(event) => setAccount(event.target.value)} />
          </Form.Item>
          <Form.Item label="Đài" help="Chỉ cần khi tài khoản có ở nhiều đài. Ví dụ J88.">
            <Input value={site} maxLength={16} onChange={(event) => setSite(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
