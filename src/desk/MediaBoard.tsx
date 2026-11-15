import { Button, Modal, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";

type MediaItem = {
  id: string;
  url: string;
  content_type: string;
  size_bytes: number;
  source: string;
  source_label: string;
  created_at: string;
};

type MediaPage = {
  items: MediaItem[];
  next: string | null;
};

export function MediaBoard(props: { canWrite: boolean; onUnauthorized: () => void; onMfaSetup: () => void }) {
  const tr = useTr();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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
    const result = await api<MediaPage>("/api/v1/media");
    setItems(result.items);
    setNext(result.next);
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
        const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được ảnh", "无法加载图片"), "");
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

  async function loadMore() {
    if (!next) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await api<MediaPage>(`/api/v1/media?before=${encodeURIComponent(next)}`);
      setItems((current) => [...current, ...result.items]);
      setNext(result.next);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải thêm được ảnh", "无法加载更多图片"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function remove(item: MediaItem) {
    Modal.confirm({
      title: tr("Xóa ảnh này?", "删除这张图片？"),
      content: tr("Ảnh sẽ mất khỏi kho và khỏi hội thoại.", "图片会从库和会话中移除。"),
      okText: tr("Xóa", "删除"),
      cancelText: tr("Để lại", "保留"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`/api/v1/media/${item.id}`, { method: "DELETE" });
          setItems((current) => current.filter((row) => row.id !== item.id));
        } catch (caught) {
          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không xóa được ảnh", "无法删除图片"), "");
          if (!failAuth(problem)) {
            setError(problem);
          }
        }
      },
    });
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            {tr("Media", "素材")}
          </Typography.Title>
          <Typography.Text type="secondary">{tr("Ảnh khách và nhân viên gửi trong chat, lưu trên kho S3.", "客户和员工在聊天中发送的图片，保存在 S3。")}</Typography.Text>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {loading ? <Typography.Text type="secondary">{tr("Đang tải…", "加载中…")}</Typography.Text> : null}
      {!loading && items.length === 0 ? <Typography.Text type="secondary">{tr("Chưa có ảnh.", "还没有图片。")}</Typography.Text> : null}
      <div className="media-grid">
        {items.map((item) => (
          <article key={item.id} className="media-card">
            {item.url ? <img src={item.url} alt="" /> : <div className="media-card__missing">{tr("Không có đường dẫn", "没有链接")}</div>}
            <div className="media-card__meta">
              <strong>{item.source_label}</strong>
              <span>{formatStamp(item.created_at)}</span>
              <span>{formatSize(item.size_bytes)}</span>
              {props.canWrite ? (
                <Button size="small" danger onClick={() => remove(item)}>
                  {tr("Xóa", "删除")}
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {next ? (
        <Button loading={loadingMore} onClick={() => void loadMore()}>
          {tr("Xem thêm", "查看更多")}
        </Button>
      ) : null}
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
