// Sample data so the home page has something to show before real competitions exist.
// Only loaded when DEMO_DATA=1.

import type { AttemptResult, Competition } from "./competition.js";
import { MAX_ATTEMPTS } from "./competition.js";

const PLAYERS: Array<[string, number]> = [
  ["Тэмүүлэн", 914250],
  ["Saraa_07", 902118],
  ["Билгүүн", 897640],
  ["anu.math", 871002],
  ["Ганбат", 860455],
  ["Номин", 842310],
  ["Off1cer", 815774],
  ["Мөнхжин", 799031],
];

/** `addPlayer` registers each sample player so the leaderboard can show their nickname. */
export function seedDemo(addPlayer: (id: string, nickname: string) => void, now: Date) {
  const hour = 3600_000;
  const competition: Competition = {
    id: "demo-1",
    name: "Намрын тэмцээн №1",
    opensAt: new Date(now.getTime() - 2 * hour),
    closesAt: new Date(now.getTime() + 10 * hour),
    entryFee: 5000,
    prize: "Ухаалаг утас",
    prizeImage: "/prizes/demo-phone.svg",
    maxAttempts: MAX_ATTEMPTS,
    attemptsUsed: 63,
  };
  const results: AttemptResult[] = PLAYERS.map(([nickname, points], i) => {
    const id = `demo-user-${i}`;
    addPlayer(id, nickname);
    return {
      competitionId: competition.id,
      userId: id,
      points, // hundredths: 914250 = 9,142.50 of a possible 10,000
      finishedAt: new Date(now.getTime() - (i + 1) * 9 * 60_000),
    };
  });
  return { competitions: [competition], results };
}
