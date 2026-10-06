// Competition state. Kept in memory for now; moves to PostgreSQL with the wallet phase.

export const MAX_ATTEMPTS = 100;

export type CompetitionStatus = "upcoming" | "live" | "finished";

export interface Competition {
  id: string;
  name: string;
  opensAt: Date;
  closesAt: Date;
  /** Whole tugrik. */
  entryFee: number;
  prize: string;
  /** Photo of the prize shown on the home page (URL). */
  prizeImage?: string;
  /** Percent of the fees collected that goes to the winner in cash; unset when the prize is goods. */
  prizeShare?: number;
  maxAttempts: number;
  /** Paid attempt slots taken so far (all players combined). */
  attemptsUsed: number;
  /** Set by an admin once the prize has been handed to the winner. */
  award?: Award;
}

export interface Award {
  userId: string;
  nickname: string;
  points: number;
  at: Date;
  /** Tugrik paid into the winner's wallet; 0 when the prize is goods. */
  cash: number;
}

export interface AttemptResult {
  competitionId: string;
  userId: string;
  /** Integer hundredths of a point. */
  points: number;
  finishedAt: Date;
}

export function statusOf(c: Competition, now: Date): CompetitionStatus {
  if (c.attemptsUsed >= c.maxAttempts || now >= c.closesAt) return "finished";
  if (now < c.opensAt) return "upcoming";
  return "live";
}

export interface Leader {
  userId: string;
  points: number;
  achievedAt: Date;
}

/**
 * Each player's best attempt, highest first. Ties go to whoever reached
 * the score first.
 */
export function leaderboard(results: AttemptResult[], competitionId: string): Leader[] {
  const best = new Map<string, Leader>();
  for (const r of results) {
    if (r.competitionId !== competitionId) continue;
    const cur = best.get(r.userId);
    if (!cur || r.points > cur.points || (r.points === cur.points && r.finishedAt < cur.achievedAt)) {
      best.set(r.userId, { userId: r.userId, points: r.points, achievedAt: r.finishedAt });
    }
  }
  return [...best.values()].sort(
    (a, b) => b.points - a.points || a.achievedAt.getTime() - b.achievedAt.getTime(),
  );
}

/** Picks the competition to show on the home page: live first, then the next one, then the last finished. */
export function currentCompetition(all: Competition[], now: Date): Competition | undefined {
  const by = (s: CompetitionStatus) => all.filter((c) => statusOf(c, now) === s);
  const live = by("live").sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());
  if (live.length) return live[0];
  const upcoming = by("upcoming").sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  if (upcoming.length) return upcoming[0];
  return by("finished").sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime())[0];
}

/** Cash the winner gets: the admin's share of the fees taken so far, whole tugrik. */
export function prizeFund(c: Competition): number {
  return Math.floor((Math.min(c.attemptsUsed, c.maxAttempts) * c.entryFee * (c.prizeShare ?? 0)) / 100);
}
