// Talks to the game server's HTTP API. The session lives in an httpOnly cookie,
// so every call sends credentials.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type CompetitionStatus = "upcoming" | "live" | "finished";

export interface CompetitionInfo {
  id: string;
  name: string;
  status: CompetitionStatus;
  opensAt: string;
  closesAt: string;
  entryFee: number;
  prize: string;
  prizeImage: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  /** Percent of fees paid to the winner in cash; null when the prize is goods. */
  prizeShare: number | null;
  /** Cash prize so far, from that share of the fees taken. */
  prizeFund: number | null;
}

export interface Leader {
  rank: number;
  nickname: string;
  /** Integer hundredths. */
  points: number;
}

export interface User {
  id: string;
  email: string;
  nickname: string;
  isAdmin?: boolean;
  /** Paying an entry fee or taking money out needs a confirmed email. */
  emailVerified?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The rest of the error body, e.g. `need` for insufficient funds. */
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("offline", "Сервертэй холбогдож чадсангүй. Дахин оролдоно уу.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? "error", body.message ?? "Алдаа гарлаа. Дахин оролдоно уу.", body);
  return body as T;
}

export const getCurrentCompetition = () =>
  call<{ competition: CompetitionInfo | null; leaders: Leader[] }>("/api/competitions/current");

export const getMe = () => call<{ user: User | null }>("/api/me");

export const login = (email: string, password: string) =>
  call<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export interface RegisterForm {
  email: string;
  password: string;
  nickname: string;
  birthDate: string;
  acceptTerms: boolean;
  passwordConfirm: string;
}

/** `devLink`: on the test server, the emailed link is also returned, as there may be no mail server. */
type Sent = { devLink?: string };

/** The verification link from the last registration on a test server, for the notice under the header. */
export let registeredDevLink: string | undefined;

export async function register(form: RegisterForm) {
  const r = await call<{ user: User } & Sent>("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
  registeredDevLink = r.devLink;
  return r;
}

export const verifyEmail = (token: string) =>
  call<{ user: User }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });

export const resendVerification = () =>
  call<{ ok: true } & Sent>("/api/auth/resend-verification", { method: "POST" });

export const forgotPassword = (email: string) =>
  call<{ ok: true } & Sent>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });

export const resetPassword = (token: string, password: string, passwordConfirm: string) =>
  call<{ user: User }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password, passwordConfirm }) });

export const logout = () => call<{ ok: true }>("/api/auth/logout", { method: "POST" });

/** 914250 → "9 142.50" */
export function fmtPoints(hundredths: number) {
  const whole = Math.floor(hundredths / 100);
  const cents = String(hundredths % 100).padStart(2, "0");
  return `${groupDigits(whole)}.${cents}`;
}

/** 5000 → "5 000" */
export const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ulaanbaatar",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", month: "2-digit", day: "2-digit" });

/** Ulaanbaatar time; adds the date when it is not today. */
export function fmtWhen(iso: string, now = new Date()) {
  const d = new Date(iso);
  const sameDay = day.format(d) === day.format(now);
  return sameDay ? clock.format(d) : `${day.format(d).replace("/", ".")}, ${clock.format(d)}`;
}

export interface Profile {
  user: User & { createdAt: string };
  wallet: { balance: number };
  stats: { competitions: number; attempts: number; bestPoints: number | null; bestRank: number | null };
  history: Array<{
    competitionId: string;
    name: string;
    status: CompetitionStatus;
    closesAt: string;
    attempts: number;
    bestPoints: number;
    rank: number;
    players: number;
  }>;
}

export const getProfile = () => call<Profile>("/api/me/profile");

/** Fired on window after login or logout so every part of the page can refresh. */
export const AUTH_EVENT = "auth-changed";
export const announceAuthChange = () => window.dispatchEvent(new Event(AUTH_EVENT));

export interface Standing {
  rank: number;
  nickname: string;
  points: number;
  attempts: number;
  achievedAt: string;
  you: boolean;
}

export interface PastCompetition extends CompetitionInfo {
  players: number;
  winner: { nickname: string; points: number } | null;
}

export const getPastCompetitions = () => call<{ competitions: PastCompetition[] }>("/api/competitions/past");

export const getStandings = (competitionId: string) =>
  call<{ competition: CompetitionInfo; standings: Standing[] }>(`/api/competitions/${competitionId}/standings`);

