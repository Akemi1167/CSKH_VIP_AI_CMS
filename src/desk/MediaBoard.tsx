import { CopyOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Modal, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { formatStamp } from "../copy.ts";
import { copyText } from "../password.ts";
import { ErrorAlert } from "../ui.tsx";
import { useTr } from "./language.tsx";
import { trackLibraryUpload } from "./uploadImage.ts";

type MediaItem = {
  id: string;
  key?: string;
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
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function upload(file: File | undefined) {
    if (!file) {
      return;
    }
    setUploading(true);
    setError(null);
    trackLibraryUpload(file, {
      onDone: () => {
        setUploading(false);
        void load().catch((caught: unknown) => {
          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không tải được ảnh", "无法加载图片"), "");
          if (!failAuth(problem)) {
            setError(problem);
          }
        });
      },
      onFail: (problem) => {
        setUploading(false);
        if (!failAuth(problem)) {
          setError(problem);
        }
      },
    });
  }

  async function copyUrl(item: MediaItem) {
    if (!item.url || !(await copyText(item.url))) {
      return;
    }
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId((current) => (current === item.id ? "" : current)), 1500);
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
          <Typography.Text type="secondary">{tr("Tải ảnh thẳng lên kho, rồi chép đường dẫn hoặc chọn lại ở banner.", "图片直接传到仓库，之后可以复制地址，或在横幅里再次选用。")}</Typography.Text>
        </div>
        {props.canWrite ? (
          <div>
            <Button type="primary" icon={<UploadOutlined />} disabled={uploading} onClick={() => fileRef.current?.click()}>
              {tr("Tải ảnh lên", "上传图片")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                upload(file);
              }}
            />
          </div>
        ) : null}
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
              {item.url ? (
                <Button size="small" icon={<CopyOutlined />} onClick={() => void copyUrl(item)}>
                  {copiedId === item.id ? tr("Đã chép", "已复制") : tr("Chép đường dẫn", "复制地址")}
                </Button>
              ) : null}
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
