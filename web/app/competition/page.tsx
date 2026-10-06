"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { STATUS_TEXT, Slots, avatarColor } from "../CompetitionBoard";
import { JoinButton } from "../JoinButton";
import { SiteHeader } from "../SiteHeader";
import {
  AUTH_EVENT,
  type CompetitionInfo,
  type Standing,
  fmtPoints,
  fmtWhen,
  getCurrentCompetition,
  getStandings,
  groupDigits,
} from "../lib/api";

const REFRESH_MS = 15_000;

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ok"; competition: CompetitionInfo; standings: Standing[] };

/** "3 цаг 12 минут" until `iso`, refreshed every 30 s. */
function TimeLeft({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(
    0,
    Math.round((new Date(iso).getTime() - now) / 60_000),
  );
  const h = Math.floor(mins / 60);
  return <>{h > 0 ? `${h} цаг ${mins % 60} минут` : `${mins} минут`}</>;
}

/** The competition: what it is, how to take part, and everyone's best score so far. */
export default function CompetitionPage() {
  const [state, setState] = useState<Load>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const { competition } = await getCurrentCompetition();
      if (!competition) return setState({ kind: "none" });
      const r = await getStandings(competition.id);
      setState({
        kind: "ok",
        competition: r.competition,
        standings: r.standings,
      });
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
      <section className="comp-page">
        {state.kind === "loading" && <p className="meta">Ачаалж байна…</p>}
        {state.kind === "none" && (
          <div className="sheet">
            <h1 className="play-title">Тэмцээн</h1>
            <p>
              Одоогоор нээлттэй тэмцээн алга. Тэр болтол үнэгүй туршилтаар
              дасгал хий.
            </p>
            <div className="sheet-actions">
              <Link href="/practice" className="btn">
                20 бодлогоор туршиж үзэх
              </Link>
            </div>
          </div>
        )}
        {state.kind === "ok" && (
          <CompetitionView
            c={state.competition}
            standings={state.standings}
            reload={load}
          />
        )}
      </section>
    </main>
  );
}

