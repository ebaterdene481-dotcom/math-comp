import { randomInt } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PRACTICE_PER_LEVEL, generateProblems } from "./problems.js";
import { AuthError, AuthStore, toPublic } from "./auth.js";
import { seedDemo } from "./demo.js";
import { CompetitionService, ServiceError } from "./service.js";
import { COUNTDOWN_MS, GameSession, type ClientMessage, type Clock, systemClock } from "./session.js";

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
  const service = new CompetitionService(now, (id) => auth.getUser(id)?.nickname);
  if (opts.demo) {
    const demo = seedDemo((id, nickname) => auth.addDemoUser(id, nickname), now());
    service.competitions.push(...demo.competitions);
    service.results.push(...demo.results);
  }

  /** The signed-in user, or a 401 already sent. */
  const requireUser = (req: FastifyRequest, reply: FastifyReply) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    if (!user) reply.code(401).send({ error: "signed_out", message: "Нэвтэрнэ үү." });
    return user;
  };

  /** Turns rule violations from the service into 400s with their Mongolian message. */
  const guarded =
    <T>(fn: (req: FastifyRequest, reply: FastifyReply) => T | Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(req, reply);
      } catch (e) {
        if (e instanceof ServiceError)
          return reply.code(e.code === "not_found" ? 404 : 400).send({ error: e.code, message: e.message, ...e.extra });
        throw e;
      }
    };

  app.get("/api/competitions/current", async () => {
    const { competition, leaders } = service.current();
    return { competition, leaders: leaders.map(({ rank, nickname, points }) => ({ rank, nickname, points })) };
  });

  app.get("/api/competitions/past", async () => ({ competitions: service.pastCompetitions() }));

  app.get(
    "/api/competitions/:id/standings",
    guarded((req) => {
      const { id } = req.params as { id: string };
      const c = service.competition(id);
      const me = auth.userForSession(req.cookies[SESSION_COOKIE]);
      return {
        competition: service.publicCompetition(c),
        standings: service.standings(id).map(({ userId, ...row }) => ({ ...row, you: userId === me?.id })),
      };
    }),
  );

  app.post(
    "/api/competitions/:id/enter",
    guarded((req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return;
      const entry = service.enter(user.id, (req.params as { id: string }).id);
      return { entry: service.publicEntry(entry), balance: service.balance(user.id) };
    }),
  );

  app.get("/api/me/entries", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { entries: service.openEntries(user.id) };
  });

  app.get("/api/wallet", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { ...service.wallet(user.id), demoTopUp: Boolean(opts.demo) };
  });

  app.post(
    "/api/wallet/demo-topup",
    guarded((req, reply) => {
      if (!opts.demo) return reply.code(404).send({ error: "not_found" });
      const user = requireUser(req, reply);
      if (!user) return;
      service.demoTopUp(user.id, Number((req.body as { amount?: unknown })?.amount));
      return service.wallet(user.id);
    }),
  );

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

  app.get("/api/me/profile", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { user: { ...toPublic(user), createdAt: user.createdAt.toISOString() }, ...service.profile(user.id) };
  });

  app.get("/api/me", async (req) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    return { user: user ? toPublic(user) : null };
  });

  /** Forwards well-formed answers and pongs from the browser to a run. */
  const onClientMessage = (session: GameSession) => (data: unknown) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg?.type === "answer" && typeof msg.value === "string") session.handle(msg);
    else if (msg?.type === "pong" && typeof msg.id === "number") session.handle(msg);
  };

  // Paid runs keep going when the browser disconnects (the clock never stops), and a
  // player who comes back is attached to the same run.
  type Socket = { send(d: string): void; close(code?: number, reason?: string): void; readyState: number; OPEN: number };
  const liveRuns = new Map<string, { session: GameSession; socket: Socket | null }>();

  app.get("/ws/attempt/:entryId", { websocket: true }, (socket, req) => {
    const fail = (message: string) => {
      socket.send(JSON.stringify({ type: "error", message }));
      socket.close(1008, "refused");
    };
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    if (!user) return fail("signed_out");
    const { entryId } = req.params as { entryId: string };

    let run = liveRuns.get(entryId);
    if (run) {
      try {
        service.entry(user.id, entryId);
      } catch {
        return fail("not_found");
      }
      run.socket?.close(4000, "replaced");
      run.socket = socket;
      socket.on("message", onClientMessage(run.session));
      socket.on("close", () => {
        if (run!.socket === socket) run!.socket = null;
      });
      run.session.resync();
      return;
    }

    let problems;
    try {
      problems = service.beginAttempt(user.id, entryId, randomInt(2 ** 31));
    } catch (e) {
      if (e instanceof ServiceError) return fail(e.code);
      throw e;
    }
    const holder: { session: GameSession; socket: Socket | null } = { session: null!, socket };
    const entry = service.entry(user.id, entryId);
    holder.session = new GameSession(
      problems,
      (msg) => {
        const s = holder.socket;
        if (msg.type === "finished") {
          service.finishAttempt(entryId, msg.totalPoints);
          liveRuns.delete(entryId);
          const placing = service.placing(entry.competitionId, user.id);
          if (s && s.readyState === s.OPEN) {
            s.send(JSON.stringify({ ...msg, placing }));
            s.close(1000, "finished");
          }
          return;
        }
        if (s && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
      },
      opts.clock ?? systemClock,
      COUNTDOWN_MS,
    );
    liveRuns.set(entryId, holder);
    socket.on("message", onClientMessage(holder.session));
    socket.on("close", () => {
      if (holder.socket === socket) holder.socket = null;
    });
    holder.session.start();
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
      COUNTDOWN_MS,
    );

    socket.on("message", onClientMessage(session));
    socket.on("close", () => session.stop());

    session.start();
  });

  return app;
}
