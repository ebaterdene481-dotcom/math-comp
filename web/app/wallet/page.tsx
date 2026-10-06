"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import {
  AUTH_EVENT,
  ApiError,
  type Wallet,
  type Withdrawal,
  demoTopUp,
  getWallet,
  groupDigits,
  requestWithdrawal,
} from "../lib/api";

const KIND = { topup: "Цэнэглэлт", entry: "Тэмцээний хураамж", prize: "Шагнал", withdraw: "Мөнгө татсан", refund: "Буцаалт" } as const;

const when = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fmtAt = (iso: string) => when.format(new Date(iso)).replace(/-/g, ".").replace(",", "");

export default function WalletPage() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "signed-out" } | { kind: "ok"; w: Wallet }>({
    kind: "loading",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getWallet()
      .then((w) => setState({ kind: "ok", w }))
      .catch((e) => setState(e instanceof ApiError && e.code === "signed_out" ? { kind: "signed-out" } : { kind: "loading" }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);

  async function add(amount: number) {
    setBusy(true);
    try {
      const w = await demoTopUp(amount);
      setState((s) => (s.kind === "ok" ? { kind: "ok", w: { ...s.w, ...w } } : s));
      setNote(`${groupDigits(amount)}₮ нэмэгдлээ.`);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <SiteHeader />
      <section className="profile">
        {state.kind === "loading" && <p className="meta">Ачаалж байна…</p>}
        {state.kind === "signed-out" && (
          <div className="sheet profile-empty">
            <h1>Хэтэвч</h1>
            <p>Хэтэвчээ харахын тулд дээд буланд байгаа «Нэвтрэх» товчийг дарна уу.</p>
          </div>
        )}
        {state.kind === "ok" && (
          <div className="profile-grid wallet-grid">
            <div className="profile-card wallet wallet-main">
              <span className="stat-label">Хэтэвчний үлдэгдэл</span>
              <span className="wallet-balance">{groupDigits(state.w.balance)}₮</span>
              <p className="meta">Тэмцээний хураамж эндээс хасагдаж, шагналын мөнгө энд орно.</p>
            </div>

            <div className="profile-card topup">
              <h2>Цэнэглэх</h2>
              {state.w.demoTopUp ? (
                <>
                  <p className="meta">
                    Төлбөрийн систем холбогдох хүртэл туршилтын мөнгө нэмж болно. Жинхэнэ мөнгө биш.
                  </p>
                  <div className="topup-amounts">
                    {[5000, 10000, 20000].map((a) => (
                      <button key={a} type="button" className="btn btn-quiet" disabled={busy} onClick={() => add(a)}>
                        +{groupDigits(a)}₮
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="meta">Төлбөрийн систем холбогдсоны дараа цэнэглэх боломжтой болно.</p>
              )}
              {note && (
                <p className="topup-note" role="status">
                  {note}
                </p>
              )}
            </div>

            <Withdraw w={state.w} onDone={load} />

            <section className="profile-card history" aria-labelledby="tx-title">
              <h2 id="tx-title">Гүйлгээний түүх</h2>
              {state.w.transactions.length === 0 ? (
                <div className="history-empty">
                  <p>Одоогоор гүйлгээ алга. Цэнэглэлт, хураамж, шагнал энд харагдана.</p>
                </div>
              ) : (
                <ul className="tx-list">
                  {state.w.transactions.map((t) => (
                    <li key={t.id}>
                      <span className="tx-kind">
                        {KIND[t.kind]}
                        <small>
                          {t.note} · {fmtAt(t.at)}
                        </small>
                      </span>
                      <span className={`tx-amount${t.amount < 0 ? " out" : ""}`}>
                        {t.amount > 0 ? "+" : "−"}
                        {groupDigits(Math.abs(t.amount))}₮
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="profile-foot">
              <Link href="/" className="btn">
                Тэмцээн рүү буцах
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

const W_STATUS = { pending: "Хүлээгдэж буй", paid: "Шилжүүлсэн", rejected: "Татгалзсан" } as const;

/** Taking money out to a bank account. An admin sends it by hand and marks it done. */
function Withdraw({ w, onDone }: { w: Wallet; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = w.withdrawals.find((x) => x.status === "pending");
  const tooLittle = w.balance < w.minWithdrawal;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sum = Number(amount.replace(/\s/g, ""));
    if (!window.confirm(`${groupDigits(sum)}₮-г ${bank} ${account} данс руу татах уу? Мөнгө хэтэвчнээс одоо хасагдана.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await requestWithdrawal({ amount: sum, bank, account, holder });
      setAmount("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-card withdraw" aria-labelledby="withdraw-title">
      <h2 id="withdraw-title">Мөнгө татах</h2>
      {pending ? (
        <p className="withdraw-wait">
          <b>{groupDigits(pending.amount)}₮</b> {pending.bank} {pending.account} данс руу шилжүүлэхээр хүлээгдэж байна.
          Админ шилжүүлсний дараа энд «Шилжүүлсэн» гэж харагдана.
        </p>
      ) : (
        <form className="withdraw-form" onSubmit={submit}>
          <p className="meta">
            Хамгийн багадаа {groupDigits(w.minWithdrawal)}₮. Мөнгө хүсэлт илгээх үед хэтэвчнээс хасагдаж, админ таны данс руу
            шилжүүлнэ.
          </p>
          {tooLittle ? (
            <p className="meta">Таны үлдэгдэл {groupDigits(w.minWithdrawal)}₮-өөс бага байна.</p>
          ) : (
            <>
              <label>
                <span className="field-label">Дүн (₮)</span>
                <input
                  inputMode="numeric"
                  required
                  value={amount}
                  placeholder={`${groupDigits(w.minWithdrawal)} – ${groupDigits(w.balance)}`}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </label>
              <label>
                <span className="field-label">Банк</span>
                <select required value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="" disabled>
                    Сонгох
                  </option>
                  {w.banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Дансны дугаар</span>
                <input
                  inputMode="numeric"
                  required
                  value={account}
                  autoComplete="off"
                  onChange={(e) => setAccount(e.target.value)}
                />
              </label>
              <label>
                <span className="field-label">Данс эзэмшигчийн нэр</span>
                <input required value={holder} maxLength={80} onChange={(e) => setHolder(e.target.value)} />
              </label>
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Илгээж байна…" : "Хүсэлт илгээх"}
              </button>
            </>
          )}
        </form>
      )}
      {w.withdrawals.length > 0 && (
        <ul className="withdraw-list">
          {w.withdrawals.map((x: Withdrawal) => (
            <li key={x.id}>
              <span>
                <b className="num">{groupDigits(x.amount)}₮</b>
                <small>
                  {x.bank} {x.account} · {fmtAt(x.requestedAt)}
                </small>
                {x.reason && <small className="withdraw-reason">Шалтгаан: {x.reason}</small>}
              </span>
              <span className={`pill-${x.status}`}>{W_STATUS[x.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
