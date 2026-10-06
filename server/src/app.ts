import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { PRACTICE_PER_LEVEL, generateProblems } from "./problems.js";
import { AuthError, AuthStore, toPublic } from "./auth.js";
import type { Database } from "./db.js";
import { type Mailer, logMailer, resetMail, verifyMail } from "./mail.js";
import { seedDemo } from "./demo.js";
import { BANKS, CompetitionService, MIN_WITHDRAWAL, ServiceError } from "./service.js";
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
  /** Emails that get the admin page (ADMIN_EMAILS). */
  adminEmails?: string[];
  /** Where uploaded prize pictures are kept. */
  uploadDir?: string;
  /** PostgreSQL storage (DATABASE_URL). Without it everything is lost on restart. */
  db?: Database;
  /** Sends verification and password reset emails. Defaults to printing them to the log. */
  mailer?: Mailer;
  /** Address of the website, used in links sent by email (WEB_ORIGIN). */
  webOrigin?: string;
}

/** Sample admin account loaded with DEMO_DATA. */
export const DEMO_ADMIN = { email: "admin@demo.mn", password: "admin12345" };

/** Largest prize picture an admin may upload. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
};

/** Midnight in Ulaanbaatar (UTC+8) at the start of `now`'s day. */
function startOfDayUB(now: Date) {
  const offset = 8 * 3600_000;
  return new Date(Math.floor((now.getTime() + offset) / 86_400_000) * 86_400_000 - offset);
}

