"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthDialog } from "./AuthDialog";
import {
  type CompetitionInfo,
  type Leader,
  type User,
  fmtPoints,
  fmtWhen,
  getCurrentCompetition,
  getMe,
  groupDigits,
  logout,
} from "./lib/api";

const REFRESH_MS = 15_000;

const AVATAR_COLORS = ["#2443c4", "#d42a3b", "#1f8a5b", "#7a3fc0", "#d9731a", "#138a9e"];

function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const STATUS_TEXT = {
  live: "Явагдаж байна",
  upcoming: "Удахгүй эхэлнэ",
  finished: "Дууссан",
} as const;

type Load = { state: "loading" } | { state: "offline" } | { state: "ok"; competition: CompetitionInfo | null; leaders: Leader[] };

export function CompetitionBoard() {
  const [data, setData] = useState<Load>({ state: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await getCurrentCompetition();
      setData({ state: "ok", ...d });
    } catch {
      setData((prev) => (prev.state === "ok" ? prev : { state: "offline" }));
    }
  }, []);

  useEffect(() => {
    refresh();
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => {});
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const c = data.state === "ok" ? data.competition : null;

  return (
    <aside className="board" aria-labelledby="board-title">
      {data.state === "loading" && <p className="meta">Ачаалж байна…</p>}

      {(data.state === "offline" || (data.state === "ok" && !c)) && (
        <>
          <h2 id="board-title">Тэргүүлэгчид</h2>
          <div className="empty">
            <p>Одоогоор нээлттэй тэмцээн алга.</p>
            <p className="meta">
              Тэмцээн нээгдэхэд оролцогчдын хамгийн сайн оноо энд харагдана. Тэр болтол үнэгүй туршилтаар
              дасгал хий.
            </p>
          </div>
        </>
      )}

      {c && data.state === "ok" && (
        <>
          <div className="board-head">
            <h2 id="board-title">{c.name}</h2>
            <span className={`status status-${c.status}`}>{STATUS_TEXT[c.status]}</span>
          </div>
          <p className="meta">
            Шагнал: <b>{c.prize}</b>
            <br />
            {c.status === "live" && <>Хаагдах: {fmtWhen(c.closesAt)} эсвэл 100 оролдлого дуусахад</>}
            {c.status === "upcoming" && <>Эхлэх: {fmtWhen(c.opensAt)}</>}
            {c.status === "finished" && <>Тэмцээн хаагдсан</>}
          </p>

          <Slots used={c.attemptsUsed} max={c.maxAttempts} />

          <h3 className="board-sub">Тэргүүлэгчид</h3>
          {data.leaders.length === 0 ? (
            <p className="meta">Одоогоор оноо алга. Эхний оролцогч болоорой.</p>
          ) : (
            <ol className="leaders">
              {data.leaders.map((l) => (
                <li key={l.rank} className={l.rank === 1 ? "first" : undefined}>
                  <span className="rank">{l.rank}</span>
                  <span className="avatar" style={{ background: avatarColor(l.nickname) }} aria-hidden="true">
                    {[...l.nickname][0]?.toUpperCase()}
                  </span>
                  <span className="nick">{l.nickname}</span>
                  <span className="pts">
                    {fmtPoints(l.points)}
                    <small> оноо</small>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="join">
            {c.status === "live" && !user && (
              <button className="btn" type="button" onClick={() => setAuthOpen(true)}>
                Оролцох
              </button>
            )}
            {c.status === "live" && user && (
              <button
                className="btn"
                type="button"
                onClick={() => setNote("Төлбөр төлөх хэсэг удахгүй нэмэгдэнэ.")}
              >
                Оролцох: <span className="fee">{groupDigits(c.entryFee)}₮</span>
              </button>
            )}
            {c.status === "upcoming" && (
              <button className="btn" type="button" disabled>
                {fmtWhen(c.opensAt)}-д эхэлнэ
              </button>
            )}
            {c.status === "finished" && data.leaders[0] && (
              <p className="winner">
                Ялагч: <b>{data.leaders[0].nickname}</b>
              </p>
            )}
            {note && (
              <p className="meta" role="status">
                {note}
              </p>
            )}
            {user && (
              <p className="signed-in">
                {user.nickname} нэрээр нэвтэрсэн.{" "}
                <button
                  type="button"
                  className="link"
                  onClick={async () => {
                    await logout().catch(() => {});
                    setUser(null);
                    setNote(null);
                  }}
                >
                  Гарах
                </button>
              </p>
            )}
          </div>
        </>
      )}

      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(u) => {
          setUser(u);
          setAuthOpen(false);
        }}
      />
    </aside>
  );
}

function Slots({ used, max }: { used: number; max: number }) {
  const left = Math.max(0, max - used);
  return (
    <div className="slots">
      <div
        className="slots-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
        aria-label={`${max} оролдлогоос ${used} нь ашиглагдсан`}
      >
        <i style={{ width: `${(used / max) * 100}%` }} />
      </div>
      <div className="slots-legend">
        <span>
          <b>{used}</b> оролцсон
        </span>
        <span>
          <b>{left}</b> үлдсэн
        </span>
      </div>
    </div>
  );
}
