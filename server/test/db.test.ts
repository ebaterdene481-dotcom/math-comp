// Runs against a real PostgreSQL when TEST_DATABASE_URL is set; skipped otherwise.
// The database is emptied first, so point it at a throwaway database.

import pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { Database } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;

async function reset() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("drop table if exists sightings, email_tokens, withdrawals, wallet_txs, results, entries, competitions, sessions, users cascade");
  await c.end();
}

async function start() {
  const db = await Database.connect(url!);
  return buildApp({ demo: true, db });
}

describe.skipIf(!url)("postgres storage", () => {
  it("keeps accounts, sessions, money and entries across a restart", async () => {
    await reset();
    let app = await start();
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "k@b.mn", password: "Password1!", nickname: "Хасар", birthDate: "1990-01-01", acceptTerms: true },
    });
    const cookies = { session: reg.cookies.find((c) => c.name === "session")!.value };
    // The link is used after the restart: unused links are stored too.
    const verifyToken = new URL(reg.json().devLink).searchParams.get("token");
    await app.inject({ method: "POST", url: "/api/wallet/demo-topup", cookies, payload: { amount: 10000 } });
    await app.inject({ method: "POST", url: "/api/wallet/demo-topup", cookies, payload: { amount: 10000 } });
    const unverified = await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies });
    expect(unverified.statusCode).toBe(403);
    await app.close();

    app = await start();
    expect((await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: verifyToken } })).statusCode).toBe(200);
    await app.close();
    app = await start();
    expect((await app.inject({ url: "/api/me", cookies })).json().user.emailVerified).toBe(true);
    const paid = await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies });
    expect(paid.statusCode).toBe(200);
    const asked = await app.inject({
      method: "POST",
      url: "/api/wallet/withdraw",
      cookies,
      payload: { amount: 10000, bank: "Голомт банк", account: "1105123456", holder: "Хасар" },
    });
    expect(asked.statusCode).toBe(200);
    await app.close();

    app = await start();
    expect((await app.inject({ url: "/api/me", cookies })).json().user).toMatchObject({ nickname: "Хасар" });
    const wallet = (await app.inject({ url: "/api/wallet", cookies })).json();
    expect(wallet.balance).toBe(5000);
    expect(wallet.withdrawals).toMatchObject([{ status: "pending", amount: 10000, bank: "Голомт банк" }]);
    expect((await app.inject({ url: "/api/me/entries", cookies })).json().entries).toHaveLength(1);
    const current = (await app.inject({ url: "/api/competitions/current" })).json();
    expect(current.competition.attemptsUsed).toBe(64);
    // Sample data was seeded once, not again on the second start.
    expect(current.leaders).toHaveLength(3);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "k@b.mn", password: "Password1!" },
    });
    expect(login.statusCode).toBe(200);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const seen = (await c.query("select kind, count(*)::int as n from sightings group by kind order by kind")).rows;
    await c.end();
    // No device cookie is sent back here, so each call looks like a new device.
    expect(seen).toEqual([
      { kind: "device", n: 4 },
      { kind: "ip", n: 1 },
    ]);
    await app.close();
  });

  it("refunds a run that was under way when the server stopped", async () => {
    await reset();
    const db = await Database.connect(url!);
    const app = await buildApp({ demo: true, db });
    const svc = await (async () => {
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "a@b.mn", password: "Password1!", nickname: "Анар", birthDate: "1990-01-01", acceptTerms: true },
      });
      await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: new URL(reg.json().devLink).searchParams.get("token") } });
      return { session: reg.cookies.find((c) => c.name === "session")!.value };
    })();
    await app.inject({ method: "POST", url: "/api/wallet/demo-topup", cookies: svc, payload: { amount: 5000 } });
    const entry = (await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies: svc })).json().entry;
    // Mark it started, as the attempt socket would, then stop the server.
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("update entries set status = 'playing' where id = $1", [entry.id]);
    await c.end();
    await app.close();

    const again = await start();
    const wallet = (await again.inject({ url: "/api/wallet", cookies: svc })).json();
    expect(wallet.balance).toBe(5000);
    expect(wallet.transactions[0]).toMatchObject({ kind: "refund", amount: 5000 });
    expect((await again.inject({ url: "/api/competitions/current" })).json().competition.attemptsUsed).toBe(63);
    await again.close();
  });
});
