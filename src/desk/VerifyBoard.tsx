import { ReloadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type VerifyItem = {
  id: string;
  version: number;
  received_at: string;
  channel: string;
  reason: "account_unknown" | "account_forgotten" | "web_direct";
  attempted_account: string | null;
  last_message_body: string | null;
};

function reasonText(reason: VerifyItem["reason"], tr: (vi: string, zh: string) => string): string {
  if (reason === "account_unknown") {
    return tr("Sai tên", "名称错误");
  }
  if (reason === "account_forgotten") {
    return tr("Không nhớ tài khoản", "不记得账号");
  }
  return tr("Chat web không có link", "网页聊天没有链接");
}

export function VerifyBoard(props: { onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được hàng xác minh", "无法加载验证队列"), "");
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
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không xử lý được hội thoại", "无法处理会话"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumnsType<VerifyItem> = [
    { title: tr("Lý do", "原因"), width: 210, dataIndex: "reason", render: (value: VerifyItem["reason"]) => reasonText(value, tr) },
    { title: tr("Tên đã nhập", "填写的名称"), dataIndex: "attempted_account", render: (value: string | null) => value || "—" },
    { title: tr("Tin khách", "客户消息"), dataIndex: "last_message_body", ellipsis: true, render: (value: string | null) => value || "—" },
    { title: tr("Kênh", "渠道"), width: 110, dataIndex: "channel", render: (value: string) => (value === "telegram" ? "Telegram" : "Web") },
    { title: tr("Vào hàng", "入队时间"), width: 160, dataIndex: "received_at", render: (value: string) => formatStamp(value) },
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
                setNotice(tr("Đã nhận. Mở Hộp thư hỗ trợ để chat với khách.", "已领取。请打开客服收件箱与客户聊天。"));
              })
            }
          >
            {tr("Nhận chat", "领取会话")}
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
            {tr("Gắn tài khoản", "绑定账号")}
          </Button>
          <Button
            size="small"
            danger
            loading={saving}
            onClick={() =>
              void run(async () => {
                await api(`/api/v1/tasks/${row.id}/verify-reject`, { method: "POST", body: { version: row.version } });
                setNotice(tr("Đã báo khách không nằm trong danh sách khuyến mãi.", "已告知客户不在优惠名单中。"));
              })
            }
          >
            {tr("Không thuộc KM", "不属于优惠")}
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
            {tr("Xác minh tài khoản", "账户验证")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {tr("Khách nhập sai tên hoặc không nhớ tài khoản. Nhận để chat, gắn đúng tài khoản để chuyển về đài, hoặc báo khách không thuộc danh sách khuyến mãi.", "客户填错名称或不记得账号。可领取后聊天，绑定正确账号以转回对应站点，或告知客户不在优惠名单中。")}
          </Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() =>
            void load().catch((caught: unknown) => {
              const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được hàng xác minh", "无法加载验证队列"), "");
              if (!failAuth(problem)) {
                setError(problem);
              }
            })
          }
        >
          {tr("Tải lại", "刷新")}
        </Button>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? <Typography.Paragraph>{notice}</Typography.Paragraph> : null}
      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={items} pagination={false} locale={{ emptyText: tr("Không có hội thoại cần xác minh.", "没有需要验证的会话。") }} />
      <Modal
        title={tr("Gắn tài khoản", "绑定账号")}
        open={target !== null}
        okText={tr("Chuyển đúng đài", "转到正确站点")}
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
            setNotice(tr(`Đã gắn ${result.game_account} tại đài ${result.site}. Hội thoại sẽ về nhân viên đài đó.`, `已绑定 ${result.game_account}，站点 ${result.site}。会话将交给该站点的员工。`));
          });
        }}
        onCancel={() => setTarget(null)}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label={tr("Tài khoản game", "游戏账号")}>
            <Input value={account} maxLength={32} onChange={(event) => setAccount(event.target.value)} />
          </Form.Item>
          <Form.Item label={tr("Đài", "站点")} help={tr("Chỉ cần khi tài khoản có ở nhiều đài. Ví dụ J88.", "仅当账号存在于多个站点时填写。例如 J88。")}>
            <Input value={site} maxLength={16} onChange={(event) => setSite(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
