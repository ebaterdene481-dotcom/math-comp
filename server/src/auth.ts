// Accounts and sessions: age 18+, terms accepted, unique email and nickname.
// Held in memory and written through to the database when the server has one.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { passwordProblem } from "./password.js";

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
  /** Set once the player opened the link sent to their email. */
  emailVerifiedAt?: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  /** Can open the admin page. */
  isAdmin: boolean;
  /** Paying an entry fee or taking money out needs a confirmed email. */
  emailVerified: boolean;
}

export const toPublic = (u: User, isAdmin = false): PublicUser => ({
  id: u.id,
  email: u.email,
  nickname: u.nickname,
  isAdmin,
  emailVerified: Boolean(u.emailVerifiedAt),
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

export interface Session {
  /** SHA-256 of the cookie value, so a leaked database cannot be used to sign in. */
  tokenHash: string;
  userId: string;
  expires: Date;
}

export type EmailTokenKind = "verify" | "reset";

/** A one-time link sent by email. Only the hash is kept. */
export interface EmailToken {
  tokenHash: string;
  userId: string;
  kind: EmailTokenKind;
  expires: Date;
  used: boolean;
}

/** How long each kind of emailed link works. */
export const TOKEN_MS: Record<EmailTokenKind, number> = { verify: 24 * 3600_000, reset: 3600_000 };

/** Where accounts and sessions are written so they survive a restart. */
export interface AuthPersist {
  user(u: User): void;
  session(s: Session): void;
  endSession(tokenHash: string): void;
  endUserSessions(userId: string): void;
  emailToken(t: EmailToken): void;
}

const IN_MEMORY: AuthPersist = {
  user() {},
  session() {},
  endSession() {},
  endUserSessions() {},
  emailToken() {},
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class AuthStore {
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>();
  private tokens = new Map<string, EmailToken>();
  static readonly SESSION_MS = 30 * 24 * 3600 * 1000;

  /** Admins are named by email (ADMIN_EMAILS), so no one can make themselves one. */
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly now: () => Date = () => new Date(),
    adminEmails: string[] = [],
    private readonly persist: AuthPersist = IN_MEMORY,
  ) {
    this.adminEmails = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  /** Puts back what the database holds, on start-up. Expired sessions are dropped. */
  load(users: User[], sessions: Session[], tokens: EmailToken[] = []) {
    for (const u of users) this.users.set(u.id, u);
    const now = this.now().getTime();
    for (const s of sessions) if (s.expires.getTime() >= now) this.sessions.set(s.tokenHash, s);
    for (const t of tokens) if (!t.used && t.expires.getTime() >= now) this.tokens.set(t.tokenHash, t);
  }

  /** Writes every account, e.g. freshly seeded demo players. */
  saveAll() {
    for (const u of this.users.values()) this.persist.user(u);
  }

  isAdmin(user: User) {
    return this.adminEmails.has(user.email);
  }

  /** Registered players, sample players excluded. */
  realUsers() {
    return [...this.users.values()].filter((u) => !u.email.endsWith("@demo.local"));
  }

  /** Registered players (sample players excluded), and how many joined since `since`. */
  userCounts(since: Date) {
    const real = [...this.users.values()].filter((u) => !u.email.endsWith("@demo.local"));
    return { total: real.length, since: real.filter((u) => u.createdAt >= since).length };
  }

  /** `skipPasswordRules` is for the sample admin only, whose password predates the rules. */
  async register(input: RegisterInput, opts: { skipPasswordRules?: boolean } = {}): Promise<User> {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const birthDate = typeof input.birthDate === "string" ? input.birthDate : "";

    if (!EMAIL_RE.test(email)) throw new AuthError("email_invalid", "И-мэйл хаяг буруу байна.");
    if (!NICK_RE.test(nickname))
      throw new AuthError("nickname_invalid", "Хочны нэр 3–20 үсэг, тоо байна.");
    const weak = opts.skipPasswordRules ? null : passwordProblem(password);
    if (weak) throw new AuthError("password_weak", weak);
    const year = Number(birthDate.slice(0, 4));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate)) || year < 1900)
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
    this.persist.user(user);
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
    const s: Session = { tokenHash: hashToken(token), userId, expires: new Date(this.now().getTime() + AuthStore.SESSION_MS) };
    this.sessions.set(s.tokenHash, s);
    this.persist.session(s);
    return token;
  }

  userForSession(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const s = this.sessions.get(hashToken(token));
    if (!s || s.expires.getTime() < this.now().getTime()) return undefined;
    return this.users.get(s.userId);
  }

  endSession(token: string | undefined) {
    if (!token) return;
    const h = hashToken(token);
    if (this.sessions.delete(h)) this.persist.endSession(h);
  }

  getUser(id: string) {
    return this.users.get(id);
  }

  findByEmail(emailRaw: unknown) {
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    return [...this.users.values()].find((u) => u.email === email);
  }

  /** A new one-time link for `userId`. Earlier unused links of the same kind stop working. */
  issueToken(userId: string, kind: EmailTokenKind): string {
    for (const t of this.tokens.values())
      if (t.userId === userId && t.kind === kind) {
        this.tokens.delete(t.tokenHash);
        this.persist.emailToken({ ...t, used: true });
      }
    const token = randomBytes(32).toString("base64url");
    const t: EmailToken = {
      tokenHash: hashToken(token),
      userId,
      kind,
      expires: new Date(this.now().getTime() + TOKEN_MS[kind]),
      used: false,
    };
    this.tokens.set(t.tokenHash, t);
    this.persist.emailToken(t);
    return token;
  }

  /** Uses up a link; throws if it is unknown, used or too old. */
  private consume(token: unknown, kind: EmailTokenKind): User {
    const t = typeof token === "string" ? this.tokens.get(hashToken(token)) : undefined;
    const user = t && t.kind === kind && t.expires.getTime() >= this.now().getTime() ? this.users.get(t.userId) : undefined;
    if (!t || !user)
      throw new AuthError(
        "link_invalid",
        kind === "verify"
          ? "Холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Шинэ холбоос авна уу."
          : "Нууц үг сэргээх холбоос хүчингүй эсвэл хугацаа нь дууссан байна. Дахин хүснэ үү.",
      );
    this.tokens.delete(t.tokenHash);
    this.persist.emailToken({ ...t, used: true });
    return user;
  }

  verifyEmail(token: unknown): User {
    const user = this.consume(token, "verify");
    this.markVerified(user);
    return user;
  }

  markVerified(user: User) {
    if (user.emailVerifiedAt) return;
    user.emailVerifiedAt = this.now();
    this.persist.user(user);
  }

  /** Sets a new password from a reset link and signs the account out everywhere. */
  async resetPassword(token: unknown, password: unknown): Promise<User> {
    const weak = typeof password === "string" ? passwordProblem(password) : "Шинэ нууц үгээ оруулна уу.";
    if (typeof password !== "string" || weak) throw new AuthError("password_weak", weak!);
    const user = this.consume(token, "reset");
    user.passwordHash = await hashPassword(password);
    // Opening the link proved the email is theirs.
    user.emailVerifiedAt ??= this.now();
    this.persist.user(user);
    for (const [h, s] of this.sessions) if (s.userId === user.id) this.sessions.delete(h);
    this.persist.endUserSessions(user.id);
    return user;
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
      emailVerifiedAt: this.now(),
    });
  }
}
