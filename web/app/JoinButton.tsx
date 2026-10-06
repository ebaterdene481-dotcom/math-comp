"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthDialog } from "./AuthDialog";
import { EnterDialog } from "./EnterDialog";
import {
  AUTH_EVENT,
  type CompetitionInfo,
  type Entry,
  type User,
  announceAuthChange,
  fmtWhen,
  getMe,
  getOpenEntries,
  groupDigits,
} from "./lib/api";

/**
 * The button that gets a player into the competition: sign in, pay the fee, or
 * start / continue an attempt already paid for. A player may buy more attempts while
 * one is waiting, so a live competition keeps the pay button under the start link.
 */
export function JoinButton({ competition: c, onEntered }: { competition: CompetitionInfo; onEntered?: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [openEntry, setOpenEntry] = useState<Entry | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [enterOpen, setEnterOpen] = useState(false);

  const loadMe = useCallback(
    () =>
      getMe()
        .then((r) => {
          setUser(r.user);
          if (!r.user) return setOpenEntry(null);
          return getOpenEntries().then(
            (e) => setOpenEntry(e.entries.find((x) => x.status === "playing") ?? e.entries[0] ?? null),
          );
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    loadMe();
    window.addEventListener(AUTH_EVENT, loadMe);
    return () => window.removeEventListener(AUTH_EVENT, loadMe);
  }, [loadMe]);

  return (
    <>
      {c.status === "live" && !user && (
        <button className="btn" type="button" onClick={() => setAuthOpen(true)}>
          Оролцох
        </button>
      )}
      {user && openEntry && (
        <Link href="/play" className="btn">
          {openEntry.status === "playing" ? "Оролдлогоо үргэлжлүүлэх" : "Оролдлогоо эхлүүлэх"}
        </Link>
      )}
      {c.status === "live" && user && (
        <button
          className={openEntry ? "btn btn-quiet join-extra" : "btn"}
          type="button"
          onClick={() => setEnterOpen(true)}
        >
          {openEntry ? "Дахин оролцох" : "Оролцох"}: <span className="fee">{groupDigits(c.entryFee)}₮</span>
        </button>
      )}
      {c.status === "upcoming" && (
        <button className="btn" type="button" disabled>
          {fmtWhen(c.opensAt)}-д эхэлнэ
        </button>
      )}

      <EnterDialog
        competition={c}
        open={enterOpen}
        onClose={() => setEnterOpen(false)}
        onEntered={(e) => {
          setOpenEntry((cur) => cur ?? e);
          onEntered?.();
        }}
      />
      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(u) => {
          setUser(u);
          setAuthOpen(false);
          announceAuthChange();
        }}
      />
    </>
  );
}
