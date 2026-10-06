"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthDialog } from "./AuthDialog";
import { AUTH_EVENT, ApiError, type User, announceAuthChange, getMe, registeredDevLink, resendVerification } from "./lib/api";

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
    <>
      <header className="site-header">
        <Link href="/" className="logo">
          <span>5</span> секунд
        </Link>
        <nav className="header-nav">
          {user?.isAdmin && (
            <Link href="/admin" className="header-link">
              Админ
            </Link>
          )}
          <Link href="/competitions" className="header-link">
            <span className="long">Өмнөх тэмцээнүүд</span>
            <span className="short">Тэмцээнүүд</span>
          </Link>
          {user === null && (
            <button type="button" className="btn btn-quiet header-btn" onClick={() => setAuthOpen(true)}>
              Нэвтрэх
            </button>
          )}
          {user && (
            <Link href="/profile" className="header-user" aria-label={`${user.nickname}: профайл`}>
              <span className="avatar" aria-hidden="true">
                {[...user.nickname][0]?.toUpperCase()}
              </span>
              <span className="nick-text">{user.nickname}</span>
            </Link>
          )}
        </nav>
        <AuthDialog
          open={authOpen}
          onClose={() => setAuthOpen(false)}
          onSignedIn={() => {
            setAuthOpen(false);
            announceAuthChange();
          }}
        />
      </header>
      {user && user.emailVerified === false && <VerifyNotice email={user.email} />}
    </>
  );
}

/** Shown until the player opens the link sent to their email; paying and withdrawing wait for it. */
function VerifyNotice({ email }: { email: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [devLink, setDevLink] = useState(registeredDevLink);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const r = await resendVerification();
      setDevLink(r.devLink);
      setNote("Шинэ холбоос илгээлээ.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify-notice" role="status">
      <p>
        <b>{email}</b> руу илгээсэн холбоосоор имэйлээ баталгаажуулна уу. Баталгаажуулсны дараа тэмцээнд оролцож, мөнгө
        татах боломжтой.
      </p>
      <div className="verify-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={resend}>
          Дахин илгээх
        </button>
        {devLink && (
          <a className="dev-link" href={devLink}>
            Туршилтын сервер: холбоосыг нээх
          </a>
        )}
        {note && <span className="meta">{note}</span>}
      </div>
    </div>
  );
}
