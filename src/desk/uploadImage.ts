import { useSyncExternalStore } from "react";
import { ApiError, api } from "../api.ts";
import { deskLang } from "./language.tsx";
import { imageFileToWebp } from "./imageFile.ts";

export type LibraryImage = {
  id: string;
  key: string;
  url: string;
};

export type UploadTask = {
  id: string;
  name: string;
  progress: number;
  status: "running" | "done" | "error";
  message?: string;
};

type Ticket = {
  upload_url: string;
  key: string;
  public_url: string;
  content_type: string;
  headers: Record<string, string>;
};

const IMAGE_LIMIT = 5 * 1024 * 1024;
let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setTasks(next: UploadTask[]): void {
  tasks = next;
  emit();
}

export function useUploadTasks(): UploadTask[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tasks,
  );
}

export function dismissUpload(id: string): void {
  setTasks(tasks.filter((task) => task.id !== id));
}

export async function uploadLibraryImage(file: File, onProgress?: (percent: number) => void): Promise<LibraryImage> {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type) || file.size === 0) {
    throw localError("Chỉ chọn ảnh PNG, JPEG, WEBP hoặc GIF", "只能选择 PNG、JPEG、WEBP 或 GIF");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw localError("Ảnh gốc lớn hơn 15 MB", "原图超过 15 MB");
  }
  onProgress?.(4);
  let prepared: File;
  try {
    prepared = await imageFileToWebp(file);
  } catch {
    throw localError("Không đọc được ảnh này", "无法读取这张图片");
  }
  if (prepared.size === 0 || prepared.size > IMAGE_LIMIT) {
    throw localError("Ảnh sau khi nén vẫn lớn hơn 5 MB", "压缩后仍超过 5 MB");
  }
  onProgress?.(12);
  const ticket = await api<Ticket>("/api/v1/media/presign", {
    method: "POST",
    body: { content_type: prepared.type || "image/webp" },
  });
  await putFile(ticket.upload_url, prepared, ticket.headers, (percent) => onProgress?.(12 + Math.round(percent * 0.8)));
  onProgress?.(94);
  const saved = await api<LibraryImage>("/api/v1/media/confirm", {
    method: "POST",
    body: { key: ticket.key },
  });
  onProgress?.(100);
  return { id: saved.id, key: saved.key, url: saved.url || ticket.public_url };
}

export function trackLibraryUpload(
  file: File,
  hooks?: { onProgress?: (percent: number) => void; onDone?: (image: LibraryImage) => void; onFail?: (error: ApiError) => void },
): void {
  const id = crypto.randomUUID();
  const started: UploadTask = { id, name: file.name || "anh", progress: 0, status: "running" };
  setTasks([started, ...tasks].slice(0, 6));
  const patch = (next: Partial<UploadTask>) => {
    setTasks(tasks.map((task) => (task.id === id ? { ...task, ...next } : task)));
  };
  void uploadLibraryImage(file, (progress) => {
    patch({ progress });
    hooks?.onProgress?.(progress);
  })
    .then((image) => {
      patch({ progress: 100, status: "done" });
      hooks?.onDone?.(image);
      window.setTimeout(() => dismissUpload(id), 2500);
    })
    .catch((caught: unknown) => {
      const problem = caught instanceof ApiError ? caught : localError("Không tải được ảnh lên kho", "无法把图片传到仓库");
      patch({ status: "error", message: problem.message });
      hooks?.onFail?.(problem);
      window.setTimeout(() => dismissUpload(id), 6000);
    });
}

function putFile(url: string, file: Blob, headers: Record<string, string>, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded * 100) / event.total));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(localError("Kho không nhận ảnh", "仓库没有接收图片"));
    };
    request.onerror = () => {
      reject(localError("Trình duyệt không gửi được ảnh thẳng lên kho", "浏览器无法把图片直接传到仓库"));
    };
    request.send(file);
  });
}

function localError(vi: string, zh: string): ApiError {
  return new ApiError(400, "validation_error", deskLang() === "zh" ? zh : vi, "");
}
