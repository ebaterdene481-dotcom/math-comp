// Fair play: runs answered faster than a person can, and one person playing under
// several accounts. Nothing is blocked automatically; the admin sees the flags and
// decides. Plain TypeScript with no server imports, so the browser preview runs it too.

import type { CompetitionService } from "./service.js";
import type { ProblemResult } from "./session.js";

/** A correct answer this fast (after the latency credit) is beyond human reading and typing. */
export const SUPERHUMAN_MS = 300;
/** How many superhuman answers in one run make it suspicious; one could be a lucky guess. */
export const SUPERHUMAN_COUNT = 3;
/** A run whose typical correct answer is this fast is suspicious too… */
export const FAST_MEDIAN_MS = 700;
/** …once it has at least this many correct answers. */
export const FAST_MEDIAN_MIN_SOLVED = 20;

/** How fast a paid run was, kept with the entry. */
export interface SpeedReview {
  solved: number;
  medianMs: number | null;
  fastestMs: number | null;
  /** Correct answers under SUPERHUMAN_MS. */
  superhuman: number;
  suspicious: boolean;
}

export function reviewSpeed(results: Pick<ProblemResult, "solved" | "elapsedMs">[]): SpeedReview {
  const times = results
    .filter((r) => r.solved && r.elapsedMs !== null)
    .map((r) => r.elapsedMs!)
    .sort((a, b) => a - b);
  const medianMs = times.length
    ? Math.round(
        times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2,
      )
    : null;
  const superhuman = times.filter((t) => t < SUPERHUMAN_MS).length;
  return {
    solved: times.length,
    medianMs,
    fastestMs: times[0] ?? null,
    superhuman,
    suspicious:
      superhuman >= SUPERHUMAN_COUNT ||
      (times.length >= FAST_MEDIAN_MIN_SOLVED && medianMs !== null && medianMs < FAST_MEDIAN_MS),
  };
}

/**
 * Where a player was seen from. The server stores hashes, never the raw address or
 * device id: the admin only needs to know that two accounts share one.
 */
export type SightingKind = "device" | "ip";

export interface Sighting {
  userId: string;
  kind: SightingKind;
  value: string;
  firstAt: Date;
  lastAt: Date;
}

export interface SightingPersist {
  sighting(s: Sighting): void;
}

/** Why two accounts look like the same person. */
export type LinkReason = "device" | "bank" | "ip";

export const LINK_TEXT: Record<LinkReason, string> = {
  device: "Нэг төхөөрөмж",
  bank: "Нэг банкны данс",
  ip: "Нэг IP хаяг",
};

export class Sightings {
  private byKey = new Map<string, Sighting>();

  constructor(
    private readonly now: () => Date,
    private readonly persist: SightingPersist = { sighting() {} },
  ) {}

  load(list: Sighting[]) {
    for (const s of list) this.byKey.set(`${s.userId}|${s.kind}|${s.value}`, s);
  }

  /** Notes that `userId` used this device or address. */
  see(userId: string, kind: SightingKind, value: string | undefined) {
    if (!value) return;
    const key = `${userId}|${kind}|${value}`;
    const s = this.byKey.get(key);
    if (s) {
      s.lastAt = this.now();
    } else {
      const fresh: Sighting = { userId, kind, value, firstAt: this.now(), lastAt: this.now() };
      this.byKey.set(key, fresh);
      this.persist.sighting(fresh);
      return;
    }
    this.persist.sighting(s);
  }

  all() {
    return [...this.byKey.values()];
  }
}

export interface LinkedAccount {
  userId: string;
  reasons: LinkReason[];
}

/**
 * Accounts sharing a device, a withdrawal bank account or an IP address with another
 * account. A shared IP alone is weak: mobile networks put many people behind one.
 */
export function accountLinks(sightings: Sighting[], withdrawals: { userId: string; account: string }[]) {
  const groups = new Map<string, Set<string>>();
  const add = (reason: LinkReason, value: string, userId: string) => {
    const k = `${reason}|${value}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(userId);
  };
  for (const s of sightings) add(s.kind, s.value, s.userId);
  for (const w of withdrawals) add("bank", w.account, w.userId);

  const links = new Map<string, Map<string, Set<LinkReason>>>();
  for (const [k, users] of groups) {
    if (users.size < 2) continue;
    const reason = k.slice(0, k.indexOf("|")) as LinkReason;
    for (const a of users)
      for (const b of users) {
        if (a === b) continue;
        if (!links.has(a)) links.set(a, new Map());
        const m = links.get(a)!;
        if (!m.has(b)) m.set(b, new Set());
        m.get(b)!.add(reason);
      }
  }
  const order: LinkReason[] = ["device", "bank", "ip"];
  return (userId: string): LinkedAccount[] =>
    [...(links.get(userId) ?? new Map<string, Set<LinkReason>>())].map(([other, reasons]) => ({
      userId: other,
      reasons: order.filter((r) => reasons.has(r)),
    }));
}

export interface AccountInfo {
  id: string;
  email: string;
  nickname: string;
  createdAt: Date;
  emailVerified: boolean;
  isAdmin?: boolean;
}

/** One row of the admin's player list. */
export function adminUserRows(users: AccountInfo[], service: CompetitionService, sightings: Sighting[]) {
  // Admins sign in on their own devices to look around; that is not a second account.
  const admins = new Set(users.filter((u) => u.isAdmin).map((u) => u.id));
  const linksOf = accountLinks(
    sightings.filter((s) => !admins.has(s.userId)),
    service.withdrawals.filter((w) => !admins.has(w.userId)),
  );
  const nick = new Map(users.map((u) => [u.id, u.nickname]));
  return users
    .map((u) => {
      const runs = service.entries.filter((e) => e.userId === u.id && e.status === "finished");
      const fastRuns = runs
        .filter((e) => e.review?.suspicious)
        .map((e) => ({
          competitionName: service.competitions.find((c) => c.id === e.competitionId)?.name ?? "?",
          points: e.points ?? 0,
          paidAt: e.paidAt.toISOString(),
          review: e.review!,
        }));
      const links = linksOf(u.id).map((l) => ({ nickname: nick.get(l.userId) ?? "?", reasons: l.reasons }));
      // A shared IP alone is not enough to flag someone.
      const strongLinks = links.filter((l) => l.reasons.some((r) => r !== "ip"));
      return {
        id: u.id,
        nickname: u.nickname,
        email: u.email,
        emailVerified: u.emailVerified,
        isAdmin: Boolean(u.isAdmin),
        createdAt: u.createdAt.toISOString(),
        balance: service.balance(u.id),
        runs: runs.length,
        bestPoints: runs.length ? Math.max(...runs.map((e) => e.points ?? 0)) : null,
        fastRuns,
        links,
        flagged: fastRuns.length > 0 || strongLinks.length > 0,
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.createdAt.localeCompare(a.createdAt));
}
