// Runs the game server inside the browser so the preview needs no backend.
// The game and the competition rules are the real server code (problems, scoring,
// session, wallet and entries); accounts and wallet state are kept in localStorage.

import { API_URL } from "../app/lib/api";
import phoneImage from "../public/prizes/demo-phone.svg";
import headphonesImage from "../public/prizes/demo-headphones.svg";
import mouseImage from "../public/prizes/demo-mouse.svg";

// The preview is one file, so prize pictures travel inside it.
const PRIZE_IMAGES: Record<string, string> = {
  "/prizes/demo-phone.svg": phoneImage,
  "/prizes/demo-headphones.svg": headphonesImage,
  "/prizes/demo-mouse.svg": mouseImage,
};
import type { Award, Competition } from "../../server/src/competition";
import { seedDemo } from "../../server/src/demo";
import { PRACTICE_PER_LEVEL, generateProblems } from "../../server/src/problems";
import {
  BANKS,
  CompetitionService,
  MIN_WITHDRAWAL,
  ServiceError,
  type Entry,
  type WalletTx,
  type Withdrawal,
} from "../../server/src/service";
import { passwordProblem } from "../../server/src/password";
import { COUNTDOWN_MS, GameSession, systemClock, type ClientMessage } from "../../server/src/session";

const demoNames = new Map<string, string>();
const service = new CompetitionService(
  () => new Date(),
  (id) => demoNames.get(id) ?? users().find((u) => u.id === id)?.nickname,
);

interface StoredUser {
  id: string;
  email: string;
  nickname: string;
  password: string;
  /** Set until the emailed link is opened. Accounts saved before this existed count as verified. */
  unverified?: boolean;
}

