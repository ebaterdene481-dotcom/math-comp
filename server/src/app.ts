import { randomInt } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PRACTICE_PER_LEVEL, generateProblems } from "./problems.js";
import { AuthError, AuthStore, toPublic } from "./auth.js";
import {
  type AttemptResult,
  type Competition,
  currentCompetition,
  leaderboard,
  statusOf,
} from "./competition.js";
import { seedDemo } from "./demo.js";
import { GameSession, type ClientMessage, type Clock, systemClock } from "./session.js";

/** Practice runs one IP may start per hour (protects the server, not the score). */
export const PRACTICE_RUNS_PER_HOUR = 30;

/** Login and register tries one IP may make per 15 minutes. */
export const AUTH_TRIES_PER_15_MIN = 20;

const SESSION_COOKIE = "session";

export interface AppOptions {
  clock?: Clock;
  corsOrigin?: string | boolean;
  /** Load sample competition and players (DEMO_DATA=1). */
  demo?: boolean;
  /** Wall clock for competition status; tests pass a fixed date. */
  now?: () => Date;
  secureCookies?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors, { origin: opts.corsOrigin ?? true, credentials: true });
  await app.register(cookie);
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

  const now = opts.now ?? (() => new Date());
  const auth = new AuthStore(now);
  const competitions: Competition[] = [];
  const results: AttemptResult[] = [];
  if (opts.demo) {
    const demo = seedDemo(auth, now());
    competitions.push(...demo.competitions);
    results.push(...demo.results);
  }

  app.get("/api/competitions/current", async () => {
    const c = currentCompetition(competitions, now());
    if (!c) return { competition: null, leaders: [] };
    const leaders = leaderboard(results, c.id)
      .slice(0, 3)
      .map((l, i) => ({
        rank: i + 1,
        nickname: auth.getUser(l.userId)?.nickname ?? "?",
        points: l.points,
      }));
    return {
      competition: {
        id: c.id,
        name: c.name,
        status: statusOf(c, now()),
        opensAt: c.opensAt.toISOString(),
        closesAt: c.closesAt.toISOString(),
        entryFee: c.entryFee,
        prize: c.prize,
        maxAttempts: c.maxAttempts,
        attemptsUsed: Math.min(c.attemptsUsed, c.maxAttempts),
      },
      leaders,
    };
  });

  const triesByIp = new Map<string, number[]>();
  const allowAuthTry = (ip: string) => {
    const t = Date.now();
    const recent = (triesByIp.get(ip) ?? []).filter((x) => t - x < 15 * 60_000);
    if (recent.length >= AUTH_TRIES_PER_15_MIN) return false;
    recent.push(t);
    triesByIp.set(ip, recent);
    return true;
  };

  const setSession = (reply: FastifyReply, userId: string) => {
    reply.setCookie(SESSION_COOKIE, auth.createSession(userId), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: opts.secureCookies ?? false,
      maxAge: AuthStore.SESSION_MS / 1000,
    });
  };

  const authRoute =
    (handler: (body: Record<string, unknown>) => Promise<{ id: string }>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!allowAuthTry(req.ip)) {
        return reply
          .code(429)
          .send({ error: "rate_limited", message: "Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу." });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const user = await handler(body);
        setSession(reply, user.id);
        return { user: toPublic(auth.getUser(user.id)!) };
      } catch (e) {
        if (e instanceof AuthError) return reply.code(400).send({ error: e.code, message: e.message });
        throw e;
      }
    };

  app.post(
    "/api/auth/register",
    authRoute((b) =>
      auth.register({
        email: b.email,
        password: b.password,
        nickname: b.nickname,
        birthDate: b.birthDate,
        acceptTerms: b.acceptTerms,
      }),
    ),
  );
  app.post(
    "/api/auth/login",
    authRoute((b) => auth.login(b.email, b.password)),
  );

  app.post("/api/auth/logout", async (req, reply) => {
    auth.endSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    return { user: user ? toPublic(user) : null };
  });

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
