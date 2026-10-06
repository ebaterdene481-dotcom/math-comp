"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import { AUTH_EVENT, ApiError, type Wallet, demoTopUp, getWallet, groupDigits } from "../lib/api";

const KIND = { topup: "Цэнэглэлт", entry: "Тэмцээний хураамж", prize: "Шагнал", withdraw: "Мөнгө татсан" } as const;

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
          <div className="profile-grid">
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
              <h2 className="withdraw-title">Мөнгө татах</h2>
              <p className="meta">Шагналын мөнгийг банкны данс руугаа татах хэсэг төлбөрийн системтэй хамт нээгдэнэ.</p>
              {note && (
                <p className="topup-note" role="status">
                  {note}
                </p>
              )}
            </div>

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
