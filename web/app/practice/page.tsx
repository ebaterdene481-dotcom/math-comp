"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGame } from "./useGame";

const fmtPoints = (hundredths: number) => (hundredths / 100).toFixed(2);
const fmtSeconds = (ms: number) => (ms / 1000).toFixed(2);

/** Draws the problem onto a canvas so it isn't readable as page text. */
function ProblemCanvas({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const styles = getComputedStyle(document.documentElement);
      const family = styles.getPropertyValue("--font-display").trim() || "sans-serif";
      let size = Math.min(88, height * 0.8);
      ctx.font = `800 ${size}px ${family}`;
      while (ctx.measureText(text).width > width - 16 && size > 24) {
        size -= 4;
        ctx.font = `800 ${size}px ${family}`;
      }
      ctx.fillStyle = styles.getPropertyValue("--ink").trim();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, width / 2, height / 2);
    };
    document.fonts.ready.then(draw);
    return () => {
      cancelled = true;
    };
  }, [text]);

  return <canvas ref={ref} className="problem" role="img" aria-label="Бодлого" />;
}

/** Display-only countdown. The server decides when time is up. */
function TimeBar({ shownAt, limitMs, running }: { shownAt: number; limitMs: number; running: boolean }) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - shownAt) / limitMs);
      if (bar.current) bar.current.style.transform = `scaleX(${left})`;
      if (running && left > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [shownAt, limitMs, running]);
  return (
    <div className="timebar" aria-hidden="true">
      <i ref={bar} />
    </div>
  );
}

export default function Practice() {
  const game = useGame();
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (game.phase === "active") input.current?.focus();
  }, [game.phase, game.problem?.index]);

  useEffect(() => {
    if (game.feedback?.kind !== "wrong") return;
    // restart the shake animation on every wrong answer without remounting the input
    setFlash(false);
    const raf = requestAnimationFrame(() => setFlash(true));
    return () => cancelAnimationFrame(raf);
  }, [game.feedback]);

  const submit = () => {
    const v = value.trim();
    if (!v || game.phase !== "active") return;
    game.answer(v);
    setValue("");
  };

  return (
    <main className="wrap">
      <header className="site-header">
        <Link href="/" className="logo">
          <span>5</span> секунд
        </Link>
      </header>

      <section className="play">
        {game.phase === "ready" && (
          <div className="sheet">
            <h1 className="total" style={{ fontSize: "clamp(32px, 6vw, 48px)" }}>
              20 бодлого
            </h1>
            <p className="total-label">Түвшин бүрээс 4, хялбараас хэцүү рүү. Оноо хадгалагдахгүй.</p>
            <button className="btn" onClick={game.start}>
              Эхлэх
            </button>
            <p className="hint">
              Хариугаа бичээд Enter дар. Утсан дээр «Илгээх» товч дар. Эхлэх товч дармагц эхний
              бодлого 1 секундийн дараа гарна.
            </p>
          </div>
        )}

        {(game.phase === "connecting" || game.phase === "gap" || game.phase === "active") && (
          <>
            <div className="progress">
              {game.problem ? `${game.problem.index + 1} / ${game.problem.total}` : "Бэлдэж байна…"}
            </div>
            <div className="sheet">
              {game.problem ? <ProblemCanvas text={game.problem.text} /> : <div className="problem" />}
              {game.problem && (
                <TimeBar
                  shownAt={game.problem.shownAt}
                  limitMs={game.problem.timeLimitMs}
                  running={game.phase === "active"}
                />
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  ref={input}
                  className={`answer${flash ? " wrong" : ""}`}
                  onAnimationEnd={() => setFlash(false)}
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
                  onPaste={(e) => e.preventDefault()}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="send"
                  aria-label="Хариу"
                  readOnly={game.phase !== "active"}
                  autoFocus
                />
                <div className="submit-row">
                  <button type="submit" className="btn" disabled={game.phase !== "active"}>
                    Илгээх
                  </button>
                </div>
              </form>
              <div
                className={`feedback ${game.feedback?.kind === "correct" ? "good" : "bad"}`}
                aria-live="polite"
              >
                {game.feedback?.kind === "correct" &&
                  `+${fmtPoints(game.feedback.points)} (${fmtSeconds(game.feedback.elapsedMs)} сек)`}
                {game.feedback?.kind === "wrong" && "Буруу. Дахин бич."}
                {game.feedback?.kind === "timeout" && `Цаг дууслаа. Хариу: ${game.feedback.answer}`}
              </div>
            </div>
          </>
        )}

        {game.phase === "finished" && game.result && (
          <div className="sheet">
            <p className="total-label" style={{ margin: 0 }}>
              Нийт оноо
            </p>
            <div className="total">{fmtPoints(game.result.totalPoints)}</div>
            <p className="total-label">
              2,000 онооноос. {game.result.results.filter((r) => r.solved).length} бодлого зөв.
            </p>
            <table className="results">
              <thead>
                <tr>
                  <th>Бодлого</th>
                  <th className="num">Хариу</th>
                  <th className="num">Хугацаа</th>
                  <th className="num">Оноо</th>
                </tr>
              </thead>
              <tbody>
                {game.result.results.map((r, i) => (
                  <tr key={i} className={r.solved ? "" : "miss"}>
                    <td>{r.text}</td>
                    <td className="num">{r.answer}</td>
                    <td className="num">{r.elapsedMs === null ? "—" : `${fmtSeconds(r.elapsedMs)} сек`}</td>
                    <td className="num">{fmtPoints(r.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions" style={{ justifyContent: "center" }}>
              <button className="btn" onClick={game.start}>
                Дахин тоглох
              </button>
              <Link href="/" className="btn btn-quiet">
                Нүүр хуудас
              </Link>
            </div>
          </div>
        )}

        {game.phase === "error" && (
          <div className="sheet">
            <p className="feedback bad">{game.error}</p>
            <button className="btn" onClick={game.start}>
              Дахин эхлүүлэх
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
