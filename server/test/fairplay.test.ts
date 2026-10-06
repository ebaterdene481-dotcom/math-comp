import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { type Sighting, accountLinks, adminUserRows, reviewSpeed } from "../src/fairplay.js";
import { CompetitionService } from "../src/service.js";

const run = (times: (number | null)[]) => times.map((t) => ({ solved: t !== null, elapsedMs: t }));

describe("answer speed", () => {
  it("passes a quick but human run", () => {
    const r = reviewSpeed(run([...Array(60).fill(900), ...Array(20).fill(1500), 250, ...Array(19).fill(null)]));
    expect(r).toMatchObject({ solved: 81, medianMs: 900, fastestMs: 250, superhuman: 1, suspicious: false });
  });

  it("flags a run with several answers under 0.3 s", () => {
    expect(reviewSpeed(run([120, 200, 280, 1500, 1600])).suspicious).toBe(true);
  });

  it("flags a run whose typical answer is under 0.7 s, once it has enough answers", () => {
    expect(reviewSpeed(run(Array(30).fill(600))).suspicious).toBe(true);
    expect(reviewSpeed(run(Array(10).fill(600))).suspicious).toBe(false);
  });

  it("is kept with the finished entry", () => {
    const t = new Date("2026-10-06T12:00:00Z");
    const svc = new CompetitionService(
      () => t,
      () => "x",
    );
    svc.competitions.push({
      id: "c1",
      name: "Тест",
      opensAt: new Date(+t - 1000),
      closesAt: new Date(+t + 3600_000),
      entryFee: 0,
      prize: "x",
      maxAttempts: 100,
      attemptsUsed: 0,
    });
    const e = svc.enter("a", "c1");
    svc.beginAttempt("a", e.id, 1);
    svc.finishAttempt(e.id, 900000, run(Array(100).fill(100)) as never);
    expect(svc.entries[0].review).toMatchObject({ solved: 100, superhuman: 100, suspicious: true });
  });
});

describe("several accounts, one person", () => {
  const at = new Date();
  const seen = (userId: string, kind: "device" | "ip", value: string): Sighting => ({
    userId,
    kind,
    value,
    firstAt: at,
    lastAt: at,
  });

  it("links accounts by device, bank account and IP", () => {
    const linksOf = accountLinks(
      [
        seen("a", "device", "d1"),
        seen("b", "device", "d1"),
        seen("a", "ip", "i1"),
        seen("b", "ip", "i1"),
        seen("c", "ip", "i1"),
      ],
      [
        { userId: "a", account: "5012345678" },
        { userId: "d", account: "5012345678" },
      ],
    );
    expect(linksOf("a")).toEqual(
      expect.arrayContaining([
        { userId: "b", reasons: ["device", "ip"] },
        { userId: "c", reasons: ["ip"] },
        { userId: "d", reasons: ["bank"] },
      ]),
    );
    expect(linksOf("e")).toEqual([]);
  });

  it("flags a shared device or bank account, but not a shared IP alone", () => {
    const svc = new CompetitionService(
      () => at,
      () => "x",
    );
    const u = (id: string) => ({
      id,
      email: `${id}@b.mn`,
      nickname: id.toUpperCase(),
      createdAt: at,
      emailVerified: true,
    });
    const rows = adminUserRows([u("a"), u("b"), u("c")], svc, [
      seen("a", "device", "d1"),
      seen("b", "device", "d1"),
      seen("a", "ip", "i1"),
      seen("c", "ip", "i1"),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.a).toMatchObject({ flagged: true });
    expect(by.b).toMatchObject({ flagged: true, links: [{ nickname: "A", reasons: ["device"] }] });
    expect(by.c).toMatchObject({ flagged: false, links: [{ nickname: "A", reasons: ["ip"] }] });
  });
});

describe("admin player list", () => {
  it("shows two accounts made on one browser as linked, to admins only", async () => {
    const app = await buildApp({ demo: true });
    const reg = (email: string, nickname: string, cookies: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url: "/api/auth/register",
        cookies,
        payload: { email, password: "Password1!", nickname, birthDate: "1990-01-01", acceptTerms: true },
      });
    const first = await reg("a@b.mn", "Анар");
    const device = first.cookies.find((c) => c.name === "device")!;
    expect(device.httpOnly).toBe(true);
    const second = await reg("b@b.mn", "Бат", { device: device.value });
    expect(second.cookies.find((c) => c.name === "device")).toBeUndefined();
    await reg("c@b.mn", "Сэлэнгэ");

    const player = { session: first.cookies.find((c) => c.name === "session")!.value };
    expect((await app.inject({ url: "/api/admin/users", cookies: player })).statusCode).toBe(403);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@demo.mn", password: "admin12345" },
    });
    const admin = { session: login.cookies.find((c) => c.name === "session")!.value };
    const users: { nickname: string; flagged: boolean; links: { nickname: string; reasons: string[] }[] }[] = (
      await app.inject({ url: "/api/admin/users", cookies: admin })
    ).json().users;
    // Sample players are left out; the admin is a real account.
    expect(users.map((u) => u.nickname).sort()).toEqual(["Админ", "Анар", "Бат", "Сэлэнгэ"]);
    // The admin signs in from the same test IP but is never linked to players.
    expect(users.find((u) => u.nickname === "Админ")).toMatchObject({ isAdmin: true, links: [], flagged: false });
    const anar = users.find((u) => u.nickname === "Анар")!;
    expect(anar.flagged).toBe(true);
    expect(anar.links).toContainEqual({ nickname: "Бат", reasons: ["device", "ip"] });
    // Everyone here shares the test IP, which alone does not flag anyone.
    expect(users.find((u) => u.nickname === "Сэлэнгэ")!.flagged).toBe(false);
    expect((await app.inject({ url: "/api/admin/dashboard", cookies: admin })).json().flaggedUsers).toBe(2);
    await app.close();
  });
});

