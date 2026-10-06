"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type CompetitionInfo, type Leader, fmtPoints as fmtBig, getCurrentCompetition, groupDigits } from "../lib/api";
import type { Placing, ProblemResult } from "./useGame";

const LEVELS = 5;
const MAX_PER_PROBLEM = 10000; // hundredths
const TIME_LIMIT_MS = 5000;
/** A competition run has this many times the practice problems. */
const COMPETITION_SCALE = 5;

const sec = (ms: number) => (ms / 1000).toFixed(2);

/** Points rise by 10000 hundredths over 4500 ms, so this many ms per problem closes a 100-problem gap. */
const msFasterPerProblem = (gapHundredths: number) => Math.max(0, (gapHundredths / 100) * (4500 / 10000));

function longestStreak(results: ProblemResult[]) {
  let best = 0;
  let cur = 0;
  for (const r of results) {
    cur = r.solved ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function Results({
  result,
  onAgain,
}: {
  result: { totalPoints: number; results: ProblemResult[]; placing?: Placing };
  /** Practice only: play another round. */
  onAgain?: () => void;
}) {
  const rs = result.results;
  const solved = rs.filter((r) => r.solved && r.elapsedMs !== null);
  const times = solved.map((r) => r.elapsedMs!);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const fastest = times.length ? Math.min(...times) : null;
  const wrong = rs.reduce((n, r) => n + r.wrongTries, 0);
  const max = rs.length * MAX_PER_PROBLEM;
  const accuracy = Math.round((solved.length / rs.length) * 100);

  const perLevel = Array.from({ length: LEVELS }, (_, i) => {
    const items = rs.filter((r) => r.level === i + 1);
    return {
      level: i + 1,
      points: items.reduce((n, r) => n + r.points, 0),
      max: items.length * MAX_PER_PROBLEM,
      solved: items.filter((r) => r.solved).length,
      count: items.length,
    };
  });

  return (
    <div className="results-page">
      <div className="results-main">
        <div className="sheet results-head">
          <p className="total-label" style={{ margin: 0 }}>
            Нийт оноо
          </p>
          <div className="total">{fmtBig(result.totalPoints)}</div>
          <div className="score-meter" aria-hidden="true">
            <i style={{ width: `${(result.totalPoints / max) * 100}%` }} />
          </div>
          <p className="total-label">{fmtBig(max)} онооноос {Math.round((result.totalPoints / max) * 100)}%</p>

          <dl className="tiles">
            <div>
              <dt>Зөв хариулт</dt>
              <dd>
                {solved.length}/{rs.length} <small>{accuracy}%</small>
              </dd>
            </div>
            <div>
              <dt>Дундаж хугацаа</dt>
              <dd>{avg === null ? "–" : `${sec(avg)} с`}</dd>
            </div>
            <div>
              <dt>Хамгийн хурдан</dt>
              <dd>{fastest === null ? "–" : `${sec(fastest)} с`}</dd>
            </div>
            <div>
              <dt>Дараалсан зөв</dt>
              <dd>{longestStreak(rs)}</dd>
            </div>
            <div>
              <dt>Буруу оролдлого</dt>
              <dd>{wrong}</dd>
            </div>
            <div>
              <dt>Цаг дууссан</dt>
              <dd>{rs.length - solved.length}</dd>
            </div>
          </dl>
        </div>

        <section className="sheet chart-card" aria-labelledby="lvl-title">
          <h2 id="lvl-title">Шат бүрийн оноо</h2>
          <ul className="level-bars">
            {perLevel.map((l) => (
              <li key={l.level} title={`${l.level}-р шат: ${fmtBig(l.points)} / ${fmtBig(l.max)} оноо, ${l.solved}/${l.count} зөв`}>
                <span className="lb-label">{l.level}-р шат</span>
                <span className="lb-track">
                  <i style={{ width: `${l.max ? (l.points / l.max) * 100 : 0}%` }} />
                </span>
                <span className="lb-value">
                  {fmtBig(l.points)} <small>{l.solved}/{l.count}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sheet chart-card" aria-labelledby="time-title">
          <h2 id="time-title">Бодлого бүрийн хугацаа</h2>
          <div className="time-chart">
            <div className="tc-axis" aria-hidden="true">
              <span>5 с</span>
              <span>0</span>
            </div>
            <ol className={`tc-bars${rs.length > 30 ? " dense" : ""}`}>
              {rs.map((r, i) => (
                <li
                  key={i}
                  className={r.solved ? undefined : "miss"}
                  title={`${i + 1}. ${r.text} = ${r.answer}: ${r.solved ? `${sec(r.elapsedMs!)} с, ${fmtBig(r.points)} оноо` : "цаг дууссан"}`}
                >
                  <i style={{ height: `${r.solved ? Math.max(3, (r.elapsedMs! / TIME_LIMIT_MS) * 100) : 100}%` }} />
                  <span>{rs.length <= 30 || i === 0 || (i + 1) % 10 === 0 ? i + 1 : ""}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="meta">Богино багана нь хурдан. Улаан нь цаг дууссан бодлого.</p>
        </section>

        <details className="sheet details-card">
          <summary>Бүх бодлогын хүснэгт</summary>
          <table className="results">
            <thead>
              <tr>
                <th>Бодлого</th>
                <th className="num">Хариу</th>
                <th className="num">Хугацаа</th>
                <th className="num">Буруу</th>
                <th className="num">Оноо</th>
              </tr>
            </thead>
            <tbody>
              {rs.map((r, i) => (
                <tr key={i} className={r.solved ? "" : "miss"}>
                  <td>{r.text}</td>
                  <td className="num">{r.answer}</td>
                  <td className="num">{r.elapsedMs === null ? "–" : `${sec(r.elapsedMs)} с`}</td>
                  <td className="num">{r.wrongTries || ""}</td>
                  <td className="num">{fmtBig(r.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="results-side">
        {result.placing ? <PlacingCard placing={result.placing} total={result.totalPoints} /> : <Compare total={result.totalPoints} />}
        <div className="actions results-actions">
          {onAgain ? (
            <button className="btn" onClick={onAgain}>
              Дахин тоглох
            </button>
          ) : (
            <Link href="/leaderboard" className="btn">
              Бүх тэргүүлэгчид
            </Link>
          )}
          <Link href="/" className="btn btn-quiet">
            Нүүр хуудас
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Where this pace would land on the live competition's leaderboard. */
function Compare({ total }: { total: number }) {
  const [data, setData] = useState<{ competition: CompetitionInfo | null; leaders: Leader[] } | null>(null);
  useEffect(() => {
    getCurrentCompetition()
      .then(setData)
      .catch(() => setData({ competition: null, leaders: [] }));
  }, []);

  const projected = total * COMPETITION_SCALE;
  if (!data) return <section className="sheet compare"><p className="meta">Ачаалж байна…</p></section>;
  if (!data.competition || data.leaders.length === 0) {
    return (
      <section className="sheet compare">
        <h2>Тэмцээнд бол</h2>
        <p>
          Энэ хурдаар 100 бодлогод ойролцоогоор <b className="num">{fmtBig(projected)}</b> оноо авна.
        </p>
      </section>
    );
  }

  const rows: Array<{ nickname: string; points: number; you?: boolean; rank: number | null }> = data.leaders.map(
    (l) => ({ nickname: l.nickname, points: l.points, rank: l.rank }),
  );
  const pos = rows.findIndex((r) => projected > r.points);
  const you = { nickname: "Та", points: projected, you: true, rank: pos === -1 ? null : pos + 1 };
  if (pos === -1) rows.push(you);
  else {
    rows.splice(pos, 0, you);
    for (let i = pos + 1; i < rows.length; i++) rows[i].rank = i + 1;
  }
  const third = data.leaders[data.leaders.length - 1];
  const gap = third.points - projected;

  return (
    <section className="sheet compare" aria-labelledby="cmp-title">
      <h2 id="cmp-title">Тэмцээнд бол хэддүгээрт орох вэ</h2>
      <p className="meta">
        {data.competition.name}. Таны хурдаар 100 бодлогод шилжүүлсэн тооцоо.
      </p>
      <ol className="leaders compare-list">
        {rows.slice(0, 4).map((r, i) => (
          <li key={i} className={r.you ? "you" : r.rank === 1 ? "first" : undefined}>
            <span className="rank">{r.rank ?? "…"}</span>
            <span className="nick">{r.you ? "Та (тооцоо)" : r.nickname}</span>
            <span className="pts">
              {fmtBig(r.points)}
              <small> оноо</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="compare-note">
        {pos === -1 ? (
          <>
            Топ 3-т орохын тулд ойролцоогоор <b>{fmtBig(gap)}</b> оноо дутуу байна. Бодлого бүрийг{" "}
            <b>{sec(msFasterPerProblem(gap))}</b> секундээр хурдан бодвол хүрнэ.
          </>
        ) : (
          <>Энэ хурдаар бодвол {pos + 1}-р байранд орох боломжтой.</>
        )}
      </p>
      <Link href="/" className="btn compare-cta">
        Тэмцээнд оролцох: {data.competition.entryFee.toLocaleString("en-US").replace(/,/g, " ")}₮
      </Link>
    </section>
  );
}

/** A paid attempt's real place on the leaderboard. */
function PlacingCard({ placing, total }: { placing: Placing; total: number }) {
  const inTop = placing.rank !== null && placing.rank <= 3;
  const third = placing.top[placing.top.length - 1];
  return (
    <section className="sheet compare" aria-labelledby="place-title">
      <h2 id="place-title">Таны байр</h2>
      <div className="placing">
        <span className="placing-rank">{placing.rank ?? "–"}</span>
        <span className="meta">{placing.players} оролцогчоос</span>
      </div>
      <p className="meta">
        Тэргүүлэгчдийн жагсаалтад таны хамгийн сайн оролдлого орно. Ижил оноотой бол түрүүлж авсан нь өмнө
        орно.
      </p>
      <ol className="leaders compare-list">
        {placing.top.map((l) => (
          <li key={l.rank} className={l.rank === 1 ? "first" : undefined}>
            <span className="rank">{l.rank}</span>
            <span className="nick">{l.nickname}</span>
            <span className="pts">
              {fmtBig(l.points)}
              <small> оноо</small>
            </span>
          </li>
        ))}
      </ol>
      {!inTop && third && (
        <p className="compare-note">
          Топ 3-т орохын тулд <b>{fmtBig(Math.max(0, third.points - total))}</b> оноо дутуу байна.
        </p>
      )}
    </section>
  );
}
