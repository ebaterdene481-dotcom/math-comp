"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import { GameScreen } from "../game/GameScreen";
import { Results } from "../game/Results";
import { AUTH_EVENT, ApiError, type Entry, attemptSocketUrl, getOpenEntries } from "../lib/api";

/** Minutes and seconds left until `iso`, ticking every second. */
function useLeft(iso: string) {
  const [left, setLeft] = useState(() => new Date(iso).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(iso).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return Math.max(0, left);
}

function StartBy({ iso }: { iso: string }) {
  const left = useLeft(iso);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className={`start-by${left < 120_000 ? " low" : ""}`}>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

type Load = { kind: "loading" } | { kind: "signed-out" } | { kind: "none" } | { kind: "ok"; entry: Entry };

/** The paid 100-problem run. One open entry at a time, so the page just picks it up. */
export default function Play() {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [started, setStarted] = useState(false);

  const load = useCallback(() => {
    getOpenEntries()
      .then(({ entries }) => setState(entries[0] ? { kind: "ok", entry: entries[0] } : { kind: "none" }))
      .catch((e) => setState(e instanceof ApiError && e.code === "signed_out" ? { kind: "signed-out" } : { kind: "none" }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);

  return (
    <main className="wrap">
      <SiteHeader />
      {state.kind === "loading" && <p className="meta">Ачаалж байна…</p>}
      {state.kind === "signed-out" && (
        <section className="play">
          <div className="sheet">
            <h1 className="play-title">Тэмцээн</h1>
            <p>Оролдлогоо эхлүүлэхийн тулд дээд буланд байгаа «Нэвтрэх» товчийг дарна уу.</p>
          </div>
        </section>
      )}
      {state.kind === "none" && !started && (
        <section className="play">
          <div className="sheet">
            <h1 className="play-title">Эхлүүлэх оролдлого алга</h1>
            <p>Тэмцээнд оролцохын тулд нүүр хуудаснаас хураамжаа төлнө үү.</p>
            <div className="sheet-actions">
              <Link href="/" className="btn">
                Тэмцээн рүү очих
              </Link>
              <Link href="/practice" className="btn btn-quiet">
                Үнэгүй туршилт
              </Link>
            </div>
          </div>
        </section>
      )}
      {state.kind === "ok" && (
        <GameScreen
          url={attemptSocketUrl(state.entry.id)}
          autoStart={state.entry.status === "playing"}
          levels={5}
          startCard={(start) => (
            <div className="sheet">
              <p className="meta">{state.entry.competitionName}</p>
              <h1 className="play-title">100 бодлого</h1>
              <p>
                Эхлүүлэх хугацаа үлдсэн: <StartBy iso={state.entry.startBy} />
              </p>
              <ul className="rules">
                <li>5 шат, шат бүрт 20 бодлого. Бодлого бүрт 5 секунд.</li>
                <li>0.5 секундэд зөв хариулбал 100 оноо, удах тусам буурна.</li>
                <li>Буруу бол дахин бич, цаг үргэлжилнэ.</li>
                <li>Холболт тасарвал цаг зогсохгүй. Буцаж орвол үргэлжилнэ.</li>
              </ul>
              <button
                className="btn"
                onClick={() => {
                  setStarted(true);
                  start();
                }}
              >
                Эхлэх
              </button>
              <p className="hint">Эхлэх дарсны дараа 10 секунд тоолоод эхний бодлого гарна.</p>
            </div>
          )}
          results={(r) => <Results result={r} />}
        />
      )}
    </main>
  );
}
