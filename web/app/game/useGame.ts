"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ProblemResult {
  text: string;
  answer: number;
  level: number;
  solved: boolean;
  elapsedMs: number | null;
  points: number;
  wrongTries: number;
}

type ServerMessage =
  | { type: "countdown"; ms: number }
  | { type: "problem"; index: number; total: number; level: number; text: string; timeLimitMs: number }
  | { type: "wrong" }
  | { type: "correct"; points: number; elapsedMs: number }
  | { type: "timeout"; answer: number }
  | { type: "finished"; totalPoints: number; results: ProblemResult[]; placing?: Placing }
  | { type: "ping"; id: number }
  | { type: "error"; message: string }
  | { type: "progress"; progress: Progress };

/** Running totals the server re-sends when a player rejoins a paid run. */
export interface Progress {
  points: number;
  correct: number;
  ended: number;
  wrong: number;
  streak: number;
  times: number[];
}

/** Where a paid attempt landed on the leaderboard (sent with the result). */
export interface Placing {
  rank: number | null;
  players: number;
  top: Array<{ rank: number; nickname: string; points: number }>;
}

export type Phase = "ready" | "connecting" | "countdown" | "gap" | "active" | "finished" | "error";

export type Feedback =
  | { kind: "correct"; points: number; elapsedMs: number }
  | { kind: "wrong"; at: number }
  | { kind: "timeout"; answer: number }
  | null;

export const PRACTICE_WS_URL = process.env.NEXT_PUBLIC_GAME_WS_URL ?? "ws://localhost:4000/ws/practice";

const ERRORS: Record<string, string> = {
  rate_limited: "Нэг цагт хийх туршилтын тоо дууслаа. Хэсэг хугацааны дараа дахин оролдоно уу.",
  signed_out: "Нэвтэрсний дараа эхлүүлнэ үү.",
  expired: "Эхлэх 15 минутын хугацаа дууссан байна.",
  used: "Энэ оролдлого аль хэдийн дууссан байна.",
  not_found: "Оролдлого олдсонгүй.",
};

export function useGame(url: string = PRACTICE_WS_URL) {
  const ws = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [problem, setProblem] = useState<{
    index: number;
    total: number;
    level: number;
    text: string;
    timeLimitMs: number;
    shownAt: number;
  } | null>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [result, setResult] = useState<{ totalPoints: number; results: ProblemResult[]; placing?: Placing } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const start = useCallback(() => {
    ws.current?.close();
    setPhase("connecting");
    setProblem(null);
    setFeedback(null);
    setResult(null);
    setError(null);

    const sock = new WebSocket(url);
    ws.current = sock;
    let finished = false;

    sock.onopen = () => setPhase("gap");
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      switch (msg.type) {
        case "ping":
          sock.send(JSON.stringify({ type: "pong", id: msg.id }));
          break;
        case "progress":
          setProgress(msg.progress);
          break;
        case "countdown":
          setCountdownEndsAt(performance.now() + msg.ms);
          setPhase("countdown");
          break;
        case "problem":
          setProblem({ ...msg, shownAt: performance.now() });
          setFeedback(null);
          setPhase("active");
          break;
        case "wrong":
          setFeedback({ kind: "wrong", at: performance.now() });
          break;
        case "correct":
          setFeedback({ kind: "correct", points: msg.points, elapsedMs: msg.elapsedMs });
          setPhase("gap");
          break;
        case "timeout":
          setFeedback({ kind: "timeout", answer: msg.answer });
          setPhase("gap");
          break;
        case "finished":
          finished = true;
          setResult({ totalPoints: msg.totalPoints, results: msg.results, placing: msg.placing });
          setPhase("finished");
          break;
        case "error":
          setError(ERRORS[msg.message] ?? "Серверт алдаа гарлаа. Дахин эхлүүлнэ үү.");
          setPhase("error");
          break;
      }
    };
    sock.onclose = () => {
      if (finished) return;
      setError((e) => e ?? "Холболт тасарлаа. Интернэтээ шалгаад дахин эхлүүлнэ үү.");
      setPhase("error");
    };
  }, [url]);

  const answer = useCallback((value: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "answer", value }));
    }
  }, []);

  useEffect(() => () => ws.current?.close(), []);

  return { phase, problem, feedback, result, error, start, answer, countdownEndsAt, progress };
}
