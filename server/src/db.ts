// PostgreSQL storage. The game rules stay in memory (AuthStore, CompetitionService);
// every change is written here in order, and everything is read back on start-up,
// so a restart or redeploy loses nothing. One server process owns the database.

import pg from "pg";
import type { AuthPersist, EmailToken, Session, User } from "./auth.js";
import type { AttemptResult, Competition } from "./competition.js";
import type { Entry, ServicePersist, WalletTx, Withdrawal } from "./service.js";

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null unique,
  nickname text not null,
  birth_date text not null,
  terms_version text not null,
  password_hash text not null,
  created_at timestamptz not null
);
create unique index if not exists users_nickname_lower on users (lower(nickname));

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id),
  expires_at timestamptz not null
);

create table if not exists competitions (
  id text primary key,
  name text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  entry_fee integer not null,
  prize text not null,
  prize_image text,
  prize_share integer,
  max_attempts integer not null,
  attempts_used integer not null,
  award jsonb
);

create table if not exists entries (
  id text primary key,
  user_id text not null references users(id),
  competition_id text not null references competitions(id),
  paid_at timestamptz not null,
  start_by timestamptz not null,
  status text not null,
  points integer
);
create index if not exists entries_user on entries (user_id);

create table if not exists results (
  id bigserial primary key,
  competition_id text not null references competitions(id),
  user_id text not null references users(id),
  points integer not null,
  finished_at timestamptz not null
);

create table if not exists wallet_txs (
  id text primary key,
  user_id text not null references users(id),
  kind text not null,
  amount integer not null,
  at timestamptz not null,
  note text not null
);
create index if not exists wallet_txs_user on wallet_txs (user_id);

create table if not exists withdrawals (
  id text primary key,
  user_id text not null references users(id),
  amount integer not null,
  bank text not null,
  account text not null,
  holder text not null,
  status text not null,
  requested_at timestamptz not null,
  decided_at timestamptz,
  reason text
);

alter table users add column if not exists email_verified_at timestamptz;

