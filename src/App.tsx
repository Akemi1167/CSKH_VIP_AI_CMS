import { Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api.ts";
import { AuthScreen } from "./auth/AuthScreen.tsx";
import { Desk } from "./desk/Desk.tsx";
import { GuestChat } from "./public/GuestChat.tsx";
import type { Me, UserProfile } from "./types.ts";

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
    if (guestPage) {
      return;
    }
    document.title = phase === "desk" ? "Bàn làm việc · CSKH VIP" : "Đăng nhập · CSKH VIP";
  }, [guestPage, phase]);

  if (guestPage) {
    return <GuestChat />;
  }

  if (phase === "loading") {
    return (
      <div className="route-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (phase === "desk" && user) {
    return (
      <Desk
        user={user}
        onMfaSetup={() => setPhase("mfa_setup")}
        onLoggedOut={(nextNotice) => {
          setUser(null);
          setNotice(nextNotice ?? null);
          setPhase("login");
        }}
      />
    );
  }

  return (
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
  );
}
