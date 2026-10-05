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
  maxAttempts: number;
  attemptsUsed: number;
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
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
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
  if (!res.ok) throw new ApiError(body.error ?? "error", body.message ?? "Алдаа гарлаа. Дахин оролдоно уу.");
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
}

export const register = (form: RegisterForm) =>
  call<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(form) });

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
