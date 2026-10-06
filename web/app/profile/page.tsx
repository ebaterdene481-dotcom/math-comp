"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import {
  AUTH_EVENT,
  ApiError,
  type Profile,
  announceAuthChange,
  fmtPoints,
  getProfile,
  groupDigits,
  logout,
} from "../lib/api";

const STATUS_TEXT = { live: "Явагдаж байна", upcoming: "Удахгүй", finished: "Дууссан" } as const;

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso))
    .replace(/-/g, ".");

export default function ProfilePage() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "signed-out" } | { kind: "ok"; p: Profile } | { kind: "error"; msg: string }>({
    kind: "loading",
  });

  const load = useCallback(() => {
    getProfile()
      .then((p) => setState({ kind: "ok", p }))
      .catch((e) =>
        setState(
          e instanceof ApiError && e.code === "signed_out"
            ? { kind: "signed-out" }
            : { kind: "error", msg: e instanceof ApiError ? e.message : "Алдаа гарлаа." },
        ),
      );
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);

  return (
    <main className="wrap">
      <SiteHeader />
      <section className="profile">
        {state.kind === "loading" && <p className="meta">Ачаалж байна…</p>}
        {state.kind === "error" && <p className="feedback bad">{state.msg}</p>}
        {state.kind === "signed-out" && (
          <div className="sheet profile-empty">
            <h1>Профайл</h1>
            <p>Профайлаа харахын тулд дээд буланд байгаа «Нэвтрэх» товчийг дарна уу.</p>
            <Link href="/" className="btn">
              Нүүр хуудас
            </Link>
          </div>
        )}
        {state.kind === "ok" && <ProfileView p={state.p} />}
      </section>
    </main>
  );
}

function ProfileView({ p }: { p: Profile }) {
  const [note, setNote] = useState<string | null>(null);
  const soon = () => setNote("Хэтэвч төлбөрийн хэсэгтэй хамт удахгүй нээгдэнэ.");

  return (
    <div className="profile-grid">
      <div className="profile-card profile-id">
        <span className="avatar avatar-lg" aria-hidden="true">
          {[...p.user.nickname][0]?.toUpperCase()}
        </span>
        <div>
          <h1>{p.user.nickname}</h1>
          <p className="meta">
            {p.user.email}
            <br />
            {fmtDate(p.user.createdAt)}-нд бүртгүүлсэн
          </p>
        </div>
      </div>

      <div className="profile-card wallet">
        <span className="stat-label">Хэтэвчний үлдэгдэл</span>
        <span className="wallet-balance">{groupDigits(p.wallet.balance)}₮</span>
        <div className="wallet-actions">
          <button type="button" className="btn" onClick={soon}>
            Цэнэглэх
          </button>
          <button type="button" className="btn btn-quiet" onClick={soon}>
            Мөнгө татах
          </button>
        </div>
        {note && (
          <p className="meta" role="status">
            {note}
          </p>
        )}
      </div>

      <dl className="tiles profile-tiles">
        <div>
          <dt>Оролцсон тэмцээн</dt>
          <dd>{p.stats.competitions}</dd>
        </div>
        <div>
          <dt>Нийт оролдлого</dt>
          <dd>{p.stats.attempts}</dd>
        </div>
        <div>
          <dt>Хамгийн өндөр оноо</dt>
          <dd>{p.stats.bestPoints === null ? "–" : fmtPoints(p.stats.bestPoints)}</dd>
        </div>
        <div>
          <dt>Шилдэг байр</dt>
          <dd>{p.stats.bestRank === null ? "–" : `${p.stats.bestRank}-р`}</dd>
        </div>
      </dl>

      <section className="profile-card history" aria-labelledby="hist-title">
        <h2 id="hist-title">Тэмцээний түүх</h2>
        {p.history.length === 0 ? (
          <div className="history-empty">
            <p>Та одоогоор тэмцээнд оролцоогүй байна. Оролцсон тэмцээн бүрийн оноо, байр энд харагдана.</p>
            <div className="actions">
              <Link href="/" className="btn">
                Тэмцээн үзэх
              </Link>
              <Link href="/practice" className="btn btn-quiet">
                Туршиж үзэх
              </Link>
            </div>
          </div>
        ) : (
          <table className="results">
            <thead>
              <tr>
                <th>Тэмцээн</th>
                <th>Төлөв</th>
                <th className="num">Оролдлого</th>
                <th className="num">Шилдэг оноо</th>
                <th className="num">Байр</th>
              </tr>
            </thead>
            <tbody>
              {p.history.map((h) => (
                <tr key={h.competitionId}>
                  <td>{h.name}</td>
                  <td>{STATUS_TEXT[h.status]}</td>
                  <td className="num">{h.attempts}</td>
                  <td className="num">{fmtPoints(h.bestPoints)}</td>
                  <td className="num">
                    {h.rank}/{h.players}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="profile-foot">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={async () => {
            await logout().catch(() => {});
            announceAuthChange();
          }}
        >
          Гарах
        </button>
      </div>
    </div>
  );
}
