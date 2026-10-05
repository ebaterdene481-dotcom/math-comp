import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
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

function connect(url: string) {
  const ws = new WebSocket(url);
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
    clock.advance(1000);
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
    clock.advance(1000);
    expect(await c.next("problem")).toMatchObject({ index: 0 });
    c.ws.close();
  });
});
