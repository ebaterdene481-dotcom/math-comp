"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthDialog } from "./AuthDialog";
import { AUTH_EVENT, type User, announceAuthChange, getMe } from "./lib/api";

/** Logo on the left; on the right a sign-in button, or the player's name linking to their profile. */
export function SiteHeader() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const load = () =>
      getMe()
        .then((r) => setUser(r.user))
        .catch(() => setUser(null));
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, []);

  return (
    <header className="site-header">
      <Link href="/" className="logo">
        <span>5</span> секунд
      </Link>
      {user === null && (
        <button type="button" className="btn btn-quiet header-btn" onClick={() => setAuthOpen(true)}>
          Нэвтрэх
        </button>
      )}
      {user && (
        <Link href="/profile" className="header-user">
          <span className="avatar" aria-hidden="true">
            {[...user.nickname][0]?.toUpperCase()}
          </span>
          {user.nickname}
        </Link>
      )}
      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={() => {
          setAuthOpen(false);
          announceAuthChange();
        }}
      />
    </header>
  );
}
