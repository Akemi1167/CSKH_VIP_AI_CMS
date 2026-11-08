import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api.ts";
import type { Me, UserProfile } from "./types.ts";

const AuthScreen = lazy(() => import("./auth/AuthScreen.tsx").then((module) => ({ default: module.AuthScreen })));
const Desk = lazy(() => import("./desk/Desk.tsx").then((module) => ({ default: module.Desk })));
const GuestChat = lazy(() => import("./public/GuestChat.tsx").then((module) => ({ default: module.GuestChat })));

function Booting() {
  return <div className="route-loading" role="status" aria-label="Đang tải" />;
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

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/api/v1/auth/me");
      setUser(me.user);
      setBootError(null);
      setPhase(me.session === "mfa_setup" ? "mfa_setup" : "desk");
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không kết nối được máy chủ", "");
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
    document.title = "Đăng nhập · CSKH VIP";
  }, [guestPage, phase]);

  if (guestPage) {
    return (
      <Suspense fallback={<Booting />}>
        <GuestChat />
      </Suspense>
    );
  }

  if (phase === "loading") {
    return <Booting />;
  }

  if (phase === "desk" && user) {
    return (
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
    );
  }

  return (
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
  );
}
