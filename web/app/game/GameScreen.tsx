"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Placing, type ProblemResult, useGame } from "./useGame";

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
      const family = styles.getPropertyValue("--numbers").trim() || "sans-serif";
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
  const secs = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const leftMs = Math.max(0, limitMs - (performance.now() - shownAt));
      if (bar.current) bar.current.style.transform = `scaleX(${leftMs / limitMs})`;
      if (secs.current) {
        secs.current.textContent = `${(leftMs / 1000).toFixed(1)} сек`;
        secs.current.classList.toggle("low", leftMs < 1500);
      }
      if (running && leftMs > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [shownAt, limitMs, running]);
  return (
    <div className="timer" aria-hidden="true">
      <div className="timebar">
        <i ref={bar} />
      </div>
      <span ref={secs} className="time-left" />
    </div>
  );
}

/** Average of a list of times, or null if empty. */
function averageMs(times: number[]) {
  return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

/** Big 10…1 before the first problem. The server holds the problem back until it ends. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)));
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setLeft(Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);
  return (
    <div className="countdown" role="timer" aria-live="off">
      <div className="countdown-num" key={left}>
        {left || "…"}
      </div>
      <p>Бэлдээрэй. Эхний бодлого {left} секундийн дараа гарна.</p>
      <p className="meta">Хариугаа бичээд Enter дар. Буруу бол дахин бич, цаг үргэлжилнэ.</p>
    </div>
  );
}

interface LiveStats {
  points: number;
  correct: number;
  ended: number;
  wrong: number;
  streak: number;
  times: number[];
}

const EMPTY_STATS: LiveStats = { points: 0, correct: 0, ended: 0, wrong: 0, streak: 0, times: [] };

function StatsPanel({ stats, level, levels }: { stats: LiveStats; level: number | null; levels: number }) {
  const avg = averageMs(stats.times);
  const best = stats.times.length ? Math.min(...stats.times) : null;
  return (
    <aside className="live-stats" aria-label="Явцын мэдээлэл">
      <div className="stat stat-wide">
        <span className="stat-label">Нийт оноо</span>
        <span className="stat-value">{fmtPoints(stats.points)}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Шат</span>
        <span className="stat-value">
          {level ?? 1}
          <small>/{levels}</small>
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Зөв</span>
        <span className="stat-value">
          {stats.correct}
          <small>/{stats.ended}</small>
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Дундаж</span>
        <span className="stat-value">{avg === null ? "–" : fmtSeconds(avg)}<small> с</small></span>
      </div>
      <div className="stat">
        <span className="stat-label">Хамгийн хурдан</span>
        <span className="stat-value">{best === null ? "–" : fmtSeconds(best)}<small> с</small></span>
      </div>
      <div className="stat">
        <span className="stat-label">Дараалсан зөв</span>
        <span className="stat-value">{stats.streak}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Буруу оролдлого</span>
        <span className="stat-value">{stats.wrong}</span>
      </div>
    </aside>
  );
}

/**
 * One run of problems over a WebSocket: countdown, problems, live stats beside them.
 * Practice and paid attempts differ only in the socket, the start card and the results.
 */
export function GameScreen({
  url,
  autoStart = false,
  startCard,
  results,
  levels = 5,
}: {
  url: string;
  /** Connect straight away (a paid attempt that is already running). */
  autoStart?: boolean;
  startCard: (start: () => void) => ReactNode;
  results: (r: { totalPoints: number; results: ProblemResult[]; placing?: Placing }, again: () => void) => ReactNode;
  levels?: number;
}) {
  const game = useGame(url);
  useEffect(() => {
    if (autoStart) game.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);

  // A half-typed answer never carries over to the next problem.
  useEffect(() => {
    setValue("");
  }, [game.problem?.index, game.phase]);

  useEffect(() => {
    if (game.phase === "connecting") setStats(EMPTY_STATS);
  }, [game.phase]);

  // Rejoining a paid run: the server sends the totals so far.
  useEffect(() => {
    if (game.progress) setStats(game.progress);
  }, [game.progress]);

  useEffect(() => {
    const f = game.feedback;
    if (!f) return;
    setStats((s) => {
      if (f.kind === "correct")
        return {
          ...s,
          points: s.points + f.points,
          correct: s.correct + 1,
          ended: s.ended + 1,
          streak: s.streak + 1,
          times: [...s.times, f.elapsedMs],
        };
      if (f.kind === "timeout") return { ...s, ended: s.ended + 1, streak: 0 };
      return { ...s, wrong: s.wrong + 1 };
    });
  }, [game.feedback]);

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

  const playing = game.phase === "connecting" || game.phase === "countdown" || game.phase === "gap" || game.phase === "active";

  return (
    <section className="play">
        {game.phase === "ready" && startCard(game.start)}

        {playing && (
          <div className="play-grid">
            <div className="play-main">
              <div className="progress-row">
                <div className="progress">
                  {game.problem ? `${game.problem.index + 1} / ${game.problem.total}` : "Бэлдэж байна…"}
                </div>
              </div>
              <div className="sheet">
                {game.phase === "countdown" && game.countdownEndsAt !== null ? (
                  <Countdown endsAt={game.countdownEndsAt} />
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
            <StatsPanel stats={stats} level={game.problem?.level ?? null} levels={levels} />
          </div>
        )}

        {game.phase === "finished" && game.result && results(game.result, game.start)}

        {game.phase === "error" && (
          <div className="sheet">
            <p className="feedback bad">{game.error}</p>
            <button className="btn" onClick={game.start}>
              Дахин холбогдох
            </button>
          </div>
        )}
    </section>
  );
}
