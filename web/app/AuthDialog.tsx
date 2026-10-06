"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, type User, login, register } from "./lib/api";

type Tab = "login" | "register";

/**
 * The latest birth date that is 18 today. As the date field's max it also stops the
 * year box taking more than four digits.
 */
function latestBirthDate() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear() - 18}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AuthDialog({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (user: User) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => setError(null), [tab]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError(null);
    try {
      const { user } =
        tab === "login"
          ? await login(s("email"), s("password"))
          : await register({
              email: s("email"),
              password: s("password"),
              nickname: s("nickname"),
              birthDate: s("birthDate"),
              acceptTerms: f.get("acceptTerms") === "on",
            });
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="auth"
      aria-labelledby="auth-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="auth-inner">
        <button type="button" className="auth-close" aria-label="Хаах" onClick={onClose}>
          ×
        </button>
        <h2 id="auth-title">{tab === "register" ? "Бүртгүүлэх" : "Нэвтрэх"}</h2>
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "register"} onClick={() => setTab("register")}>
            Шинэ хэрэглэгч
          </button>
          <button type="button" role="tab" aria-selected={tab === "login"} onClick={() => setTab("login")}>
            Бүртгэлтэй
          </button>
        </div>

        <form onSubmit={submit} key={tab} noValidate={false}>
          {tab === "register" && (
            <label>
              Хочны нэр
              <input name="nickname" required minLength={3} maxLength={20} autoComplete="nickname" />
              <small>Тэргүүлэгчдийн жагсаалтад харагдана.</small>
            </label>
          )}
          <label>
            И-мэйл
            <input name="email" type="email" required autoComplete="email" inputMode="email" />
          </label>
          <label>
            Нууц үг
            <input
              name="password"
              type="password"
              required
              minLength={tab === "register" ? 8 : undefined}
              autoComplete={tab === "register" ? "new-password" : "current-password"}
            />
            {tab === "register" && <small>Дор хаяж 8 тэмдэгт.</small>}
          </label>
          {tab === "register" && (
            <>
              <label>
                Төрсөн огноо
                <input
                  name="birthDate"
                  type="date"
                  required
                  autoComplete="bday"
                  min="1900-01-01"
                  max={latestBirthDate()}
                />
                <small>18 нас хүрсэн хүн оролцоно.</small>
              </label>
              <label className="check">
                <input name="acceptTerms" type="checkbox" required />
                <span>Үйлчилгээний нөхцөл болон нууцлалын бодлогыг уншиж, зөвшөөрч байна.</span>
              </label>
            </>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Түр хүлээнэ үү…" : tab === "register" ? "Бүртгүүлэх" : "Нэвтрэх"}
          </button>
        </form>
      </div>
    </dialog>
  );
}