describe("banning", () => {
  it("signs a banned player out, keeps them out, hides their score, and lets an admin undo it", async () => {
    const app = await buildApp({ demo: true });
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "c@b.mn",
        password: "Password1!",
        nickname: "Хуурч",
        birthDate: "1990-01-01",
        acceptTerms: true,
      },
    });
    const player = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const id = reg.json().user.id;
    await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { token: new URL(reg.json().devLink).searchParams.get("token") },
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@demo.mn", password: "admin12345" },
    });
    const admin = { session: login.cookies.find((c) => c.name === "session")!.value };
    const adminId = login.json().user.id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/users/${id}/ban`,
          cookies: player,
          payload: { reason: "x" },
        })
      ).statusCode,
    ).toBe(403);
    const noReason = await app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/ban`,
      cookies: admin,
      payload: {},
    });
    expect(noReason.json().error).toBe("reason_required");
    const self = await app.inject({
      method: "POST",
      url: `/api/admin/users/${adminId}/ban`,
      cookies: admin,
      payload: { reason: "x" },
    });
    expect(self.json().error).toBe("admin_ban");

    const board = async () =>
      (await app.inject({ url: "/api/competitions/demo-1/standings" }))
        .json()
        .standings.map((s: { nickname: string }) => s.nickname);
    const ban = await app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/ban`,
      cookies: admin,
      payload: { reason: "Олон бүртгэл" },
    });
    expect(ban.json().users.find((u: { id: string }) => u.id === id).banned).toMatchObject({ reason: "Олон бүртгэл" });
    expect((await app.inject({ url: "/api/me", cookies: player })).json().user).toBeNull();
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "c@b.mn", password: "Password1!" },
    });
    expect(again.json()).toMatchObject({ error: "banned", message: expect.stringContaining("Олон бүртгэл") });
    expect(await board()).not.toContain("Хуурч");

    await app.inject({ method: "POST", url: `/api/admin/users/${id}/unban`, cookies: admin });
    const back = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "c@b.mn", password: "Password1!" },
    });
    expect(back.statusCode).toBe(200);
    await app.close();
  });

  it("leaves a banned player's results off the leaderboard and the prize", () => {
    const t = new Date("2026-10-06T12:00:00Z");
    const svc = new CompetitionService(
      () => t,
      (id) => id.toUpperCase(),
    );
    svc.results.push(
      { competitionId: "c1", userId: "cheat", points: 990000, finishedAt: t },
      { competitionId: "c1", userId: "fair", points: 800000, finishedAt: t },
    );
    svc.excluded = (id) => id === "cheat";
    expect(svc.standings("c1").map((s) => s.userId)).toEqual(["fair"]);
  });
});
