"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type CompetitionInfo,
  type Entry,
  enterCompetition,
  fmtWhen,
  getWallet,
  groupDigits,
} from "./lib/api";

/** Confirms paying the entry fee from the wallet, then hands over to the play page. */
export function EnterDialog({
  competition,
  open,
  onClose,
  onEntered,
}: {
  competition: CompetitionInfo;
  open: boolean;
  onClose: () => void;
  onEntered: (entry: Entry) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setError(null);
      setEntry(null);
      setBalance(null);
      getWallet()
        .then((w) => setBalance(w.balance))
        .catch(() => setBalance(0));
    }
    if (!open && d.open) d.close();
  }, [open]);

  const fee = competition.entryFee;
  const short = balance !== null && balance < fee;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await enterCompetition(competition.id);
      setEntry(r.entry);
      setBalance(r.balance);
      onEntered(r.entry);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Алдаа гарлаа. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="auth"
      aria-labelledby="enter-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="auth-inner">
        <button type="button" className="auth-close" aria-label="Хаах" onClick={onClose}>
          ×
        </button>
        {entry ? (
          <>
            <h2 id="enter-title">Төлбөр төлөгдлөө</h2>
            <p>
              <b>{fmtWhen(entry.startBy)}</b>-аас өмнө эхлүүлнэ үү. Эхлүүлэх хүртэл 15 минут байна.
            </p>
            <p className="meta">Эхэлсний дараа 100 бодлого дараалан гарна. Холболт тасарсан ч цаг зогсохгүй.</p>
            <Link href="/play" className="btn enter-cta" onClick={onClose}>
              Одоо эхлүүлэх
            </Link>
          </>
        ) : (
          <>
            <h2 id="enter-title">Тэмцээнд оролцох</h2>
            <dl className="enter-sum">
              <div>
                <dt>Тэмцээн</dt>
                <dd>{competition.name}</dd>
              </div>
              <div>
                <dt>Хураамж</dt>
                <dd className="num">{groupDigits(fee)}₮</dd>
              </div>
              <div>
                <dt>Хэтэвчинд</dt>
                <dd className="num">{balance === null ? "…" : `${groupDigits(balance)}₮`}</dd>
              </div>
              {balance !== null && !short && (
                <div>
                  <dt>Төлсний дараа</dt>
                  <dd className="num">{groupDigits(balance - fee)}₮</dd>
                </div>
              )}
            </dl>
            <p className="meta">
              Нэг оролдлого = 100 бодлого. Төлснөөс хойш 15 минутын дотор эхлүүлэх ёстой, эс бөгөөс оролдлого
              хүчингүй болно.
            </p>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            {short ? (
              <>
                <p className="auth-error" role="alert">
                  Хэтэвчинд {groupDigits(fee - (balance ?? 0))}₮ дутуу байна.
                </p>
                <Link href="/wallet" className="btn enter-cta" onClick={onClose}>
                  Хэтэвч цэнэглэх
                </Link>
              </>
            ) : (
              <button type="button" className="btn enter-cta" disabled={busy || balance === null} onClick={pay}>
                {busy ? "Түр хүлээнэ үү…" : `${groupDigits(fee)}₮ төлөөд оролцох`}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
