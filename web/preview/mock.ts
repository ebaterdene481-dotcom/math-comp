// Runs the game server inside the browser so the preview needs no backend.
// The game and the competition rules are the real server code (problems, scoring,
// session, wallet and entries); accounts and wallet state are kept in localStorage.

import { API_URL } from "../app/lib/api";
import prizeImage from "../public/prizes/demo-phone.svg";
import { seedDemo } from "../../server/src/demo";
import { PRACTICE_PER_LEVEL, generateProblems } from "../../server/src/problems";
import { CompetitionService, ServiceError, type Entry, type WalletTx } from "../../server/src/service";
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

const users = () => store.get<StoredUser[]>("preview.users", []);
const me = () => users().find((u) => u.id === store.get<string | null>("preview.session", null)) ?? null;
const pub = (u: StoredUser) => ({ id: u.id, email: u.email, nickname: u.nickname });

/** Wallet, entries and scores survive a reload; the sample competition is rebuilt each time. */
function loadService() {
  const demo = seedDemo((id, nickname) => demoNames.set(id, nickname), new Date());
  const comp = { ...demo.competitions[0], prizeImage };
  const saved = store.get<{ txs: WalletTx[]; entries: Entry[]; results: typeof demo.results; used: number } | null>(
    "preview.service",
    null,
  );
  if (saved) comp.attemptsUsed = saved.used;
  service.competitions.push(comp);
  service.results.push(...demo.results);
  if (!saved) return;
  service.txs.push(...saved.txs.map((t) => ({ ...t, at: new Date(t.at) })));
  service.entries.push(
    ...saved.entries.map((e) => ({ ...e, paidAt: new Date(e.paidAt), startBy: new Date(e.startBy) })),
  );
  service.results.push(...saved.results.map((r) => ({ ...r, finishedAt: new Date(r.finishedAt) })));
  // A run cannot outlive the page here, so one left open by a reload ends as if every problem timed out.
  for (const e of service.entries) if (e.status === "playing") service.finishAttempt(e.id, 0);
  save();
}

function save() {
  store.set("preview.service", {
    txs: service.txs,
    entries: service.entries,
    results: service.results.filter((r) => !demoNames.has(r.userId)),
    used: service.competitions[0].attemptsUsed,
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
    return { status: 200, body: { ...service.wallet(u.id), demoTopUp: true } };
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
    if (String(b.password ?? "").length < 8) return fail("password_short", "Нууц үг дор хаяж 8 тэмдэгт байна.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return fail("birthdate_invalid", "Төрсөн огноогоо оруулна уу.");
    if (ageOn(birth, new Date()) < 18) return fail("too_young", "18 нас хүрсэн хүн л бүртгүүлэх боломжтой.");
    if (b.acceptTerms !== true) return fail("terms_required", "Үйлчилгээний нөхцөлийг зөвшөөрнө үү.");
    const all = users();
    if (all.some((u) => u.email === email)) return fail("email_taken", "Энэ и-мэйлээр бүртгэл үүссэн байна.");
    if (all.some((u) => u.nickname.toLowerCase() === nickname.toLowerCase()))
      return fail("nickname_taken", "Энэ хочны нэрийг өөр хүн авсан байна.");
    const u = { id: String(Date.now()), email, nickname, password: String(b.password) };
    store.set("preview.users", [...all, u]);
    store.set("preview.session", u.id);
    return { status: 200, body: { user: pub(u) } };
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