create table if not exists email_tokens (
  token_hash text primary key,
  user_id text not null references users(id),
  kind text not null,
  expires_at timestamptz not null,
  used boolean not null
);
`;

export interface Snapshot {
  users: User[];
  sessions: Session[];
  competitions: Competition[];
  entries: Entry[];
  results: AttemptResult[];
  txs: WalletTx[];
  withdrawals: Withdrawal[];
  tokens: EmailToken[];
}

export class Database {
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  private constructor(private readonly pool: pg.Pool) {}

  /** Connects and creates any missing tables. */
  static async connect(url: string) {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(SCHEMA);
    return new Database(pool);
  }

  /** Queues a write. Writes run one at a time, in the order the changes happened. */
  private write(sql: string, params: unknown[]) {
    this.queue = this.queue.then(
      () =>
        this.pool.query(sql, params).then(
          () => {},
          (e) => {
            this.failure ??= e;
            console.error("database write failed:", e);
          },
        ),
    );
  }

  /** Waits until every queued write is stored. Throws if one of them failed. */
  async flush() {
    await this.queue;
    if (this.failure) {
      const e = this.failure;
      this.failure = null;
      throw e;
    }
  }

  async close() {
    await this.queue;
    await this.pool.end();
  }

  async load(): Promise<Snapshot> {
    const q = async (sql: string) => (await this.pool.query(sql)).rows;
    const [users, sessions, competitions, entries, results, txs, withdrawals, tokens] = await Promise.all([
      q("select * from users order by created_at"),
      q("select * from sessions"),
      q("select * from competitions order by opens_at"),
      q("select * from entries order by paid_at"),
      q("select * from results order by id"),
      q("select * from wallet_txs order by at"),
      q("select * from withdrawals order by requested_at"),
      q("select * from email_tokens where not used and expires_at > now()"),
    ]);
    return {
      users: users.map((r) => ({
        id: r.id,
        email: r.email,
        nickname: r.nickname,
        birthDate: r.birth_date,
        termsVersion: r.terms_version,
        passwordHash: r.password_hash,
        createdAt: r.created_at,
        emailVerifiedAt: r.email_verified_at ?? undefined,
      })),
      sessions: sessions.map((r) => ({ tokenHash: r.token_hash, userId: r.user_id, expires: r.expires_at })),
      competitions: competitions.map((r) => ({
        id: r.id,
        name: r.name,
        opensAt: r.opens_at,
        closesAt: r.closes_at,
        entryFee: r.entry_fee,
        prize: r.prize,
        prizeImage: r.prize_image ?? undefined,
        prizeShare: r.prize_share ?? undefined,
        maxAttempts: r.max_attempts,
        attemptsUsed: r.attempts_used,
        award: r.award ? { ...r.award, at: new Date(r.award.at) } : undefined,
      })),
      entries: entries.map((r) => ({
        id: r.id,
        userId: r.user_id,
        competitionId: r.competition_id,
        paidAt: r.paid_at,
        startBy: r.start_by,
        status: r.status,
        points: r.points ?? undefined,
      })),
      results: results.map((r) => ({
        competitionId: r.competition_id,
        userId: r.user_id,
        points: r.points,
        finishedAt: r.finished_at,
      })),
      txs: txs.map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind, amount: r.amount, at: r.at, note: r.note })),
      withdrawals: withdrawals.map((r) => ({
        id: r.id,
        userId: r.user_id,
        amount: r.amount,
        bank: r.bank,
        account: r.account,
        holder: r.holder,
        status: r.status,
        requestedAt: r.requested_at,
        decidedAt: r.decided_at ?? undefined,
        reason: r.reason ?? undefined,
      })),
      tokens: tokens.map((r) => ({
        tokenHash: r.token_hash,
        userId: r.user_id,
        kind: r.kind,
        expires: r.expires_at,
        used: r.used,
      })),
    };
  }

  readonly auth: AuthPersist = {
    user: (u) =>
      this.write(
        `insert into users (id, email, nickname, birth_date, terms_version, password_hash, created_at, email_verified_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set email = $2, nickname = $3, password_hash = $6, email_verified_at = $8`,
        [u.id, u.email, u.nickname, u.birthDate, u.termsVersion, u.passwordHash, u.createdAt, u.emailVerifiedAt ?? null],
      ),
    session: (s) =>
      this.write("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
        s.tokenHash,
        s.userId,
        s.expires,
      ]),
    endSession: (h) => this.write("delete from sessions where token_hash = $1", [h]),
    endUserSessions: (id) => this.write("delete from sessions where user_id = $1", [id]),
    emailToken: (t) =>
      this.write(
        `insert into email_tokens (token_hash, user_id, kind, expires_at, used) values ($1, $2, $3, $4, $5)
         on conflict (token_hash) do update set used = $5`,
        [t.tokenHash, t.userId, t.kind, t.expires, t.used],
      ),
  };

  readonly service: ServicePersist = {
    competition: (c) =>
      this.write(
        `insert into competitions
           (id, name, opens_at, closes_at, entry_fee, prize, prize_image, prize_share, max_attempts, attempts_used, award)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set
           name = $2, opens_at = $3, closes_at = $4, entry_fee = $5, prize = $6, prize_image = $7,
           prize_share = $8, max_attempts = $9, attempts_used = $10, award = $11`,
        [
          c.id,
          c.name,
          c.opensAt,
          c.closesAt,
          c.entryFee,
          c.prize,
          c.prizeImage ?? null,
          c.prizeShare ?? null,
          c.maxAttempts,
          c.attemptsUsed,
          c.award ? JSON.stringify(c.award) : null,
        ],
      ),
    deleteCompetition: (id) => this.write("delete from competitions where id = $1", [id]),
    entry: (e) =>
      this.write(
        `insert into entries (id, user_id, competition_id, paid_at, start_by, status, points)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set status = $6, points = $7`,
        [e.id, e.userId, e.competitionId, e.paidAt, e.startBy, e.status, e.points ?? null],
      ),
    result: (r) =>
      this.write("insert into results (competition_id, user_id, points, finished_at) values ($1, $2, $3, $4)", [
        r.competitionId,
        r.userId,
        r.points,
        r.finishedAt,
      ]),
    tx: (t) =>
      this.write("insert into wallet_txs (id, user_id, kind, amount, at, note) values ($1, $2, $3, $4, $5, $6)", [
        t.id,
        t.userId,
        t.kind,
        t.amount,
        t.at,
        t.note,
      ]),
    withdrawal: (w) =>
      this.write(
        `insert into withdrawals (id, user_id, amount, bank, account, holder, status, requested_at, decided_at, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set status = $7, decided_at = $9, reason = $10`,
        [w.id, w.userId, w.amount, w.bank, w.account, w.holder, w.status, w.requestedAt, w.decidedAt ?? null, w.reason ?? null],
      ),
  };
}
