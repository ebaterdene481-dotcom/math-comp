import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { COUNTDOWN_MS } from "../src/session.js";
import { FakeClock } from "./fakeClock.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function start(clock: FakeClock) {
  const app = await buildApp({ clock });
  await app.listen({ port: 0, host: "127.0.0.1" });
  close = () => app.close();
  const { port } = app.server.address() as { port: number };
  return `ws://127.0.0.1:${port}/ws/practice`;
}

function connect(url: string, headers?: Record<string, string>) {
  const ws = new WebSocket(url, { headers });
  const inbox: any[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (d) => {
    inbox.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (type: string) => {
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  return { ws, next, opened: new Promise((r) => ws.once("open", r)) };
}

describe("practice websocket", () => {
  it("plays a problem end to end with server-side checking", async () => {
    const clock = new FakeClock();
    const c = connect(await start(clock));
    await c.opened;
    await c.next("ping");
    expect(await c.next("countdown")).toEqual({ type: "countdown", ms: COUNTDOWN_MS });
    clock.advance(COUNTDOWN_MS - 1);
    clock.advance(1);
    const p = await c.next("problem");
    expect(p).toMatchObject({ index: 0, total: 20, timeLimitMs: 5000 });
    expect(p).not.toHaveProperty("answer");

    c.ws.send(JSON.stringify({ type: "answer", value: "999999" }));
    await c.next("wrong");

    clock.advance(5000);
    const t = await c.next("timeout");
    expect(typeof t.answer).toBe("number");
    c.ws.close();
  });

  it("ignores malformed messages", async () => {
    const clock = new FakeClock();
    const c = connect(await start(clock));
    await c.opened;
    c.ws.send("not json");
    c.ws.send(JSON.stringify({ type: "answer", value: 15 }));
    clock.advance(COUNTDOWN_MS);
    expect(await c.next("problem")).toMatchObject({ index: 0 });
    c.ws.close();
  });
});

describe("paid attempt websocket", () => {
  it("runs 100 problems after payment, survives a reconnect and records the score", async () => {
    const clock = new FakeClock();
    const app = await buildApp({ clock, demo: true });
    await app.listen({ port: 0, host: "127.0.0.1" });
    close = () => app.close();
    const { port } = app.server.address() as { port: number };

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "w@b.mn", password: "password1", nickname: "Тоглогч", birthDate: "1990-01-01", acceptTerms: true },
    });
    const session = reg.cookies.find((c) => c.name === "session")!.value;
    const cookies = { session };
    const token = new URL(reg.json().devLink).searchParams.get("token");
    await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });

    const poor = await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies });
    expect(poor.json()).toMatchObject({ error: "insufficient_funds", need: 5000 });

    await app.inject({ method: "POST", url: "/api/wallet/demo-topup", cookies, payload: { amount: 5000 } });
    const entered = await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies });
    const { entry, balance } = entered.json();
    expect(balance).toBe(0);
    expect((await app.inject("/api/competitions/current")).json().competition.attemptsUsed).toBe(64);

    const url = `ws://127.0.0.1:${port}/ws/attempt/${entry.id}`;
    const headers = { cookie: `session=${session}` };
    const stranger = connect(url);
    expect(await stranger.next("error")).toEqual({ type: "error", message: "signed_out" });

    const c = connect(url, headers);
    await c.opened;
    await c.next("countdown");
    clock.advance(COUNTDOWN_MS);
    expect(await c.next("problem")).toMatchObject({ index: 0, total: 100, level: 1, timeLimitMs: 5000 });

    // Drop the connection; the clock keeps running on the server.
    c.ws.close();
    await new Promise((r) => c.ws.once("close", r));
    clock.advance(2000);
    const back = connect(url, headers);
    expect(await back.next("problem")).toMatchObject({ index: 0, timeLimitMs: 3000 });

    // Rejoining after some problems also restores the running totals.
    back.ws.send(JSON.stringify({ type: "answer", value: "-1" }));
    await back.next("wrong");
    clock.advance(3000 + 1000);
    await back.next("problem");
    back.ws.close();
    await new Promise((r) => back.ws.once("close", r));
    const again1 = connect(url, headers);
    expect(await again1.next("progress")).toEqual({
      type: "progress",
      progress: { points: 0, correct: 0, ended: 1, wrong: 1, streak: 0, times: [] },
    });
    const back2 = again1;

    // Let every problem time out.
    clock.advance(100 * 6000);
    const done = await back2.next("finished");
    expect(done.totalPoints).toBe(0);
    expect(done.placing).toMatchObject({ rank: 9, players: 9 });
    expect(done.placing.top[0]).toEqual({ rank: 1, nickname: "Тэмүүлэн", points: 914250 });

    const standings = (await app.inject({ url: "/api/competitions/demo-1/standings", cookies })).json().standings;
    expect(standings.at(-1)).toMatchObject({ nickname: "Тоглогч", points: 0, you: true, attempts: 1 });
    expect(standings[0]).not.toHaveProperty("userId");

    const again = connect(url, headers);
    expect(await again.next("error")).toEqual({ type: "error", message: "used" });
  });
});
