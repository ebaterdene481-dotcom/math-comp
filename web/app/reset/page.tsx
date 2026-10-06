"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import { ApiError, announceAuthChange, resetPassword } from "../lib/api";

const MISMATCH = "Давтан оруулсан нууц үг таарахгүй байна.";

export default function ResetPage() {
  return (
    <main className="wrap">
      <SiteHeader />
      <section className="link-page">
        <div className="sheet auth-form">
          <Suspense>
            <Reset />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

/** Sets a new password from the link in the reset email. */
function Reset() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    const confirm = String(f.get("passwordConfirm") ?? "");
    if (password !== confirm) return setError(MISMATCH);
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password, confirm);
      setDone(true);
      announceAuthChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <>
        <h1>Нууц үг шинэчлэгдлээ</h1>
        <p>Та нэвтэрсэн байна. Бусад төхөөрөмж дээрх нэвтрэлт хаагдсан.</p>
        <Link href="/" className="btn">
          Тэмцээн рүү очих
        </Link>
      </>
    );

  return (
    <>
      <h1>Шинэ нууц үг</h1>
      <form onSubmit={submit}>
        <label>
          Шинэ нууц үг
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
          <small>Дор хаяж 8 тэмдэгт.</small>
        </label>
        <label>
          Нууц үгээ давтах
          <input
            name="passwordConfirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            onInput={(e) => {
              const c = e.currentTarget;
              const pw = c.form?.elements.namedItem("password") as HTMLInputElement | null;
              c.setCustomValidity(pw && c.value && c.value !== pw.value ? MISMATCH : "");
            }}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Түр хүлээнэ үү…" : "Нууц үгээ хадгалах"}
        </button>
      </form>
    </>
  );
}
