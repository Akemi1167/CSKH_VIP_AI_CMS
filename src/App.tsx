import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
import { ApiError, api } from "./api.ts";
import { ChunkBoundary, isMissingChunk, reloadForNewBuild } from "./chunk.tsx";
import { deskLang, useDeskLang } from "./desk/language.tsx";
import type { Me, UserProfile } from "./types.ts";

function screen<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() =>
    load()
      .then((component) => ({ default: component }))
      .catch((error: unknown) => {
        if (isMissingChunk(error) && reloadForNewBuild()) {
          return new Promise(() => undefined);
        }
        throw error;
      }),
  );
}

const AuthScreen = screen(() => import("./auth/AuthScreen.tsx").then((module) => module.AuthScreen));
const Desk = screen(() => import("./desk/Desk.tsx").then((module) => module.Desk));
const GuestChat = screen(() => import("./public/GuestChat.tsx").then((module) => module.GuestChat));

function Booting() {
  const lang = useDeskLang();
  return <div className="route-loading" role="status" aria-label={lang === "zh" ? "正在加载" : "Đang tải"} />;
}

function isGuestPath(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/ho-tro";
}

type Phase = "loading" | "login" | "mfa_setup" | "desk";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const guestPage = isGuestPath();
  const lang = useDeskLang();

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/api/v1/auth/me");
      setUser(me.user);
      setBootError(null);
      setPhase(me.session === "mfa_setup" ? "mfa_setup" : "desk");
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", deskLang() === "zh" ? "无法连接服务器" : "Không kết nối được máy chủ", "");
      setUser(null);
      setPhase("login");
      setBootError(error.status === 401 ? null : error.message);
    }
  }, []);

  useEffect(() => {
    if (guestPage) {
      return;
    }
    void refresh();
  }, [guestPage, refresh]);

  useEffect(() => {
    if (guestPage || phase === "desk" || phase === "loading") {
      return;
    }
    document.title = lang === "zh" ? "登录 · CSKH VIP" : "Đăng nhập · CSKH VIP";
  }, [guestPage, lang, phase]);

  if (guestPage) {
    return (
      <ChunkBoundary>
        <Suspense fallback={<Booting />}>
          <GuestChat />
        </Suspense>
      </ChunkBoundary>
    );
  }

  if (phase === "loading") {
    return <Booting />;
  }

  if (phase === "desk" && user) {
    return (
      <ChunkBoundary>
      <Suspense fallback={<Booting />}>
        <Desk
          user={user}
          onMfaSetup={() => setPhase("mfa_setup")}
          onLoggedOut={(nextNotice) => {
            setUser(null);
            setNotice(nextNotice ?? null);
            setPhase("login");
          }}
        />
      </Suspense>
      </ChunkBoundary>
    );
  }

  return (
    <ChunkBoundary>
    <Suspense fallback={<Booting />}>
      <AuthScreen
        start={phase === "mfa_setup" ? "mfa_setup" : "login"}
        notice={notice ?? bootError}
        noticeTone={notice ? "ok" : "error"}
        onReady={() => {
          setNotice(null);
          void refresh();
        }}
        onLeave={() => {
          setUser(null);
          setNotice(null);
          setPhase("login");
        }}
      />
    </Suspense>
    </ChunkBoundary>
  );
}
