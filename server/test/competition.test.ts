import { describe, expect, it } from "vitest";
import { AuthError, AuthStore, ageOn } from "../src/auth.js";
import { buildApp } from "../src/app.js";
import { type Competition, currentCompetition, leaderboard, statusOf } from "../src/competition.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

function comp(over: Partial<Competition> = {}): Competition {
  return {
    id: "c1",
    name: "Test",
    opensAt: hours(-1),
    closesAt: hours(1),
    entryFee: 5000,
    prize: "x",
    maxAttempts: 100,
    attemptsUsed: 0,
    ...over,
  };
}

describe("competition status", () => {
  it("is upcoming, live or finished", () => {
    expect(statusOf(comp({ opensAt: hours(1), closesAt: hours(2) }), NOW)).toBe("upcoming");
    expect(statusOf(comp(), NOW)).toBe("live");
    expect(statusOf(comp({ closesAt: hours(-0.5) }), NOW)).toBe("finished");
  });

  it("finishes as soon as all 100 attempts are used", () => {
    expect(statusOf(comp({ attemptsUsed: 99 }), NOW)).toBe("live");
    expect(statusOf(comp({ attemptsUsed: 100 }), NOW)).toBe("finished");
  });

  it("shows a live competition before an upcoming one", () => {
    const up = comp({ id: "up", opensAt: hours(1), closesAt: hours(3) });
    const live = comp({ id: "live" });
    expect(currentCompetition([up, live], NOW)?.id).toBe("live");
    expect(currentCompetition([up], NOW)?.id).toBe("up");
  });
});

describe("leaderboard", () => {
  it("keeps each player's best attempt; ties go to whoever got there first", () => {
    const r = (userId: string, points: number, min: number) => ({
      competitionId: "c1",
      userId,
      points,
      finishedAt: new Date(NOW.getTime() + min * 60_000),
    });
    const board = leaderboard(
      [r("a", 500, 1), r("a", 900, 5), r("b", 900, 3), r("c", 700, 2), { ...r("d", 999, 1), competitionId: "other" }],
      "c1",
    );
    expect(board.map((l) => [l.userId, l.points])).toEqual([
      ["b", 900],
      ["a", 900],
      ["c", 700],
    ]);
  });
});

describe("registration", () => {
  const valid = {
    email: "bat@example.mn",
    password: "secret123",
    nickname: "Бат_01",
    birthDate: "2000-05-01",
    acceptTerms: true,
  };

  it("counts age by birthday", () => {
    expect(ageOn("2008-10-05", NOW)).toBe(18);
    expect(ageOn("2008-10-06", NOW)).toBe(17);
  });

  it.each([
    [{ birthDate: "2010-01-01" }, "too_young"],
    [{ birthDate: "20234-01-01" }, "birthdate_invalid"],
    [{ birthDate: "1850-01-01" }, "birthdate_invalid"],
    [{ acceptTerms: false }, "terms_required"],
    [{ password: "short" }, "password_short"],
    [{ nickname: "a" }, "nickname_invalid"],
    [{ email: "nope" }, "email_invalid"],
  ])("rejects %j", async (change, code) => {
    const store = new AuthStore(() => NOW);
    await expect(store.register({ ...valid, ...change })).rejects.toMatchObject({ code });
  });

  it("rejects a taken email or nickname, and logs in with the right password only", async () => {
    const store = new AuthStore(() => NOW);
    await store.register(valid);
    await expect(store.register({ ...valid, nickname: "other" })).rejects.toMatchObject({ code: "email_taken" });
    await expect(store.register({ ...valid, email: "x@y.mn", nickname: "бат_01" })).rejects.toMatchObject({
      code: "nickname_taken",
    });
    await expect(store.login("BAT@example.mn", "secret123")).resolves.toMatchObject({ nickname: "Бат_01" });
    await expect(store.login("bat@example.mn", "wrong-pass")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("HTTP API", () => {
  it("returns the current competition with the top 3", async () => {
    const app = await buildApp({ demo: true, now: () => NOW });
    const res = await app.inject("/api/competitions/current");
    const body = res.json();
    expect(body.competition).toMatchObject({ status: "live", prizeImage: "/prizes/demo-phone.svg", maxAttempts: 100, attemptsUsed: 63, entryFee: 5000 });
    expect(body.leaders).toHaveLength(3);
    expect(body.leaders[0]).toMatchObject({ rank: 1, nickname: "Тэмүүлэн", points: 914250 });
    await app.close();
  });

  it("returns no competition when none exist", async () => {
    const app = await buildApp({ now: () => NOW });
    expect((await app.inject("/api/competitions/current")).json()).toEqual({ competition: null, leaders: [] });
    await app.close();
  });

  it("registers, keeps the session in a cookie, and logs out", async () => {
    const app = await buildApp({ now: () => NOW });
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "a@b.mn", password: "password1", nickname: "Анар", birthDate: "1999-01-01", acceptTerms: true },
    });
    expect(reg.statusCode).toBe(200);
    const cookie = reg.cookies.find((c) => c.name === "session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(reg.json().user).toEqual({ id: expect.any(String), email: "a@b.mn", nickname: "Анар", isAdmin: false, emailVerified: false });

    const cookies = { session: cookie.value };
    expect((await app.inject({ url: "/api/me", cookies })).json().user.nickname).toBe("Анар");
    await app.inject({ method: "POST", url: "/api/auth/logout", cookies });
    expect((await app.inject({ url: "/api/me", cookies })).json().user).toBeNull();

    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "a@b.mn", password: "nope-nope" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad_credentials");
    await app.close();
  });

  it("shows a signed-in player's profile and refuses signed-out visitors", async () => {
    const app = await buildApp({ demo: true, now: () => NOW });
    expect((await app.inject("/api/me/profile")).statusCode).toBe(401);
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "p@b.mn", password: "password1", nickname: "Профайл", birthDate: "1990-01-01", acceptTerms: true },
    });
    const cookies = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const body = (await app.inject({ url: "/api/me/profile", cookies })).json();
    expect(body.user).toMatchObject({ nickname: "Профайл", email: "p@b.mn", createdAt: NOW.toISOString() });
    expect(body.wallet).toEqual({ balance: 0 });
    expect(body.stats).toEqual({ competitions: 0, attempts: 0, bestPoints: null, bestRank: null });
    expect(body.history).toEqual([]);
    await app.close();
  });

  it("refuses an under-18 registration with a Mongolian message", async () => {
    const app = await buildApp({ now: () => NOW });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "k@b.mn", password: "password1", nickname: "Хүүхэд", birthDate: "2012-01-01", acceptTerms: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "too_young", message: expect.stringContaining("18") });
    await app.close();
  });
});
