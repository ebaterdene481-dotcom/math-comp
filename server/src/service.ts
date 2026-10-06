// Competitions, paid entries and the wallet ledger. Plain TypeScript with no
// server imports, so the browser preview can run the very same rules.

import {
  type AttemptResult,
  type Competition,
  type CompetitionStatus,
  currentCompetition,
  leaderboard,
  statusOf,
} from "./competition.js";
import { ATTEMPT_PER_LEVEL, type Problem, generateProblems } from "./problems.js";

/** After paying, a player has this long to start the attempt. */
export const START_WINDOW_MS = 15 * 60_000;

export type EntryStatus = "paid" | "playing" | "finished" | "expired";

export interface Entry {
  id: string;
  userId: string;
  competitionId: string;
  paidAt: Date;
  startBy: Date;
  status: EntryStatus;
  points?: number;
}

export type TxKind = "topup" | "entry" | "prize" | "withdraw";

export interface WalletTx {
  id: string;
  userId: string;
  kind: TxKind;
  /** Whole tugrik; negative takes money out. */
  amount: number;
  at: Date;
  note: string;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const newId = () => globalThis.crypto.randomUUID();

export class CompetitionService {
  readonly competitions: Competition[] = [];
  readonly results: AttemptResult[] = [];
  readonly entries: Entry[] = [];
  readonly txs: WalletTx[] = [];

  constructor(
    private readonly now: () => Date,
    private readonly nicknameOf: (userId: string) => string | undefined,
  ) {}

  // Wallet

  balance(userId: string) {
    return this.txs.filter((t) => t.userId === userId).reduce((sum, t) => sum + t.amount, 0);
  }

  wallet(userId: string) {
    return {
      balance: this.balance(userId),
      transactions: this.txs
        .filter((t) => t.userId === userId)
        .reverse() // newest first, keeping same-instant entries in reverse order of recording
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((t) => ({ id: t.id, kind: t.kind, amount: t.amount, at: t.at.toISOString(), note: t.note })),
    };
  }

  /** Adds money without a payment. Only for demo data until a payment provider is chosen. */
  demoTopUp(userId: string, amount: number) {
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000)
      throw new ServiceError("amount_invalid", "Дүн буруу байна.");
    this.txs.push({ id: newId(), userId, kind: "topup", amount, at: this.now(), note: "Туршилтын цэнэглэлт" });
  }

  // Competitions

  current() {
    const c = currentCompetition(this.competitions, this.now());
    if (!c) return { competition: null, leaders: [] };
    return { competition: this.publicCompetition(c), leaders: this.standings(c.id).slice(0, 3) };
  }

  publicCompetition(c: Competition) {
    return {
      id: c.id,
      name: c.name,
      status: statusOf(c, this.now()) as CompetitionStatus,
      opensAt: c.opensAt.toISOString(),
      closesAt: c.closesAt.toISOString(),
      entryFee: c.entryFee,
      prize: c.prize,
      prizeImage: c.prizeImage ?? null,
      maxAttempts: c.maxAttempts,
      attemptsUsed: Math.min(c.attemptsUsed, c.maxAttempts),
    };
  }

  /** Full ranking: each player's best attempt, ties to whoever got there first. */
  standings(competitionId: string) {
    return leaderboard(this.results, competitionId).map((l, i) => ({
      rank: i + 1,
      userId: l.userId,
      nickname: this.nicknameOf(l.userId) ?? "?",
      points: l.points,
      attempts: this.results.filter((r) => r.competitionId === competitionId && r.userId === l.userId).length,
      achievedAt: l.achievedAt.toISOString(),
    }));
  }

  competition(id: string) {
    const c = this.competitions.find((x) => x.id === id);
    if (!c) throw new ServiceError("not_found", "Тэмцээн олдсонгүй.");
    return c;
  }

  // Entries