export interface Entry {
  id: string;
  competitionId: string;
  competitionName: string;
  status: "paid" | "playing" | "finished" | "expired";
  paidAt: string;
  startBy: string;
  points: number | null;
}

export const enterCompetition = (competitionId: string) =>
  call<{ entry: Entry; balance: number }>(`/api/competitions/${competitionId}/enter`, { method: "POST" });

export const getOpenEntries = () => call<{ entries: Entry[] }>("/api/me/entries");

export interface Wallet {
  balance: number;
  transactions: Array<{ id: string; kind: "topup" | "entry" | "prize" | "withdraw" | "refund"; amount: number; at: string; note: string }>;
  /** True while there is no payment provider and test money can be added. */
  demoTopUp?: boolean;
  withdrawals: Withdrawal[];
  /** Smallest amount that can be taken out, in tugrik. */
  minWithdrawal: number;
  banks: string[];
}

export interface Withdrawal {
  id: string;
  amount: number;
  bank: string;
  account: string;
  holder: string;
  status: "pending" | "paid" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  /** Why an admin turned it down. */
  reason: string | null;
}

export const getWallet = () => call<Wallet>("/api/wallet");
export const requestWithdrawal = (form: { amount: number; bank: string; account: string; holder: string }) =>
  call<{ withdrawal: Withdrawal; balance: number }>("/api/wallet/withdraw", { method: "POST", body: JSON.stringify(form) });

export const demoTopUp = (amount: number) =>
  call<Wallet>("/api/wallet/demo-topup", { method: "POST", body: JSON.stringify({ amount }) });

/** WebSocket address for a paid attempt, next to the practice socket. */
export const attemptSocketUrl = (entryId: string) =>
  (process.env.NEXT_PUBLIC_GAME_WS_URL ?? "ws://localhost:4000/ws/practice").replace(/\/ws\/practice$/, "") +
  `/ws/attempt/${entryId}`;

// Admin

export interface AdminCompetition extends CompetitionInfo {
  players: number;
  /** Tugrik taken in entry fees. */
  fees: number;
  winner: { nickname: string; points: number } | null;
  award: { nickname: string; points: number; at: string; cash: number } | null;
}

export interface AdminDashboard {
  current: (CompetitionInfo & { players: number; fees: number }) | null;
  today: { attempts: number; fees: number };
  users: { total: number; since: number };
  awaitingAward: number;
  pendingWithdrawals: number;
}

export type AdminWithdrawal = Withdrawal & { nickname: string; balance: number };

export interface CompetitionForm {
  name: string;
  prize: string;
  prizeImage?: string;
  /** Percent of fees that go to the winner; empty when the prize is goods. */
  prizeShare?: number | "";
  entryFee: number;
  maxAttempts: number;
  opensAt: string;
  closesAt: string;
}

export const getAdminDashboard = () => call<AdminDashboard>("/api/admin/dashboard");
export const getAdminCompetitions = () => call<{ competitions: AdminCompetition[] }>("/api/admin/competitions");
export const createCompetition = (form: CompetitionForm) =>
  call<{ competition: CompetitionInfo }>("/api/admin/competitions", { method: "POST", body: JSON.stringify(form) });
export const updateCompetition = (id: string, form: Partial<CompetitionForm>) =>
  call<{ competition: CompetitionInfo }>(`/api/admin/competitions/${id}`, { method: "PUT", body: JSON.stringify(form) });
export const deleteCompetition = (id: string) =>
  call<{ ok: true }>(`/api/admin/competitions/${id}`, { method: "DELETE" });
export const awardPrize = (id: string, cash: number) =>
  call<{ award: AdminCompetition["award"] }>(`/api/admin/competitions/${id}/award`, {
    method: "POST",
    body: JSON.stringify({ cash }),
  });
export const getAdminWithdrawals = () => call<{ withdrawals: AdminWithdrawal[] }>("/api/admin/withdrawals");
export const markWithdrawalPaid = (id: string) =>
  call<{ withdrawal: Withdrawal }>(`/api/admin/withdrawals/${id}/paid`, { method: "POST", body: "{}" });
export const rejectWithdrawal = (id: string, reason: string) =>
  call<{ withdrawal: Withdrawal }>(`/api/admin/withdrawals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
export const uploadImage = (dataUrl: string) =>
  call<{ url: string }>("/api/admin/uploads", { method: "POST", body: JSON.stringify({ dataUrl }) });
