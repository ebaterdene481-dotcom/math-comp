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
  | { type: "problem"; index: number; total: number; text: string; timeLimitMs: number }
  | { type: "wrong" }
  | { type: "correct"; points: number; elapsedMs: number }
  | { type: "timeout"; answer: number }
  | { type: "finished"; totalPoints: number; results: ProblemResult[] }
  | { type: "ping"; id: number }
  | { type: "error"; message: string };

export type Phase = "ready" | "connecting" | "gap" | "active" | "finished" | "error";

export type Feedback =
  | { kind: "correct"; points: number; elapsedMs: number }
  | { kind: "wrong"; at: number }
  | { kind: "timeout"; answer: number }
  | null;

const WS_URL = process.env.NEXT_PUBLIC_GAME_WS_URL ?? "ws://localhost:4000/ws/practice";

export function useGame() {
  const ws = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [problem, setProblem] = useState<{ index: number; total: number; text: string; timeLimitMs: number; shownAt: number } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [result, setResult] = useState<{ totalPoints: number; results: ProblemResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    ws.current?.close();
    setPhase("connecting");
    setProblem(null);
    setFeedback(null);
    setResult(null);
    setError(null);

    const sock = new WebSocket(WS_URL);
    ws.current = sock;
    let finished = false;

    sock.onopen = () => setPhase("gap");
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      switch (msg.type) {
        case "ping":
          sock.send(JSON.stringify({ type: "pong", id: msg.id }));
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
          setResult({ totalPoints: msg.totalPoints, results: msg.results });
          setPhase("finished");
          break;
        case "error":
          setError(
            msg.message === "rate_limited"
              ? "Нэг цагт хийх туршилтын тоо дууслаа. Хэсэг хугацааны дараа дахин оролдоно уу."
              : "Серверт алдаа гарлаа. Дахин эхлүүлнэ үү.",
          );
          setPhase("error");
          break;
      }
    };
    sock.onclose = () => {
      if (finished) return;
      setError((e) => e ?? "Холболт тасарлаа. Интернэтээ шалгаад дахин эхлүүлнэ үү.");
      setPhase("error");
    };
  }, []);

  const answer = useCallback((value: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "answer", value }));
    }
  }, []);

  useEffect(() => () => ws.current?.close(), []);

  return { phase, problem, feedback, result, error, start, answer };
}