  /** Pays the fee from the wallet and takes one of the competition's attempt slots. */
  enter(userId: string, competitionId: string): Entry {
    const c = this.competition(competitionId);
    const status = statusOf(c, this.now());
    if (status === "upcoming") throw new ServiceError("not_open", "Тэмцээн хараахан эхлээгүй байна.");
    if (status === "finished") throw new ServiceError("closed", "Тэмцээн хаагдсан байна.");
    this.expireStale();
    if (this.entries.some((e) => e.userId === userId && (e.status === "paid" || e.status === "playing")))
      throw new ServiceError("open_entry", "Эхлээгүй эсвэл дуусаагүй оролдлого байна. Эхлээд түүнийгээ бодоорой.");
    const balance = this.balance(userId);
    if (balance < c.entryFee)
      throw new ServiceError("insufficient_funds", "Хэтэвчинд мөнгө хүрэлцэхгүй байна.", {
        balance,
        need: c.entryFee - balance,
      });

    const paidAt = this.now();
    const entry: Entry = {
      id: newId(),
      userId,
      competitionId,
      paidAt,
      startBy: new Date(paidAt.getTime() + START_WINDOW_MS),
      status: "paid",
    };
    c.attemptsUsed++;
    this.entries.push(entry);
    this.txs.push({ id: newId(), userId, kind: "entry", amount: -c.entryFee, at: paidAt, note: c.name });
    return entry;
  }

  /** Entries the player can still start, oldest first. Unstarted ones past their window expire. */
  openEntries(userId: string) {
    this.expireStale();
    return this.entries
      .filter((e) => e.userId === userId && (e.status === "paid" || e.status === "playing"))
      .map((e) => this.publicEntry(e));
  }

  entry(userId: string, entryId: string) {
    this.expireStale();
    const e = this.entries.find((x) => x.id === entryId);
    if (!e || e.userId !== userId) throw new ServiceError("not_found", "Оролдлого олдсонгүй.");
    return e;
  }

  publicEntry(e: Entry) {
    const c = this.competition(e.competitionId);
    return {
      id: e.id,
      competitionId: e.competitionId,
      competitionName: c.name,
      status: e.status,
      paidAt: e.paidAt.toISOString(),
      startBy: e.startBy.toISOString(),
      points: e.points ?? null,
    };
  }

  /** Starts a paid attempt and returns its 100 problems. One start per entry. */
  beginAttempt(userId: string, entryId: string, seed: number): Problem[] {
    const e = this.entry(userId, entryId);
    if (e.status === "expired") throw new ServiceError("expired", "Эхлэх хугацаа дууссан байна.");
    if (e.status !== "paid") throw new ServiceError("used", "Энэ оролдлогыг аль хэдийн эхлүүлсэн байна.");
    e.status = "playing";
    return generateProblems(ATTEMPT_PER_LEVEL, seed);
  }

  finishAttempt(entryId: string, points: number) {
    const e = this.entries.find((x) => x.id === entryId);
    if (!e || e.status !== "playing") return;
    e.status = "finished";
    e.points = points;
    this.results.push({ competitionId: e.competitionId, userId: e.userId, points, finishedAt: this.now() });
  }

  /** Rank and field size for one player, after an attempt. */
  placing(competitionId: string, userId: string) {
    const board = this.standings(competitionId);
    const i = board.findIndex((s) => s.userId === userId);
    const top = board.slice(0, 3).map(({ rank, nickname, points }) => ({ rank, nickname, points }));
    return { rank: i + 1 || null, players: board.length, top };
  }

  private expireStale() {
    const t = this.now().getTime();
    for (const e of this.entries) if (e.status === "paid" && e.startBy.getTime() < t) e.status = "expired";
  }

  // Profile

  profile(userId: string) {
    const mine = this.results.filter((r) => r.userId === userId);
    const history = this.competitions
      .filter((c) => mine.some((r) => r.competitionId === c.id))
      .map((c) => {
        const board = this.standings(c.id);
        const own = board.find((s) => s.userId === userId)!;
        return {
          competitionId: c.id,
          name: c.name,
          status: statusOf(c, this.now()),
          closesAt: c.closesAt.toISOString(),
          attempts: own.attempts,
          bestPoints: own.points,
          rank: own.rank,
          players: board.length,
        };
      })
      .sort((a, b) => b.closesAt.localeCompare(a.closesAt));
    return {
      wallet: { balance: this.balance(userId) },
      stats: {
        competitions: history.length,
        attempts: mine.length,
        bestPoints: history.length ? Math.max(...history.map((h) => h.bestPoints)) : null,
        bestRank: history.length ? Math.min(...history.map((h) => h.rank)) : null,
      },
      history,
    };
  }
}