const store = {
  get<T>(k: string, d: T): T {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "") as T;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

/** Sample admin, same as DEMO_ADMIN on the server. */
const ADMIN: StoredUser = { id: "1", email: "admin@demo.mn", nickname: "Админ", password: "admin12345" };
const users = () => {
  const list = store.get<StoredUser[]>("preview.users", []);
  return list.some((u) => u.email === ADMIN.email) ? list : [ADMIN, ...list];
};
const me = () => users().find((u) => u.id === store.get<string | null>("preview.session", null)) ?? null;
const pub = (u: StoredUser) => ({
  id: u.id,
  email: u.email,
  nickname: u.nickname,
  isAdmin: u.email === ADMIN.email,
  emailVerified: !u.unverified,
});

const saveUser = (u: StoredUser) => store.set("preview.users", users().map((x) => (x.id === u.id ? u : x)));

/** Emailed links. There is no mail here, so the link is handed back as devLink and opens in this page. */
interface StoredToken {
  token: string;
  userId: string;
  kind: "verify" | "reset";
  expires: number;
}
function issueLink(userId: string, kind: StoredToken["kind"]) {
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const others = store.get<StoredToken[]>("preview.tokens", []).filter((t) => !(t.userId === userId && t.kind === kind));
  const ms = kind === "verify" ? 24 * 3600_000 : 3600_000;
  store.set("preview.tokens", [...others, { token, userId, kind, expires: Date.now() + ms }]);
  return { devLink: `#${kind}?token=${token}` };
}
function takeLink(token: unknown, kind: StoredToken["kind"]) {
  const all = store.get<StoredToken[]>("preview.tokens", []);
  const t = all.find((x) => x.token === token && x.kind === kind && x.expires >= Date.now());
  const u = t && users().find((x) => x.id === t.userId);
  if (!t || !u) return undefined;
  store.set("preview.tokens", all.filter((x) => x !== t));
  return u;
}
const MISMATCH = () => fail("password_mismatch", "Давтан оруулсан нууц үг таарахгүй байна.");
const unverified = {
  status: 403,
  body: { error: "email_unverified", message: "Эхлээд имэйлээ баталгаажуулна уу. Бид таны имэйл рүү холбоос илгээсэн." },
};

type SavedCompetition = Omit<Competition, "opensAt" | "closesAt" | "award"> & {
  opensAt: string;
  closesAt: string;
  award?: Omit<Award, "at"> & { at: string };
};

const reviveCompetition = (c: SavedCompetition): Competition => ({
  ...c,
  opensAt: new Date(c.opensAt),
  closesAt: new Date(c.closesAt),
  award: c.award && { ...c.award, at: new Date(c.award.at) },
});

/**
 * Wallet, entries, scores and admin changes survive a reload. The sample competitions
 * are rebuilt around today each time, so the live one stays live; only what an admin
 * changed on them (name, prize, picture, award…) is laid back on top.
 */
function loadService() {
  const demo = seedDemo((id, nickname) => demoNames.set(id, nickname), new Date());
  const all = demo.competitions.map((c) => ({ ...c, prizeImage: c.prizeImage && PRIZE_IMAGES[c.prizeImage] }));
  const saved = store.get<{
    txs: WalletTx[];
    entries: Entry[];
    withdrawals?: Withdrawal[];
    results: typeof demo.results;
    sample?: Record<string, Partial<SavedCompetition>>;
    added?: SavedCompetition[];
    removed?: string[];
  } | null>("preview.service", null);
  for (const c of all) {
    if (saved?.removed?.includes(c.id)) continue;
    const edit = saved?.sample?.[c.id];
    const { opensAt: _o, closesAt: _c, award, ...rest } = edit ?? {};
    service.competitions.push({ ...c, ...rest, award: award && { ...award, at: new Date(award.at) } } as Competition);
  }
  service.competitions.push(...(saved?.added ?? []).map(reviveCompetition));
  service.results.push(...demo.results);
  if (!saved) return;
  service.txs.push(...saved.txs.map((t) => ({ ...t, at: new Date(t.at) })));
  service.entries.push(
    ...saved.entries.map((e) => ({ ...e, paidAt: new Date(e.paidAt), startBy: new Date(e.startBy) })),
  );
  service.results.push(...saved.results.map((r) => ({ ...r, finishedAt: new Date(r.finishedAt) })));
  service.withdrawals.push(
    ...(saved.withdrawals ?? []).map((w) => ({
      ...w,
      requestedAt: new Date(w.requestedAt),
      decidedAt: w.decidedAt && new Date(w.decidedAt),
    })),
  );
  // A run cannot outlive the page here, so one left open by a reload ends as if every problem timed out.
  for (const e of service.entries) if (e.status === "playing") service.finishAttempt(e.id, 0);
  save();
}

const SAMPLE_IDS = ["demo-1", "demo-past-1", "demo-past-2"];

function save() {
  const toSaved = (c: Competition): SavedCompetition => JSON.parse(JSON.stringify(c));
  const sample: Record<string, Partial<SavedCompetition>> = {};
  for (const c of service.competitions)
    if (SAMPLE_IDS.includes(c.id)) {
      const { opensAt: _o, closesAt: _c, ...rest } = toSaved(c);
      sample[c.id] = rest;
    }
  store.set("preview.service", {
    txs: service.txs,
    entries: service.entries,
    withdrawals: service.withdrawals,
    results: service.results.filter((r) => !demoNames.has(r.userId)),
    sample,
    added: service.competitions.filter((c) => !SAMPLE_IDS.includes(c.id)).map(toSaved),
    removed: SAMPLE_IDS.filter((id) => !service.competitions.some((c) => c.id === id)),
  });
}

function ageOn(birth: string, today: Date) {
  const [y, m, d] = birth.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

const fail = (error: string, message: string) => ({ status: 400, body: { error, message } });

function route(path: string, method: string, b: Record<string, any>): { status: number; body: unknown } {
  const signedOut = { status: 401, body: { error: "signed_out", message: "Нэвтэрнэ үү." } };
  if (path === "/api/competitions/current") {
    const { competition, leaders } = service.current();
    return {
      status: 200,
      body: { competition, leaders: leaders.map(({ rank, nickname, points }) => ({ rank, nickname, points })) },
    };
  }
  if (path.startsWith("/api/admin/")) {
    const u = me();
    if (!u) return signedOut;
    if (u.email !== ADMIN.email) return { status: 403, body: { error: "forbidden", message: "Админ эрх шаардлагатай." } };
    return adminRoute(path, method, b);
  }
  if (path === "/api/competitions/past") {
    return { status: 200, body: { competitions: service.pastCompetitions() } };
  }
  const standings = path.match(/^\/api\/competitions\/([^/]+)\/standings$/);
  if (standings) {
    const c = service.competition(standings[1]);
    const u = me();
    return {
      status: 200,
      body: {
        competition: service.publicCompetition(c),
        standings: service.standings(c.id).map(({ userId, ...row }) => ({ ...row, you: userId === u?.id })),
      },
    };
  }
  const enter = path.match(/^\/api\/competitions\/([^/]+)\/enter$/);
  if (enter && method === "POST") {
    const u = me();
    if (!u) return signedOut;
    if (u.unverified) return unverified;
    const entry = service.enter(u.id, enter[1]);
    save();
    return { status: 200, body: { entry: service.publicEntry(entry), balance: service.balance(u.id) } };
  }
  if (path === "/api/me/entries") {
    const u = me();
    if (!u) return signedOut;
    return { status: 200, body: { entries: service.openEntries(u.id) } };
  }
  if (path === "/api/wallet") {
    const u = me();
    if (!u) return signedOut;
    return {
      status: 200,
      body: {
        ...service.wallet(u.id),
        demoTopUp: true,
        withdrawals: service.withdrawalsOf(u.id),
        minWithdrawal: MIN_WITHDRAWAL,
        banks: BANKS,
      },
    };
  }
  if (path === "/api/wallet/withdraw" && method === "POST") {
    const u = me();
    if (!u) return signedOut;
    if (u.unverified) return unverified;
    const w = service.requestWithdrawal(u.id, b);
    save();
    return { status: 200, body: { withdrawal: service.publicWithdrawal(w), balance: service.balance(u.id) } };
  }
  if (path === "/api/wallet/demo-topup" && method === "POST") {
    const u = me();
    if (!u) return signedOut;
    service.demoTopUp(u.id, Number(b.amount));
    save();
    return { status: 200, body: service.wallet(u.id) };
  }
  if (path === "/api/me/profile") {
    const u = me();
    if (!u) return signedOut;
    return {
      status: 200,
      body: { user: { ...pub(u), createdAt: new Date(Number(u.id)).toISOString() }, ...service.profile(u.id) },
    };
  }
  if (path === "/api/me") return { status: 200, body: { user: me() ? pub(me()!) : null } };
  if (path === "/api/auth/logout" && method === "POST") {
    store.set("preview.session", null);
    return { status: 200, body: { ok: true } };
  }
  if (path === "/api/auth/login" && method === "POST") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const u = users().find((x) => x.email === email && x.password === b.password);
    if (!u) return fail("bad_credentials", "И-мэйл эсвэл нууц үг буруу байна.");
    store.set("preview.session", u.id);
    return { status: 200, body: { user: pub(u) } };
  }
  if (path === "/api/auth/register" && method === "POST") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const nickname = String(b.nickname ?? "").trim();
    const birth = String(b.birthDate ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email_invalid", "И-мэйл хаяг буруу байна.");
    if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(nickname))
      return fail("nickname_invalid", "Хочны нэр 3–20 үсэг, тоо байна.");
    const weak = passwordProblem(String(b.password ?? ""));
    if (weak) return fail("password_weak", weak);
    if (typeof b.passwordConfirm === "string" && b.passwordConfirm !== b.password) return MISMATCH();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return fail("birthdate_invalid", "Төрсөн огноогоо оруулна уу.");
    if (ageOn(birth, new Date()) < 18) return fail("too_young", "18 нас хүрсэн хүн л бүртгүүлэх боломжтой.");
    if (b.acceptTerms !== true) return fail("terms_required", "Үйлчилгээний нөхцөлийг зөвшөөрнө үү.");
    const all = users();
    if (all.some((u) => u.email === email)) return fail("email_taken", "Энэ и-мэйлээр бүртгэл үүссэн байна.");
    if (all.some((u) => u.nickname.toLowerCase() === nickname.toLowerCase()))
      return fail("nickname_taken", "Энэ хочны нэрийг өөр хүн авсан байна.");
    const u = { id: String(Date.now()), email, nickname, password: String(b.password), unverified: true };
    store.set("preview.users", [...all, u]);
    store.set("preview.session", u.id);
    return { status: 200, body: { user: pub(u), ...issueLink(u.id, "verify") } };
  }
  if (path === "/api/auth/verify" && method === "POST") {
    const u = takeLink(b.token, "verify");
    if (!u) return fail("link_invalid", "Холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Шинэ холбоос авна уу.");
    const done = { ...u, unverified: undefined };
    saveUser(done);
    return { status: 200, body: { user: pub(done) } };
  }
  if (path === "/api/auth/resend-verification" && method === "POST") {
    const u = me();
    if (!u) return signedOut;
    return { status: 200, body: { ok: true, ...(u.unverified ? issueLink(u.id, "verify") : {}) } };
  }
  if (path === "/api/auth/forgot" && method === "POST") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const u = users().find((x) => x.email === email);
    return { status: 200, body: { ok: true, ...(u ? issueLink(u.id, "reset") : {}) } };
  }
  if (path === "/api/auth/reset" && method === "POST") {
    const weak = passwordProblem(String(b.password ?? ""));
    if (weak) return fail("password_weak", weak);
    if (typeof b.passwordConfirm === "string" && b.passwordConfirm !== b.password) return MISMATCH();
    const u = takeLink(b.token, "reset");
    if (!u)
      return fail("link_invalid", "Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Дахин хүснэ үү.");
    const done = { ...u, password: String(b.password), unverified: undefined };
    saveUser(done);
    store.set("preview.session", u.id);
    return { status: 200, body: { user: pub(done) } };
  }
  return { status: 404, body: { error: "not_found" } };
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function adminRoute(path: string, method: string, b: Record<string, any>): { status: number; body: unknown } {
  const ok = (body: unknown) => ({ status: 200, body });
  if (path === "/api/admin/dashboard") {
    const since = startOfDay();
    const list = users().filter((u) => u.email !== ADMIN.email);
    return ok({
      ...service.dashboard(since),
      users: { total: list.length, since: list.filter((u) => Number(u.id) >= since.getTime()).length },
    });
  }
  if (path === "/api/admin/competitions" && method === "GET") return ok({ competitions: service.adminCompetitions() });
  if (path === "/api/admin/competitions" && method === "POST") {
    const c = service.createCompetition(b);
    save();
    return ok({ competition: service.publicCompetition(c) });
  }
  if (path === "/api/admin/uploads") {
    // No file server here: the picture itself becomes the address.
    const m = /^data:image\/(png|jpeg|webp);base64,/.exec(String(b.dataUrl ?? ""));
    if (!m) return fail("image_type", "Зөвхөн PNG, JPG эсвэл WebP зураг оруулна уу.");
    if (String(b.dataUrl).length > 2.8 * 1024 * 1024) return fail("image_size", "Зураг 2 МБ-аас бага байна.");
    return ok({ url: b.dataUrl });
  }
  if (path === "/api/admin/withdrawals") return ok({ withdrawals: service.adminWithdrawals() });
  const payout = path.match(/^\/api\/admin\/withdrawals\/([^/]+)\/(paid|reject)$/);
  if (payout && method === "POST") {
    const w = payout[2] === "paid" ? service.markWithdrawalPaid(payout[1]) : service.rejectWithdrawal(payout[1], b.reason);
    save();
    return ok({ withdrawal: service.publicWithdrawal(w) });
  }
  const award = path.match(/^\/api\/admin\/competitions\/([^/]+)\/award$/);
  if (award) {
    const a = service.awardPrize(award[1], Number(b.cash ?? 0));
    save();
    return ok({ award: { ...a, userId: undefined, at: a.at.toISOString() } });
  }
  const one = path.match(/^\/api\/admin\/competitions\/([^/]+)$/);
  if (one && method === "PUT") {
    const c = service.updateCompetition(one[1], b);
    save();
    return ok({ competition: service.publicCompetition(c) });
  }
  if (one && method === "DELETE") {
    service.deleteCompetition(one[1]);
    save();
    return ok({ ok: true });
  }
  return { status: 404, body: { error: "not_found" } };
}

