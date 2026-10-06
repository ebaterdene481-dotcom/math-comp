// One player's run through a problem set. The server owns the clock:
// the browser only displays problems and forwards what the player typed.

import type { Problem } from "./problems.js";
import { TIME_LIMIT_MS, parseAnswer, scoreHundredths } from "./scoring.js";

/** Pause between problems; not counted against anyone. */
export const GAP_MS = 1000;
/** At most this much network delay is credited back per answer. */
export const MAX_LATENCY_CREDIT_MS = 300;
/** Answers beyond this many per second on one problem are ignored (stops guess spamming). */
export const MAX_ANSWERS_PER_SECOND = 5;
export const PING_INTERVAL_MS = 2000;
/** Get-ready countdown before the first problem of a run. */
export const COUNTDOWN_MS = 10_000;
const RTT_SAMPLES = 10;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type ServerMessage =
  | { type: "countdown"; ms: number }
  | { type: "problem"; index: number; total: number; level: number; text: string; timeLimitMs: number }
  | { type: "wrong" }
  | { type: "correct"; points: number; elapsedMs: number }
  | { type: "timeout"; answer: number }
  | { type: "finished"; totalPoints: number; results: ProblemResult[] }
  | { type: "ping"; id: number };

export type ClientMessage = { type: "answer"; value: string } | { type: "pong"; id: number };

export interface ProblemResult {
  text: string;
  answer: number;
  level: number;
  solved: boolean;
  /** Latency-compensated time to the correct answer, or null if unsolved. */
  elapsedMs: number | null;
  /** Integer hundredths of a point. */
  points: number;
  wrongTries: number;
}

type State = "idle" | "gap" | "active" | "finished";

export class GameSession {
  private state: State = "idle";
  private index = -1;
  private sentAt = 0;
  private credit = 0;
  private timer: unknown = null;
  private pingTimer: unknown = null;
  private pingId = 0;
  private pings = new Map<number, number>();
  private rtts: number[] = [];
  private recentAnswers: number[] = [];
  readonly results: ProblemResult[];

  constructor(
    private readonly problems: Problem[],
    private readonly send: (msg: ServerMessage) => void,
    private readonly clock: Clock = systemClock,
    /** Wait before the first problem; the client shows it as a countdown. */
    private readonly countdownMs = 0,
  ) {
    this.results = problems.map((p) => ({
      text: p.text,
      answer: p.answer,
      level: p.level,
      solved: false,
      elapsedMs: null,
      points: 0,
      wrongTries: 0,
    }));
  }

  start() {
    if (this.state !== "idle") return;
    this.ping();
    if (this.countdownMs > 0) {
      this.state = "gap";
      this.send({ type: "countdown", ms: this.countdownMs });
      this.timer = this.clock.setTimeout(() => this.sendProblem(), this.countdownMs);
      return;
    }
    this.scheduleNext();
  }

  /** Stops all timers, e.g. when the connection closes. */
  stop() {
    this.clearTimer();
    if (this.pingTimer !== null) this.clock.clearTimeout(this.pingTimer);
    this.pingTimer = null;
    if (this.state !== "finished") this.state = "finished";
  }

  get finished() {
    return this.state === "finished";
  }

  get totalPoints() {
    return this.results.reduce((sum, r) => sum + r.points, 0);
  }

  /** Current latency credit: half the median round trip, capped. */
  latencyCreditMs(): number {
    if (this.rtts.length === 0) return 0;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.min(MAX_LATENCY_CREDIT_MS, Math.round(median / 2));
  }

  handle(msg: ClientMessage) {
    if (msg.type === "pong") return this.onPong(msg.id);
    if (msg.type === "answer") return this.onAnswer(msg.value);
  }

  private onPong(id: number) {
    const t = this.pings.get(id);
    if (t === undefined) return;
    this.pings.delete(id);
    this.rtts.push(this.clock.now() - t);
    if (this.rtts.length > RTT_SAMPLES) this.rtts.shift();
  }

  private onAnswer(raw: string) {
    if (this.state !== "active") return;
    const receivedAt = this.clock.now();

    this.recentAnswers = this.recentAnswers.filter((t) => receivedAt - t < 1000);
    if (this.recentAnswers.length >= MAX_ANSWERS_PER_SECOND) return;
    this.recentAnswers.push(receivedAt);

    const elapsed = Math.max(0, receivedAt - this.sentAt - this.credit);
    if (elapsed >= TIME_LIMIT_MS) return; // the timeout timer will close this problem

    const result = this.results[this.index];
    const value = parseAnswer(raw);
    if (value === null || value !== result.answer) {
      result.wrongTries++;
      this.send({ type: "wrong" });
      return;
    }

    result.solved = true;
    result.elapsedMs = Math.round(elapsed);
    result.points = scoreHundredths(elapsed);
    this.clearTimer();
    this.send({ type: "correct", points: result.points, elapsedMs: result.elapsedMs });
    this.scheduleNext();
  }

  private scheduleNext() {
    if (this.index + 1 >= this.problems.length) return this.finish();
    this.state = "gap";
    this.timer = this.clock.setTimeout(() => this.sendProblem(), GAP_MS);
  }

  private sendProblem() {
    this.index++;
    this.state = "active";
    this.recentAnswers = [];
    // Credit is fixed when the problem goes out, so it can't be inflated mid-problem.
    this.credit = this.latencyCreditMs();
    this.sentAt = this.clock.now();
    const p = this.problems[this.index];
    this.send({
      type: "problem",
      index: this.index,
      total: this.problems.length,
      level: p.level,
      text: p.text,
      timeLimitMs: TIME_LIMIT_MS,
    });
    this.timer = this.clock.setTimeout(() => this.onTimeout(), TIME_LIMIT_MS + this.credit);
  }

  private onTimeout() {
    if (this.state !== "active") return;
    this.send({ type: "timeout", answer: this.results[this.index].answer });
    this.scheduleNext();
  }

  private finish() {
    this.stop();
    this.send({ type: "finished", totalPoints: this.totalPoints, results: this.results });
  }

  private ping() {
    const id = ++this.pingId;
    this.pings.set(id, this.clock.now());
    // A client that never answers pings must not grow this map forever.
    if (this.pings.size > RTT_SAMPLES) this.pings.delete(this.pings.keys().next().value!);
    this.send({ type: "ping", id });
    this.pingTimer = this.clock.setTimeout(() => this.ping(), PING_INTERVAL_MS);
  }

  private clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
