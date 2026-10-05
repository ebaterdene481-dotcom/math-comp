import { randomInt } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PRACTICE_PER_LEVEL, generateProblems } from "./problems.js";
import { GameSession, type ClientMessage, type Clock, systemClock } from "./session.js";

/** Practice runs one IP may start per hour (protects the server, not the score). */
export const PRACTICE_RUNS_PER_HOUR = 30;

export interface AppOptions {
  clock?: Clock;
  corsOrigin?: string | boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors, { origin: opts.corsOrigin ?? true });
  await app.register(websocket, { options: { maxPayload: 1024 } });

  const runsByIp = new Map<string, number[]>();
  const allowRun = (ip: string) => {
    const now = Date.now();
    const recent = (runsByIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PRACTICE_RUNS_PER_HOUR) return false;
    recent.push(now);
    runsByIp.set(ip, recent);
    return true;
  };

  app.get("/health", async () => ({ ok: true }));

  app.get("/ws/practice", { websocket: true }, (socket, req) => {
    if (!allowRun(req.ip)) {
      socket.send(JSON.stringify({ type: "error", message: "rate_limited" }));
      socket.close(1008, "rate_limited");
      return;
    }

    const problems = generateProblems(PRACTICE_PER_LEVEL, randomInt(2 ** 31));
    const session = new GameSession(
      problems,
      (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        if (msg.type === "finished") socket.close(1000, "finished");
      },
      opts.clock ?? systemClock,
    );

    socket.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg?.type === "answer" && typeof msg.value === "string") session.handle(msg);
      else if (msg?.type === "pong" && typeof msg.id === "number") session.handle(msg);
    });
    socket.on("close", () => session.stop());

    session.start();
  });

  return app;
}
