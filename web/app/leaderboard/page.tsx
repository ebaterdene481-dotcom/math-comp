"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import {
  AUTH_EVENT,
  type CompetitionInfo,
  type Standing,
  fmtPoints,
  fmtWhen,
  getCurrentCompetition,
  getStandings,
} from "../lib/api";

const REFRESH_MS = 15_000;

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ok"; competition: CompetitionInfo; standings: Standing[] };

/** Every player's best score in the current competition, best first. */
export default function Leaderboard() {
  const [state, setState] = useState<Load>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const { competition } = await getCurrentCompetition();
      if (!competition) return setState({ kind: "none" });
      const r = await getStandings(competition.id);
      setState({ kind: "ok", competition: r.competition, standings: r.standings });
    } catch {
      setState((s) => (s.kind === "ok" ? s : { kind: "none" }));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    window.addEventListener(AUTH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTH_EVENT, load);
    };
  }, [load]);

  return (
    <main className="wrap">
      <SiteHeader />
      <section className="board-page">
        {state.kind === "loading" && <p className="meta">Ачаалж байна…</p>}
        {state.kind === "none" && (
          <div className="sheet">
            <h1 className="play-title">Тэргүүлэгчид</h1>
            <p>Одоогоор нээлттэй тэмцээн алга.</p>
          </div>
        )}
        {state.kind === "ok" && (
          <>
            <div className="board-page-head">
              <div>
                <h1>{state.competition.name}</h1>
                <p className="meta">
                  Шагнал: <b>{state.competition.prize}</b>.{" "}
                  {state.competition.status === "finished"
                    ? "Тэмцээн хаагдсан."
                    : `Хаагдах: ${fmtWhen(state.competition.closesAt)} эсвэл 100 оролдлого дуусахад.`}
                </p>
              </div>
              <p className="board-page-count">
                <b>{state.standings.length}</b> оролцогч
                <br />
                <b>{state.competition.attemptsUsed}</b>/{state.competition.maxAttempts} оролдлого
              </p>
            </div>
            {state.standings.length === 0 ? (
              <div className="sheet">
                <p>Одоогоор оноо алга. Эхний оролцогч болоорой.</p>
              </div>
            ) : (
              <div className="standings-card">
                <table className="standings">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Тоглогч</th>
                      <th scope="col" className="num">
                        Оролдлого
                      </th>
                      <th scope="col" className="num">
                        Шилдэг оноо
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.standings.map((s) => (
                      <tr key={s.rank} className={s.you ? "you" : undefined}>
                        <td className="rank">{s.rank}</td>
                        <td>
                          {s.nickname}
                          {s.you && <span className="you-tag">Та</span>}
                        </td>
                        <td className="num">{s.attempts}</td>
                        <td className="num pts">{fmtPoints(s.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="meta">
                  Тоглогч бүрийн хамгийн сайн оролдлого тооцогдоно. Оноо тэнцвэл түрүүлж авсан нь дээр.
                </p>
              </div>
            )}
            <div className="profile-foot">
              <Link href="/" className="btn">
                Тэмцээн рүү буцах
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
