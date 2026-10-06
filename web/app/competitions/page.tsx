"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "../SiteHeader";
import { type PastCompetition, fmtPoints, getPastCompetitions, groupDigits } from "../lib/api";

const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtDate = (iso: string) => date.format(new Date(iso)).replace(/-/g, ".");

/** Every competition that has closed, newest first, with who won it. */
export default function Competitions() {
  const [list, setList] = useState<PastCompetition[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getPastCompetitions()
      .then((r) => setList(r.competitions))
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="wrap">
      <SiteHeader />
      <section className="comp-page">
        <div className="page-head">
          <h1>Өмнөх тэмцээнүүд</h1>
          <p className="meta">Дууссан тэмцээн бүрийн ялагч, шагнал. Дарж эцсийн дүнг үзнэ үү.</p>
        </div>
        {!list && !failed && <p className="meta">Ачаалж байна…</p>}
        {failed && <p className="meta">Жагсаалтыг ачаалж чадсангүй. Дахин оролдоно уу.</p>}
        {list && list.length === 0 && (
          <div className="sheet">
            <p>Одоогоор дууссан тэмцээн алга. Эхний тэмцээн дуусмагц энд гарна.</p>
          </div>
        )}
        {list && list.length > 0 && (
          <ul className="past-list">
            {list.map((c) => (
              <li key={c.id}>
                <Link href={`/competition?id=${c.id}`} className="past-card">
                  <span className="past-img">
                    {c.prizeImage ? <img src={c.prizeImage} alt="" /> : null}
                  </span>
                  <span className="past-body">
                    <span className="past-date">{fmtDate(c.closesAt)}-нд дууссан</span>
                    <span className="past-name">{c.name}</span>
                    <span className="past-prize">Шагнал: {c.prize}</span>
                    <span className="past-winner">
                      {c.winner ? (
                        <>
                          <span className="stat-label">Ялагч</span>
                          <b>{c.winner.nickname}</b>
                          <span className="past-pts">{fmtPoints(c.winner.points)}</span>
                        </>
                      ) : (
                        <span className="stat-label">Ялагч тодроогүй</span>
                      )}
                    </span>
                    <span className="past-meta">
                      {c.players} тоглогч · {c.attemptsUsed}/{c.maxAttempts} оролдлого · хураамж{" "}
                      {groupDigits(c.entryFee)}₮
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="profile-foot">
          <Link href="/" className="btn">
            Одоогийн тэмцээн рүү
          </Link>
        </div>
      </section>
    </main>
  );
}
