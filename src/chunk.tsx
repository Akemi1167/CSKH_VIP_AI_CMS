import { Component, type ReactNode } from "react";
import { deskLang } from "./desk/language.tsx";

const RELOAD_KEY = "cskh-reload-chunk";

export function isMissingChunk(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|module script failed|Importing a module script failed/i.test(text);
}

export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 20_000) {
      return false;
    }
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export class ChunkBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (isMissingChunk(error)) {
      reloadForNewBuild();
    }
  }

  componentDidUpdate(previous: { resetKey?: string }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    const zh = deskLang() === "zh";
    return (
      <div className="page-loading chunk-miss">
        <p>{zh ? "页面已更新，请重新加载。" : "Trang vừa được cập nhật. Hãy tải lại."}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {zh ? "重新加载" : "Tải lại"}
        </button>
      </div>
    );
  }
}