const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors, {
    origin: opts.corsOrigin ?? true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
  });
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
  const db = opts.db;
  const auth = new AuthStore(now, [...(opts.adminEmails ?? []), ...(opts.demo ? [DEMO_ADMIN.email] : [])], db?.auth);
  const pub = (u: Parameters<typeof toPublic>[0]) => toPublic(u, auth.isAdmin(u));
  const service = new CompetitionService(now, (id) => auth.getUser(id)?.nickname, db?.service);
  const saved = db ? await db.load() : null;
  if (saved) {
    auth.load(saved.users, saved.sessions, saved.tokens);
    service.load(saved);
  }
  // Sample data goes in only once: into an empty database, or every start without one.
  if (opts.demo && !saved?.users.length) {
    const demo = seedDemo((id, nickname) => auth.addDemoUser(id, nickname), now());
    service.competitions.push(...demo.competitions);
    service.results.push(...demo.results);
    const demoAdmin = await auth.register({
      email: DEMO_ADMIN.email,
      password: DEMO_ADMIN.password,
      nickname: "Админ",
      birthDate: "1990-01-01",
      acceptTerms: true,
    }, { skipPasswordRules: true });
    auth.markVerified(demoAdmin);
    auth.saveAll();
    service.saveAll();
  }
  service.refundInterrupted();
  if (db) {
    await db.flush();
    // Nothing is answered before the change behind it is stored.
    app.addHook("onSend", async (_req, _reply, payload) => {
      await db.flush();
      return payload;
    });
    app.addHook("onClose", () => db.close());
  }

  /** The signed-in user, or a 401 already sent. */
  const requireUser = (req: FastifyRequest, reply: FastifyReply) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    if (!user) reply.code(401).send({ error: "signed_out", message: "Нэвтэрнэ үү." });
    return user;
  };

  /** The signed-in user with a confirmed email, or a 401/403 already sent. */
  const requireVerified = (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (user && !user.emailVerifiedAt) {
      reply.code(403).send({
        error: "email_unverified",
        message: "Эхлээд имэйлээ баталгаажуулна уу. Бид таны имэйл рүү холбоос илгээсэн.",
      });
      return undefined;
    }
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
      const user = requireVerified(req, reply);
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
    return {
      ...service.wallet(user.id),
      demoTopUp: Boolean(opts.demo),
      withdrawals: service.withdrawalsOf(user.id),
      minWithdrawal: MIN_WITHDRAWAL,
      banks: BANKS,
    };
  });

  app.post(
    "/api/wallet/withdraw",
    guarded((req, reply) => {
      const user = requireVerified(req, reply);
      if (!user) return;
      const w = service.requestWithdrawal(user.id, body(req));
      return { withdrawal: service.publicWithdrawal(w), balance: service.balance(user.id) };
    }),
  );

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

  const RATE_LIMITED = { error: "rate_limited", message: "Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу." };

  const webOrigin = (opts.webOrigin ?? "http://localhost:3000").replace(/\/$/, "");

  /** Emails a one-time link. In demo mode the link is also returned, as there may be no mail server. */
  const sendLink = (user: { id: string; email: string; nickname: string }, kind: "verify" | "reset") => {
    const token = auth.issueToken(user.id, kind);
    const link = `${webOrigin}/${kind}?token=${token}`;
    const mail = kind === "verify" ? verifyMail(user.email, user.nickname, link) : resetMail(user.email, user.nickname, link);
    // Not awaited: a slow mail server must not delay the answer, or reveal by timing who has an account.
    (opts.mailer ?? logMailer).send(mail).catch((e) => console.error("sending mail failed:", e));
    return opts.demo ? { devLink: link } : {};
  };

  /** Rate-limited auth endpoint; AuthErrors become 400s with their Mongolian message. */
  const limited =
    (handler: (body: Record<string, unknown>, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!allowAuthTry(req.ip)) return reply.code(429).send(RATE_LIMITED);
      try {
        return await handler(body(req), req, reply);
      } catch (e) {
        if (e instanceof AuthError) return reply.code(400).send({ error: e.code, message: e.message });
        throw e;
      }
    };

  /** Signs the returned user in. */
  const authRoute = (handler: (body: Record<string, unknown>) => Promise<{ id: string }>) =>
    limited(async (b, _req, reply) => {
      const user = await handler(b);
      setSession(reply, user.id);
      return { user: pub(auth.getUser(user.id)!) };
    });

  app.post(
    "/api/auth/register",
    limited(async (b, _req, reply) => {
      if (typeof b.passwordConfirm === "string" && b.passwordConfirm !== b.password)
        throw new AuthError("password_mismatch", "Давтан оруулсан нууц үг таарахгүй байна.");
      const user = await auth.register({
        email: b.email,
        password: b.password,
        nickname: b.nickname,
        birthDate: b.birthDate,
        acceptTerms: b.acceptTerms,
      });
      setSession(reply, user.id);
      return { user: pub(user), ...sendLink(user, "verify") };
    }),
  );

  app.post(
    "/api/auth/verify",
    limited(async (b) => ({ user: pub(auth.verifyEmail(b.token)) })),
  );

  // One new verification email per player per minute.
  const lastResend = new Map<string, number>();
  app.post("/api/auth/resend-verification", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    const t = Date.now();
    if (t - (lastResend.get(user.id) ?? 0) < 60_000)
      return reply.code(429).send({ error: "rate_limited", message: "Нэг минутын дараа дахин илгээнэ үү." });
    lastResend.set(user.id, t);
    return { ok: true, ...sendLink(user, "verify") };
  });

  // Always answers the same way, so it cannot be used to find out who has an account.
  app.post(
    "/api/auth/forgot",
    limited(async (b) => {
      const user = auth.findByEmail(b.email);
      const sent = user ? sendLink(user, "reset") : {};
      return { ok: true, ...sent };
    }),
  );

  app.post(
    "/api/auth/reset",
    limited(async (b, _req, reply) => {
      if (typeof b.passwordConfirm === "string" && b.passwordConfirm !== b.password)
        throw new AuthError("password_mismatch", "Давтан оруулсан нууц үг таарахгүй байна.");
      const user = await auth.resetPassword(b.token, b.password);
      setSession(reply, user.id);
      return { user: pub(user) };
    }),
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
    return { user: { ...pub(user), createdAt: user.createdAt.toISOString() }, ...service.profile(user.id) };
  });

  app.get("/api/me", async (req) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    return { user: user ? pub(user) : null };
  });

  // Admin

  const requireAdmin = (req: FastifyRequest, reply: FastifyReply) => {
    const user = auth.userForSession(req.cookies[SESSION_COOKIE]);
    if (!user) {
      reply.code(401).send({ error: "signed_out", message: "Нэвтэрнэ үү." });
      return undefined;
    }
    if (!auth.isAdmin(user)) {
      reply.code(403).send({ error: "forbidden", message: "Админ эрх шаардлагатай." });
      return undefined;
    }
    return user;
  };

  const admin =
    <T>(fn: (req: FastifyRequest) => T) =>
    guarded((req, reply) => (requireAdmin(req, reply) ? fn(req) : undefined));

  app.get(
    "/api/admin/dashboard",
    admin(() => {
      const since = startOfDayUB(now());
      return { ...service.dashboard(since), users: auth.userCounts(since) };
    }),
  );
  app.get(
    "/api/admin/competitions",
    admin(() => ({ competitions: service.adminCompetitions() })),
  );
  app.post(
    "/api/admin/competitions",
    admin((req) => ({ competition: service.publicCompetition(service.createCompetition(body(req))) })),
  );
  app.put(
    "/api/admin/competitions/:id",
    admin((req) => ({
      competition: service.publicCompetition(service.updateCompetition((req.params as { id: string }).id, body(req))),
    })),
  );
  app.delete(
    "/api/admin/competitions/:id",
    admin((req) => {
      service.deleteCompetition((req.params as { id: string }).id);
      return { ok: true };
    }),
  );
  app.post(
    "/api/admin/competitions/:id/award",
    admin((req) => {
      const award = service.awardPrize((req.params as { id: string }).id, Number(body(req).cash ?? 0));
      return { award: { ...award, userId: undefined, at: award.at.toISOString() } };
    }),
  );

  app.get("/api/admin/withdrawals", admin(() => ({ withdrawals: service.adminWithdrawals() })));
  app.post(
    "/api/admin/withdrawals/:id/paid",
    admin((req) => ({ withdrawal: service.publicWithdrawal(service.markWithdrawalPaid((req.params as { id: string }).id)) })),
  );
  app.post(
    "/api/admin/withdrawals/:id/reject",
    admin((req) => ({
      withdrawal: service.publicWithdrawal(service.rejectWithdrawal((req.params as { id: string }).id, body(req).reason)),
    })),
  );

  // Prize pictures: PNG, JPEG or WebP sent as a data URL, checked by their first bytes.
  const uploadDir = opts.uploadDir ?? join(process.cwd(), "uploads");
  app.post(
    "/api/admin/uploads",
    { bodyLimit: Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024 },
    admin(async (req) => {
      const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body(req).dataUrl ?? ""));
      const type = m && IMAGE_TYPES[m[1]];
      const bytes = m ? Buffer.from(m[2], "base64") : Buffer.alloc(0);
      if (!type || !type.magic(bytes))
        throw new ServiceError("image_type", "Зөвхөн PNG, JPG эсвэл WebP зураг оруулна уу.");
      if (bytes.length > MAX_UPLOAD_BYTES) throw new ServiceError("image_size", "Зураг 2 МБ-аас бага байна.");
      const name = `${randomUUID()}.${type.ext}`;
      await mkdir(uploadDir, { recursive: true });
      await writeFile(join(uploadDir, name), bytes);
      return { url: `${req.protocol}://${req.host}/uploads/${name}` };
    }),
  );

  app.get("/uploads/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const m = /^[0-9a-f-]{36}\.(png|jpg|webp)$/.exec(name);
    if (!m) return reply.code(404).send();
    try {
      const data = await readFile(join(uploadDir, name));
      const type = m[1] === "jpg" ? "image/jpeg" : `image/${m[1]}`;
      return reply.header("content-type", type).header("x-content-type-options", "nosniff").send(data);
    } catch {
      return reply.code(404).send();
    }
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
