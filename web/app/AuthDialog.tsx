"use client";

import { useEffect, useRef, useState } from "react";
import { PasswordRules } from "./PasswordRules";
import { ApiError, type User, forgotPassword, login, register } from "./lib/api";
import { passwordProblem } from "./lib/password";

type Tab = "login" | "register" | "forgot";

const MISMATCH = "Давтан оруулсан нууц үг таарахгүй байна.";

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
  const [sent, setSent] = useState<{ email: string; devLink?: string } | null>(null);
  const [pw, setPw] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    setError(null);
    setSent(null);
    setPw("");
  }, [tab]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    const weak = tab === "register" ? passwordProblem(s("password")) : null;
    if (weak) {
      setError(weak);
      return;
    }
    if (tab === "register" && s("password") !== s("passwordConfirm")) {
      setError(MISMATCH);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (tab === "forgot") {
        const r = await forgotPassword(s("email"));
        setSent({ email: s("email"), devLink: r.devLink });
        return;
      }
      const { user } =
        tab === "login"
          ? await login(s("email"), s("password"))
          : await register({
              email: s("email"),
              password: s("password"),
              passwordConfirm: s("passwordConfirm"),
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
        <h2 id="auth-title">{tab === "register" ? "Бүртгүүлэх" : tab === "login" ? "Нэвтрэх" : "Нууц үг сэргээх"}</h2>
        {tab === "forgot" ? (
          <Forgot sent={sent} back={() => setTab("login")} />
        ) : (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "register"} onClick={() => setTab("register")}>
              Шинэ хэрэглэгч
            </button>
            <button type="button" role="tab" aria-selected={tab === "login"} onClick={() => setTab("login")}>
              Бүртгэлтэй
            </button>
          </div>
        )}

        {!sent && (
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
            {tab !== "forgot" && (
              <label>
                Нууц үг
                <input
                  name="password"
                  type="password"
                  required
                  minLength={tab === "register" ? 8 : undefined}
                  autoComplete={tab === "register" ? "new-password" : "current-password"}
                  aria-describedby={tab === "register" ? "pw-rules" : undefined}
                  onInput={(e) => setPw(e.currentTarget.value)}
                />
                {tab === "register" && <PasswordRules value={pw} id="pw-rules" />}
              </label>
            )}
            {tab === "login" && (
              <button type="button" className="auth-link" onClick={() => setTab("forgot")}>
                Нууц үгээ мартсан уу?
              </button>
            )}
            {tab === "register" && (
              <>
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
              {busy
                ? "Түр хүлээнэ үү…"
                : tab === "register"
                  ? "Бүртгүүлэх"
                  : tab === "login"
                    ? "Нэвтрэх"
                    : "Холбоос илгээх"}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}

function Forgot({ sent, back }: { sent: { email: string; devLink?: string } | null; back: () => void }) {
  return (
    <div className="auth-forgot">
      {sent ? (
        <p role="status">
          Хэрэв <b>{sent.email}</b> хаягаар бүртгэл байгаа бол нууц үг сэргээх холбоос илгээлээ. Имэйлээ шалгана уу.
          Холбоос 1 цаг ажиллана.
        </p>
      ) : (
        <p>Бүртгэлтэй имэйлээ оруулна уу. Шинэ нууц үг тохируулах холбоос илгээнэ.</p>
      )}
      {sent?.devLink && (
        <a className="dev-link" href={sent.devLink}>
          Туршилтын сервер: холбоосыг нээх
        </a>
      )}
      <button type="button" className="auth-link" onClick={back}>
        Нэвтрэх рүү буцах
      </button>
    </div>
  );
}
