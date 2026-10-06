// Accounts and sessions. In memory until the database lands; the rules
// (age 18+, terms accepted, unique email and nickname) are the real ones.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const MIN_AGE = 18;
export const TERMS_VERSION = "2026-10-05";

export interface User {
  id: string;
  email: string;
  nickname: string;
  birthDate: string;
  termsVersion: string;
  passwordHash: string;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  /** Can open the admin page. */
  isAdmin: boolean;
}

export const toPublic = (u: User, isAdmin = false): PublicUser => ({
  id: u.id,
  email: u.email,
  nickname: u.nickname,
  isAdmin,
});

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RegisterInput {
  email: unknown;
  password: unknown;
  nickname: unknown;
  birthDate: unknown;
  acceptTerms: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICK_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

export function ageOn(birthDate: string, today: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex = ""] = stored.split(":");
  const expected = Buffer.from(keyHex, "hex");
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 32);
  return expected.length === key.length && timingSafeEqual(key, expected);
}

export class AuthStore {
  private users = new Map<string, User>();
  private sessions = new Map<string, { userId: string; expires: number }>();
  static readonly SESSION_MS = 30 * 24 * 3600 * 1000;

  /** Admins are named by email (ADMIN_EMAILS), so no one can make themselves one. */
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly now: () => Date = () => new Date(),
    adminEmails: string[] = [],
  ) {
    this.adminEmails = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  isAdmin(user: User) {
    return this.adminEmails.has(user.email);
  }

  /** Registered players (sample players excluded), and how many joined since `since`. */
  userCounts(since: Date) {
    const real = [...this.users.values()].filter((u) => !u.email.endsWith("@demo.local"));
    return { total: real.length, since: real.filter((u) => u.createdAt >= since).length };
  }

  async register(input: RegisterInput): Promise<User> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const birthDate = typeof input.birthDate === "string" ? input.birthDate : "";

    if (!EMAIL_RE.test(email)) throw new AuthError("email_invalid", "И-мэйл хаяг буруу байна.");
    if (!NICK_RE.test(nickname))
      throw new AuthError("nickname_invalid", "Хочны нэр 3–20 үсэг, тоо байна.");
    if (password.length < 8)
      throw new AuthError("password_short", "Нууц үг дор хаяж 8 тэмдэгт байна.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate)))
      throw new AuthError("birthdate_invalid", "Төрсөн огноогоо оруулна уу.");
    if (ageOn(birthDate, this.now()) < MIN_AGE)
      throw new AuthError("too_young", "18 нас хүрсэн хүн л бүртгүүлэх боломжтой.");
    if (input.acceptTerms !== true)
      throw new AuthError("terms_required", "Үйлчилгээний нөхцөлийг зөвшөөрнө үү.");

    for (const u of this.users.values()) {
      if (u.email === email) throw new AuthError("email_taken", "Энэ и-мэйлээр бүртгэл үүссэн байна.");
      if (u.nickname.toLowerCase() === nickname.toLowerCase())
        throw new AuthError("nickname_taken", "Энэ хочны нэрийг өөр хүн авсан байна.");
    }

    const user: User = {
      id: randomBytes(8).toString("hex"),
      email,
      nickname,
      birthDate,
      termsVersion: TERMS_VERSION,
      passwordHash: await hashPassword(password),
      createdAt: this.now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async login(emailRaw: unknown, password: unknown): Promise<User> {
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    const user = [...this.users.values()].find((u) => u.email === email);
    const ok = user && typeof password === "string" && (await checkPassword(password, user.passwordHash));
    if (!ok) throw new AuthError("bad_credentials", "И-мэйл эсвэл нууц үг буруу байна.");
    return user;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId, expires: this.now().getTime() + AuthStore.SESSION_MS });
    return token;
  }

  userForSession(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const s = this.sessions.get(token);
    if (!s || s.expires < this.now().getTime()) return undefined;
    return this.users.get(s.userId);
  }

  endSession(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }

  getUser(id: string) {
    return this.users.get(id);
  }

  /** For demo seeding only. */
  addDemoUser(id: string, nickname: string) {
    this.users.set(id, {
      id,
      email: `${id}@demo.local`,
      nickname,
      birthDate: "2000-01-01",
      termsVersion: TERMS_VERSION,
      passwordHash: "x:00",
      createdAt: this.now(),
    });
  }
}
