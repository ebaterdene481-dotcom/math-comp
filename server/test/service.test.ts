import { describe, expect, it } from "vitest";
import type { Competition } from "../src/competition.js";
import { CompetitionService, START_WINDOW_MS } from "../src/service.js";

const T0 = new Date("2026-10-06T12:00:00Z");

function setup(over: Partial<Competition> = {}) {
  let t = T0.getTime();
  const svc = new CompetitionService(
    () => new Date(t),
    (id) => ({ a: "Анар", b: "Бат" })[id],
  );
  svc.competitions.push({
    id: "c1",
    name: "Тест",
    opensAt: new Date(t - 3600_000),
    closesAt: new Date(t + 3600_000),
    entryFee: 5000,
    prize: "x",
    maxAttempts: 100,
    attemptsUsed: 0,
    ...over,
  });
  return { svc, advance: (ms: number) => (t += ms) };
}

describe("wallet and entries", () => {
  it("refuses entry without enough money and says how much is missing", () => {
    const { svc } = setup();
    svc.demoTopUp("a", 3000);
    expect(() => svc.enter("a", "c1")).toThrow(expect.objectContaining({ code: "insufficient_funds", extra: { balance: 3000, need: 2000 } }));
  });

  it("takes the fee and one of the 100 attempt slots", () => {
    const { svc } = setup();
    svc.demoTopUp("a", 12000);
    const e = svc.enter("a", "c1");
    expect(svc.balance("a")).toBe(7000);
    expect(svc.competitions[0].attemptsUsed).toBe(1);
    expect(e.startBy.getTime() - e.paidAt.getTime()).toBe(START_WINDOW_MS);
    expect(svc.wallet("a").transactions.map((t) => [t.kind, t.amount])).toEqual([
      ["entry", -5000],
      ["topup", 12000],
    ]);
  });

  it("allows one open entry at a time", () => {
    const { svc } = setup();
    svc.demoTopUp("a", 20000);
    svc.enter("a", "c1");
    expect(() => svc.enter("a", "c1")).toThrow(expect.objectContaining({ code: "open_entry" }));
  });

  it("closes when the 100th attempt is sold", () => {
    const { svc } = setup({ attemptsUsed: 99 });
    svc.demoTopUp("a", 5000);
    svc.demoTopUp("b", 5000);
    svc.enter("a", "c1");
    expect(() => svc.enter("b", "c1")).toThrow(expect.objectContaining({ code: "closed" }));
    expect(svc.balance("b")).toBe(5000);
  });

  it("expires an entry not started within 15 minutes", () => {
    const { svc, advance } = setup();
    svc.demoTopUp("a", 5000);
    const e = svc.enter("a", "c1");
    advance(START_WINDOW_MS + 1);
    expect(svc.openEntries("a")).toEqual([]);
    expect(() => svc.beginAttempt("a", e.id, 1)).toThrow(expect.objectContaining({ code: "expired" }));
  });

  it("starts once with 100 problems, records the score and ranks it", () => {
    const { svc } = setup();
    svc.results.push({ competitionId: "c1", userId: "b", points: 500000, finishedAt: T0 });
    svc.demoTopUp("a", 5000);
    const e = svc.enter("a", "c1");
    expect(svc.beginAttempt("a", e.id, 7)).toHaveLength(100);
    expect(() => svc.beginAttempt("a", e.id, 7)).toThrow(expect.objectContaining({ code: "used" }));
    expect(() => svc.beginAttempt("b", e.id, 7)).toThrow(expect.objectContaining({ code: "not_found" }));
    svc.finishAttempt(e.id, 600000);
    expect(svc.placing("c1", "a")).toMatchObject({ rank: 1, players: 2 });
    expect(svc.profile("a").history[0]).toMatchObject({ rank: 1, attempts: 1, bestPoints: 600000, players: 2 });
  });
});

describe("past competitions", () => {
  it("lists finished competitions newest first with their winner", () => {
    const now = new Date("2026-10-06T00:00:00Z");
    const s = new CompetitionService(() => now, (id) => ({ a: "Ану", b: "Бат" })[id]);
    const day = 86_400_000;
    const mk = (id: string, closedDaysAgo: number) => ({
      id,
      name: id,
      opensAt: new Date(now.getTime() - (closedDaysAgo + 1) * day),
      closesAt: new Date(now.getTime() - closedDaysAgo * day),
      entryFee: 5000,
      prize: "Утас",
      maxAttempts: 100,
      attemptsUsed: 10,
    });
    s.competitions.push(mk("old", 20), mk("recent", 2), { ...mk("live", -1), opensAt: new Date(now.getTime() - day) });
    s.results.push(
      { competitionId: "recent", userId: "a", points: 800000, finishedAt: new Date(now.getTime() - 3 * day) },
      { competitionId: "recent", userId: "b", points: 900000, finishedAt: new Date(now.getTime() - 3 * day) },
    );
    const past = s.pastCompetitions();
    expect(past.map((c) => c.id)).toEqual(["recent", "old"]);
    expect(past[0]).toMatchObject({ status: "finished", players: 2, winner: { nickname: "Бат", points: 900000 } });
    expect(past[1].winner).toBeNull();
  });
});