export function installMockServer() {
  loadService();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(API_URL)) return realFetch(input, init);
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let r: { status: number; body: unknown };
    try {
      r = route(path, init?.method ?? "GET", body);
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
      r = {
        status: e.code === "not_found" ? 404 : 400,
        body: { error: e.code, message: e.message, ...e.extra },
      };
    }
    await new Promise((res) => setTimeout(res, 120));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };

  // Paid runs keep going when the socket closes, like on the real server.
  const liveRuns = new Map<string, { session: GameSession; socket: InBrowserSocket | null }>();

  class InBrowserSocket {
    static readonly OPEN = 1;
    readonly OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    private session: GameSession | null = null;
    private practice = true;

    constructor(url: string) {
      const attempt = url.match(/\/ws\/attempt\/([^/?]+)/);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
        if (attempt) this.attach(attempt[1]);
        else this.startPractice();
      }, 50);
    }

    /** Delivers a server message after a small delay, like a network hop. */
    deliver(msg: unknown, thenClose = false) {
      setTimeout(() => {
        if (this.readyState !== 1) return;
        this.onmessage?.({ data: JSON.stringify(msg) });
        if (thenClose) this.close();
      }, 15);
    }

    private startPractice() {
      const seed = Math.floor(Math.random() * 2 ** 31);
      this.session = new GameSession(
        generateProblems(PRACTICE_PER_LEVEL, seed),
        (msg) => this.deliver(msg, msg.type === "finished"),
        systemClock,
        COUNTDOWN_MS,
      );
      this.session.start();
    }

    private attach(entryId: string) {
      this.practice = false;
      const u = me();
      if (!u) return this.deliver({ type: "error", message: "signed_out" }, true);
      const run = liveRuns.get(entryId);
      if (run) {
        run.socket?.close();
        run.socket = this;
        this.session = run.session;
        run.session.resync();
        return;
      }
      let problems;
      try {
        problems = service.beginAttempt(u.id, entryId, Math.floor(Math.random() * 2 ** 31));
      } catch (e) {
        if (e instanceof ServiceError) return this.deliver({ type: "error", message: e.code }, true);
        throw e;
      }
      save();
      const entry = service.entry(u.id, entryId);
      const holder: { session: GameSession; socket: InBrowserSocket | null } = { session: null!, socket: this };
      holder.session = new GameSession(
        problems,
        (msg) => {
          if (msg.type === "finished") {
            service.finishAttempt(entryId, msg.totalPoints);
            save();
            liveRuns.delete(entryId);
            holder.socket?.deliver({ ...msg, placing: service.placing(entry.competitionId, u.id) }, true);
            return;
          }
          holder.socket?.deliver(msg);
        },
        systemClock,
        COUNTDOWN_MS,
      );
      liveRuns.set(entryId, holder);
      this.session = holder.session;
      holder.session.start();
    }

    send(data: string) {
      setTimeout(() => this.session?.handle(JSON.parse(data) as ClientMessage), 15);
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.practice) this.session?.stop();
      for (const run of liveRuns.values()) if (run.socket === this) run.socket = null;
      this.onclose?.({ code: 1000 });
    }
  }
  (window as any).WebSocket = InBrowserSocket;
}