function CompetitionView({
  c,
  standings,
  reload,
}: {
  c: CompetitionInfo;
  standings: Standing[];
  reload: () => void;
}) {
  const best = standings[0]?.points ?? null;
  const me = standings.find((s) => s.you);

  return (
    <>
      <div className="comp-top">
        <div className="comp-main">
          <article className="comp-card comp-info">
            {c.prizeImage && (
              <figure className="comp-prize">
                <img src={c.prizeImage} alt={c.prize} />
              </figure>
            )}
            <div className="comp-body">
              <span className={`status status-${c.status}`}>
                {STATUS_TEXT[c.status]}
              </span>
              <h1>{c.name}</h1>
              <dl className="comp-facts">
                <div>
                  <dt>Шагнал</dt>
                  <dd>{c.prize}</dd>
                </div>
                <div>
                  <dt>Хураамж</dt>
                  <dd className="num">{groupDigits(c.entryFee)}₮</dd>
                </div>
                <div>
                  <dt>Нээгдсэн</dt>
                  <dd className="num">{fmtWhen(c.opensAt)}</dd>
                </div>
                <div>
                  <dt>Хаагдах</dt>
                  <dd>
                    <span className="num">{fmtWhen(c.closesAt)}</span>
                    {c.status === "live" && (
                      <small>
                        <TimeLeft iso={c.closesAt} /> үлдсэн
                      </small>
                    )}
                  </dd>
                </div>
              </dl>
              <Slots used={c.attemptsUsed} max={c.maxAttempts} />
              <div className="join">
                <JoinButton competition={c} onEntered={reload} />
                {c.status === "finished" && standings[0] && (
                  <p className="winner">
                    Ялагч: <b>{standings[0].nickname}</b>
                  </p>
                )}
              </div>
            </div>
          </article>
          <dl className="tiles comp-tiles">
            <div>
              <dt>Таны байр</dt>
              <dd>{me ? me.rank : "–"}</dd>
            </div>
            <div>
              <dt>Нийт оролцогчид</dt>
              <dd>
                {c.attemptsUsed}
                <small>/{c.maxAttempts}</small>
              </dd>
            </div>
            <div>
              <dt>Тэргүүлэгчийн оноо</dt>
              <dd>{best === null ? "–" : fmtPoints(best)}</dd>
            </div>
          </dl>
        </div>

        <aside className="comp-card comp-rules" aria-labelledby="rules-title">
          <h2 id="rules-title">Дүрэм</h2>
          <ul>
            <li>
              Нэг оролдлого = 100 бодлого: 5 шат, шат бүрт 20. Бодлого бүрт 5
              секунд.
            </li>
            <li>
              0.5 секундэд зөв хариулбал 100 оноо, 5 секундэд 0 болтол жигд
              буурна. Нэг оролдлогоос 10 000 хүртэл оноо.
            </li>
            <li>Буруу хариулбал дахин бичнэ, цаг үргэлжилнэ.</li>
            <li>
              Хураамжаа төлснөөс хойш 15 минутын дотор эхлүүлэх ёстой. Эс бөгөөс
              оролдлого хүчингүй болж, хураамж буцаагдахгүй.
            </li>
            <li>
              Хэдэн ч удаа оролцож болно. Таны хамгийн сайн оноо жагсаалтад
              орно.
            </li>
            <li>Оноо тэнцвэл түрүүлж авсан нь дээр байрлана.</li>
            <li>
              Нийт {c.maxAttempts} оролдлого дуусах эсвэл хаагдах цаг болоход
              тэмцээн дуусч, 1-р байр шагналаа авна.
            </li>
          </ul>
        </aside>
      </div>

      {me && <YourPlace me={me} standings={standings} />}

      <section
        className="comp-card standings-card"
        aria-labelledby="leaders-title"
      >
        <div className="standings-head">
          <h2 id="leaders-title">Одоогийн тэргүүлэгчид</h2>
          <span className="meta">15 секунд тутам шинэчлэгдэнэ</span>
        </div>
        {standings.length === 0 ? (
          <p className="meta">Одоогоор оноо алга. Эхний оролцогч болоорой.</p>
        ) : (
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Тоглогч</th>
                <th scope="col" className="num">
                  Шилдэг оноо
                </th>
                <th scope="col" className="num col-gap">
                  1-р байрнаас
                </th>
                <th scope="col" className="num col-tries">
                  Оролдлого
                </th>
                <th scope="col" className="num col-time">
                  Авсан цаг
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr
                  key={s.rank}
                  className={
                    [s.you ? "you" : "", s.rank <= 3 ? `top top-${s.rank}` : ""]
                      .join(" ")
                      .trim() || undefined
                  }
                >
                  <td className="rank">
                    <span>{s.rank}</span>
                  </td>
                  <td>
                    <span className="player">
                      <span
                        className="avatar"
                        style={
                          {
                            "--av": avatarColor(s.nickname),
                          } as React.CSSProperties
                        }
                        aria-hidden="true"
                      >
                        {[...s.nickname][0]?.toUpperCase()}
                      </span>
                      <span className="nick">{s.nickname}</span>
                      {s.you && <span className="you-tag">Та</span>}
                    </span>
                  </td>
                  <td className="num pts">{fmtPoints(s.points)}</td>
                  <td className="num col-gap gap">
                    {s.rank === 1 ? "–" : `−${fmtPoints(best! - s.points)}`}
                  </td>
                  <td className="num col-tries">{s.attempts}</td>
                  <td className="num col-time">{fmtWhen(s.achievedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="meta">
          Тоглогч бүрийн хамгийн сайн оролдлого тооцогдоно. «Авсан цаг» нь тэр
          оноог авсан мөч бөгөөд оноо тэнцвэл эрт авсан нь дээр.
        </p>
      </section>
    </>
  );
}

function YourPlace({ me, standings }: { me: Standing; standings: Standing[] }) {
  const above = standings.find((s) => s.rank === me.rank - 1);
  return (
    <section className="comp-card your-place" aria-label="Таны байр">
      <div>
        <span className="stat-label">Таны байр</span>
        <span className="placing-rank">{me.rank}</span>
        <span className="meta">{standings.length} оролцогчоос</span>
      </div>
      <div>
        <span className="stat-label">Таны шилдэг оноо</span>
        <span className="your-pts">{fmtPoints(me.points)}</span>
        <span className="meta">{me.attempts} оролдлогоос</span>
      </div>
      <p className="your-next">
        {above
          ? `${above.rank}-р байр (${above.nickname}) хүртэл ${fmtPoints(above.points - me.points)} оноо дутуу байна.`
          : "Та тэргүүлж байна. Тэмцээн дуустал байраа хадгалаарай."}
      </p>
    </section>
  );
}
