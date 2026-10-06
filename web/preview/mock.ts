// Runs the game server inside the browser so the preview needs no backend.
// The game itself is the real server code (problems, scoring, session);
// accounts and the competition are sample data kept in localStorage.

import { API_URL } from "../app/lib/api";
import prizeImage from "../public/prizes/demo-phone.svg";
import { leaderboard, statusOf, type Competition } from "../../server/src/competition";
import { PRACTICE_PER_LEVEL, generateProblems } from "../../server/src/problems";
import { COUNTDOWN_MS, GameSession, systemClock, type ClientMessage } from "../../server/src/session";

const hour = 3600_000;
const t0 = Date.now();
const competition: Competition = {
  id: "demo-1",
  name: "Намрын тэмцээн №1",
  opensAt: new Date(t0 - 2 * hour),
  closesAt: new Date(t0 + 10 * hour),
  entryFee: 5000,
  prize: "Ухаалаг утас",
  prizeImage,
  maxAttempts: 100,
  attemptsUsed: 63,
};
const PLAYERS: Array<[string, number]> = [
  ["Тэмүүлэн", 914250],
  ["Saraa_07", 902118],
  ["Билгүүн", 897640],
  ["anu.math", 871002],
];
const results = PLAYERS.map(([nickname, points], i) => ({
  competitionId: competition.id,
  userId: nickname,
  points,
  finishedAt: new Date(t0 - (i + 1) * 9 * 60_000),
}));

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

function ageOn(birth: string, today: Date) {
  const [y, m, d] = birth.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

const fail = (error: string, message: string) => ({ status: 400, body: { error, message } });

function route(path: string, method: string, b: Record<string, any>): { status: number; body: unknown } {
  if (path === "/api/competitions/current") {
    const leaders = leaderboard(results, competition.id)
      .slice(0, 3)
      .map((l, i) => ({ rank: i + 1, nickname: l.userId, points: l.points }));
    return {
      status: 200,
      body: {
        competition: {
          ...competition,
          status: statusOf(competition, new Date()),
          prizeImage: competition.prizeImage ?? null,
          opensAt: competition.opensAt.toISOString(),
          closesAt: competition.closesAt.toISOString(),
        },
        leaders,
      },
    };
  }
  if (path === "/api/me/profile") {
    const u = me();
    if (!u) return { status: 401, body: { error: "signed_out", message: "Нэвтэрнэ үү." } };
    return {
      status: 200,
      body: {
        user: { ...pub(u), createdAt: new Date(Number(u.id)).toISOString() },
        wallet: { balance: 0 },
        stats: { competitions: 0, attempts: 0, bestPoints: null, bestRank: null },
        history: [],
      },
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
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(API_URL)) return realFetch(input, init);
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const r = route(path, init?.method ?? "GET", body);
    await new Promise((res) => setTimeout(res, 120));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };

  class InBrowserSocket {
    static readonly OPEN = 1;
    readonly OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    private session: GameSession;

    constructor(_url: string) {
      const seed = Math.floor(Math.random() * 2 ** 31);
      this.session = new GameSession(
        generateProblems(PRACTICE_PER_LEVEL, seed),
        (msg) => {
          // Small delay so it behaves like a network hop.
          setTimeout(() => {
            if (this.readyState !== 1) return;
            this.onmessage?.({ data: JSON.stringify(msg) });
            if (msg.type === "finished") this.close();
          }, 15);
        },
        systemClock,
        COUNTDOWN_MS,
      );
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
        this.session.start();
      }, 50);
    }

    send(data: string) {
      setTimeout(() => this.session.handle(JSON.parse(data) as ClientMessage), 15);
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.session.stop();
      this.onclose?.({ code: 1000 });
    }
  }
  (window as any).WebSocket = InBrowserSocket;
}
