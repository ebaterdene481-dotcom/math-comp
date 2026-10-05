import { describe, expect, it } from "vitest";
import type { Problem } from "../src/problems.js";
import { GAP_MS, GameSession, type ServerMessage } from "../src/session.js";
import { FakeClock } from "./fakeClock.js";

const problems: Problem[] = [
  { level: 1, templateId: "t", text: "7 + 8", answer: 15 },
  { level: 1, templateId: "t", text: "2 + 3", answer: 5 },
];

function setup() {
  const clock = new FakeClock();
  const sent: ServerMessage[] = [];
  const s = new GameSession(problems, (m) => sent.push(m), clock);
  const of = <T extends ServerMessage["type"]>(type: T) =>
    sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { clock, sent, s, of };
}

describe("GameSession", () => {
  it("sends the first problem after the gap and scores a correct answer by server time", () => {
    const { clock, s, of } = setup();
    s.start();
    expect(of("problem")).toHaveLength(0);
    clock.advance(GAP_MS);
    expect(of("problem")[0]).toMatchObject({ index: 0, total: 2, text: "7 + 8" });
    clock.advance(1000);
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")[0]).toEqual({ type: "correct", points: 8889, elapsedMs: 1000 });
  });

  it("keeps the original clock running after a wrong answer", () => {
    const { clock, s, of } = setup();
    s.start();
    clock.advance(GAP_MS + 1500);
    s.handle({ type: "answer", value: "14" });
    expect(of("wrong")).toHaveLength(1);
    clock.advance(1250);
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")[0].elapsedMs).toBe(2750);
    expect(of("correct")[0].points).toBe(5000);
    expect(s.results[0].wrongTries).toBe(1);
  });

  it("times out at 5 seconds with 0 points and moves on", () => {
    const { clock, s, of } = setup();
    s.start();
    clock.advance(GAP_MS + 5000);
    expect(of("timeout")[0]).toEqual({ type: "timeout", answer: 15 });
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")).toHaveLength(0);
    clock.advance(GAP_MS);
    expect(of("problem")[1]).toMatchObject({ index: 1 });
  });

  it("ignores answers beyond 5 per second (guess spamming)", () => {
    const { clock, s, of } = setup();
    s.start();
    clock.advance(GAP_MS + 100);
    for (const v of ["1", "2", "3", "4", "6"]) s.handle({ type: "answer", value: v });
    s.handle({ type: "answer", value: "15" });
    expect(of("wrong")).toHaveLength(5);
    expect(of("correct")).toHaveLength(0);
    clock.advance(1000);
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")).toHaveLength(1);
  });

  it("credits half the round trip, capped at 300 ms", () => {
    const { clock, s, of } = setup();
    s.start();
    const ping = of("ping")[0];
    clock.advance(200);
    s.handle({ type: "pong", id: ping.id });
    expect(s.latencyCreditMs()).toBe(100);
    clock.advance(GAP_MS - 200 + 1100);
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")[0].elapsedMs).toBe(1000);

    const slow = setup();
    slow.s.start();
    slow.clock.advance(900);
    slow.s.handle({ type: "pong", id: slow.of("ping")[0].id });
    expect(slow.s.latencyCreditMs()).toBe(300);
  });

  it("does not let credit change mid-problem", () => {
    const { clock, s, of } = setup();
    s.start();
    clock.advance(GAP_MS + 100);
    // a late pong arriving during the problem must not reduce the measured time
    clock.advance(2000);
    const pings = of("ping");
    s.handle({ type: "pong", id: pings[pings.length - 1].id });
    s.handle({ type: "answer", value: "15" });
    expect(of("correct")[0].elapsedMs).toBe(2100);
  });

  it("finishes with totals after the last problem", () => {
    const { clock, s, of } = setup();
    s.start();
    clock.advance(GAP_MS + 300);
    s.handle({ type: "answer", value: "15" });
    clock.advance(GAP_MS + 5000);
    const fin = of("finished")[0];
    expect(fin.totalPoints).toBe(10000);
    expect(fin.results.map((r) => r.solved)).toEqual([true, false]);
    expect(s.finished).toBe(true);
  });
});
