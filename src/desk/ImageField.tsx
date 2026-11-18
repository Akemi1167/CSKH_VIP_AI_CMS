import { CopyOutlined, ExportOutlined, FolderOpenOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Modal } from "antd";
import { useRef, useState } from "react";
import { ApiError, api, toApiUrl } from "../api.ts";
import { copyText } from "../password.ts";
import { useTr } from "./language.tsx";
import { trackLibraryUpload, type LibraryImage } from "./uploadImage.ts";

type LibraryPage = {
  items: { id: string; key: string; url: string }[];
  next: string | null;
};

export function ImageField(props: {
  url: string;
  disabled?: boolean;
  onChange: (next: { url: string; key: string | null }) => void;
  onError?: (error: ApiError) => void;
}) {
  const tr = useTr();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [localPreview, setLocalPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const publicUrl = props.url ? toApiUrl(props.url) : "";
  const shown = localPreview || publicUrl;

  function choose(file: File | undefined) {
    if (!file || props.disabled || uploading) {
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setUploading(true);
    setProgress(0);
    trackLibraryUpload(file, {
      onProgress: (percent) => {
        if (requestRef.current === request) {
          setProgress(percent);
        }
      },
      onDone: (image) => {
        URL.revokeObjectURL(preview);
        if (requestRef.current !== request) {
          return;
        }
        setUploading(false);
        setProgress(100);
        setLocalPreview("");
        props.onChange({ url: image.url, key: image.key });
      },
      onFail: (error) => {
        URL.revokeObjectURL(preview);
        if (requestRef.current !== request) {
          return;
        }
        setUploading(false);
        setLocalPreview("");
        props.onError?.(error);
      },
    });
  }

  async function copyUrl() {
    if (!publicUrl) {
      return;
    }
    const ok = await copyText(publicUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="image-field">
      <div className="image-field__row">
        <div className="image-field__preview">
          {shown ? (
            <button type="button" onClick={() => setZoom(true)}>
              <img alt="" src={shown} />
            </button>
          ) : (
            <span>{tr("Chưa có ảnh", "还没有图片")}</span>
          )}
          {shown && !props.disabled ? (
            <button
              type="button"
              className="image-field__clear"
              aria-label={tr("Gỡ ảnh", "移除图片")}
              onClick={() => {
                requestRef.current += 1;
                setUploading(false);
                setLocalPreview("");
                props.onChange({ url: "", key: null });
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        <div className="image-field__actions">
          <Button icon={<UploadOutlined />} disabled={props.disabled || uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? `${progress || 1}%` : tr("Tải ảnh lên", "上传图片")}
          </Button>
          <Button icon={<FolderOpenOutlined />} disabled={props.disabled || uploading} onClick={() => setLibraryOpen(true)}>
            {tr("Chọn ảnh có sẵn", "从图片库选择")}
          </Button>
          {uploading ? (
            <div className="image-field__meter">
              <span style={{ width: `${Math.max(progress, 6)}%` }} />
            </div>
          ) : null}
        </div>
      </div>
      {publicUrl ? (
        <div className="image-field__url">
          <span>{tr("Đường dẫn công khai", "公开地址")}</span>
          <div>
            <input readOnly value={publicUrl} onFocus={(event) => event.target.select()} />
            <Button icon={<CopyOutlined />} onClick={() => void copyUrl()}>
              {copied ? tr("Đã chép", "已复制") : tr("Chép", "复制")}
            </Button>
            <Button icon={<ExportOutlined />} href={publicUrl} target="_blank">
              {tr("Mở", "打开")}
            </Button>
          </div>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          choose(file);
        }}
      />
      <Modal open={zoom} footer={null} onCancel={() => setZoom(false)} width={720} title={tr("Ảnh", "图片")}>
        {shown ? <img className="image-field__zoom" alt="" src={shown} /> : null}
      </Modal>
      <LibraryPicker
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={(image) => {
          setLocalPreview("");
          props.onChange({ url: image.url, key: image.key });
          setLibraryOpen(false);
        }}
      />
    </div>
  );
}

function LibraryPicker(props: { open: boolean; onClose: () => void; onSelect: (image: LibraryImage) => void }) {
  const tr = useTr();
  const [items, setItems] = useState<LibraryPage["items"]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(before?: string) {
    setLoading(true);
    setError("");
    try {
      const page = await api<LibraryPage>(before ? `/api/v1/media?before=${encodeURIComponent(before)}` : "/api/v1/media");
      setItems((current) => (before ? [...current, ...page.items] : page.items));
      setNext(page.next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Không tải được kho ảnh", "无法加载图片库"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title={tr("Chọn ảnh có sẵn", "从图片库选择")}
      footer={null}
      width={760}
      onCancel={props.onClose}
      afterOpenChange={(open) => {
        if (open) {
          void load();
        }
      }}
      destroyOnHidden
    >
      {error ? <p className="image-field__error">{error}</p> : null}
      {!loading && items.length === 0 ? <p className="image-field__empty">{tr("Kho chưa có ảnh. Hãy tải một ảnh lên trước.", "图片库还是空的。请先上传一张。")}</p> : null}
      <div className="image-field__library">
        {items.map((item) => (
          <button key={item.id} type="button" disabled={!item.url || !item.key} onClick={() => props.onSelect({ id: item.id, key: item.key, url: item.url })}>
            {item.url ? <img alt="" src={item.url} /> : <span>{tr("Không có đường dẫn", "没有链接")}</span>}
          </button>
        ))}
      </div>
      {next ? (
        <Button loading={loading} onClick={() => void load(next)}>
          {tr("Xem thêm", "查看更多")}
        </Button>
      ) : null}
    </Modal>
  );
}
