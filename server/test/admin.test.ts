import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ADMIN, buildApp } from "../src/app.js";
import { CompetitionService } from "../src/service.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return { session: r.cookies.find((c) => c.name === "session")!.value };
}

describe("admin api", () => {
  it("is closed to players and open to admins", async () => {
    const app = await buildApp({ demo: true, uploadDir: await mkdtemp(join(tmpdir(), "up-")) });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "p@b.mn", password: "password1", nickname: "Тоглогч", birthDate: "1990-01-01", acceptTerms: true },
    });
    const player = await signIn(app, "p@b.mn", "password1");
    expect((await app.inject({ url: "/api/admin/dashboard" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/admin/dashboard", cookies: player })).statusCode).toBe(403);

    const cookies = await signIn(app, DEMO_ADMIN.email, DEMO_ADMIN.password);
    expect((await app.inject({ url: "/api/me", cookies })).json().user).toMatchObject({ isAdmin: true });
    const dash = (await app.inject({ url: "/api/admin/dashboard", cookies })).json();
    expect(dash.current).toMatchObject({ id: "demo-1", attemptsUsed: 63 });
    expect(dash.users.total).toBe(2);
    expect(dash.awaitingAward).toBe(2);
    await app.close();
  });

  it("creates, edits and deletes a competition with an uploaded picture", async () => {
    const app = await buildApp({ demo: true, uploadDir: await mkdtemp(join(tmpdir(), "up-")) });
    const cookies = await signIn(app, DEMO_ADMIN.email, DEMO_ADMIN.password);

    const bad = await app.inject({
      method: "POST",
      url: "/api/admin/uploads",
      cookies,
      payload: { dataUrl: `data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}` },
    });
    expect(bad.json().error).toBe("image_type");

    const up = await app.inject({
      method: "POST",
      url: "/api/admin/uploads",
      cookies,
      payload: { dataUrl: `data:image/png;base64,${PNG.toString("base64")}` },
    });
    const url: string = up.json().url;
    expect(url).toMatch(/\/uploads\/[0-9a-f-]{36}\.png$/);
    const img = await app.inject({ url: new URL(url).pathname });
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.rawPayload.equals(PNG)).toBe(true);

    const opensAt = new Date(Date.now() + 86_400_000).toISOString();
    const closesAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/competitions",
      cookies,
      payload: { name: "Өвлийн тэмцээн", prize: "Чихэвч", prizeImage: url, entryFee: 3000, opensAt, closesAt },
    });
    const c = created.json().competition;
    expect(c).toMatchObject({ name: "Өвлийн тэмцээн", status: "upcoming", maxAttempts: 100, prizeImage: url });

    const wrong = await app.inject({
      method: "POST",
      url: "/api/admin/competitions",
      cookies,
      payload: { name: "X", prize: "", entryFee: 3000, opensAt, closesAt },
    });
    expect(wrong.json().error).toBe("name_invalid");

    const edited = await app.inject({ method: "PUT", url: `/api/admin/competitions/${c.id}`, cookies, payload: { entryFee: 4000 } });
    expect(edited.json().competition.entryFee).toBe(4000);

    expect((await app.inject({ method: "DELETE", url: `/api/admin/competitions/${c.id}`, cookies })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "DELETE", url: "/api/admin/competitions/demo-1", cookies })).json().error).toBe("has_entries");
    await app.close();
  });

  it("awards the winner once and pays a cash prize into their wallet", async () => {
    const app = await buildApp({ demo: true, uploadDir: await mkdtemp(join(tmpdir(), "up-")) });
    const cookies = await signIn(app, DEMO_ADMIN.email, DEMO_ADMIN.password);
    const live = await app.inject({ method: "POST", url: "/api/admin/competitions/demo-1/award", cookies, payload: {} });
    expect(live.json().error).toBe("not_finished");
    const r = await app.inject({ method: "POST", url: "/api/admin/competitions/demo-past-2/award", cookies, payload: { cash: 0 } });
    expect(r.json().award).toMatchObject({ nickname: "Saraa_07", points: 921077, cash: 0 });
    const again = await app.inject({ method: "POST", url: "/api/admin/competitions/demo-past-2/award", cookies, payload: {} });
    expect(again.json().error).toBe("already_awarded");
    const list = (await app.inject({ url: "/api/admin/competitions", cookies })).json().competitions;
    expect(list.find((c: { id: string }) => c.id === "demo-past-2").award).toMatchObject({ nickname: "Saraa_07" });
    await app.close();
  });
});

describe("competition edits after payment", () => {
  it("locks the fee, attempts and opening time once someone has paid", () => {
    const now = new Date("2026-10-06T00:00:00Z");
    const s = new CompetitionService(() => now, () => "x");
    const c = s.createCompetition({
      name: "Тэмцээн",
      prize: "Утас",
      entryFee: 5000,
      opensAt: new Date(now.getTime() - 3600_000).toISOString(),
      closesAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    s.demoTopUp("u", 5000);
    s.enter("u", c.id);
    expect(() => s.updateCompetition(c.id, { entryFee: 1000 })).toThrow(/хураамж/);
    expect(s.updateCompetition(c.id, { prize: "Шинэ утас" }).prize).toBe("Шинэ утас");
    expect(() => s.awardPrize(c.id, 0)).toThrow(/дуусаагүй/);
  });

  it("pays a cash prize into the winner's wallet", () => {
    let now = new Date("2026-10-06T00:00:00Z");
    const s = new CompetitionService(() => now, () => "Ану");
    const c = s.createCompetition({
      name: "Тэмцээн",
      prize: "100 000₮",
      entryFee: 0,
      opensAt: new Date(now.getTime() - 3600_000).toISOString(),
      closesAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    s.results.push({ competitionId: c.id, userId: "a", points: 500000, finishedAt: now });
    now = new Date(now.getTime() + 2 * 3600_000);
    s.awardPrize(c.id, 100000);
    expect(s.balance("a")).toBe(100000);
    expect(s.wallet("a").transactions[0]).toMatchObject({ kind: "prize", amount: 100000 });
  });

  it("works out the prize fund from the admin's share of the fees", () => {
    const now = new Date("2026-10-06T00:00:00Z");
    const s = new CompetitionService(() => now, () => "x");
    expect(() =>
      s.createCompetition({ name: "Тэмцээн", prize: "Мөнгө", entryFee: 5000, prizeShare: 150, opensAt: now.toISOString(), closesAt: new Date(now.getTime() + 3600_000).toISOString() }),
    ).toThrow(/1–100%/);
    const c = s.createCompetition({
      name: "Тэмцээн",
      prize: "Мөнгөн шагнал",
      entryFee: 5000,
      prizeShare: 60,
      opensAt: new Date(now.getTime() - 60_000).toISOString(),
      closesAt: new Date(now.getTime() + 3600_000).toISOString(),
    });
    expect(s.publicCompetition(c)).toMatchObject({ prizeShare: 60, prizeFund: 0 });
    for (const u of ["u1", "u2", "u3"]) {
      s.demoTopUp(u, 5000);
      s.enter(u, c.id);
    }
    expect(s.publicCompetition(c).prizeFund).toBe(9000);
    expect(() => s.updateCompetition(c.id, { prizeShare: 80 })).toThrow(/хувь/);
  });
});
