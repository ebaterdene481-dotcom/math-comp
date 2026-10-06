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
  // Two earlier competitions, already decided, for the past competitions page.
  const day = 24 * hour;
  const past: Array<[Competition, number[]]> = [
    [
      {
        id: "demo-past-2",
        name: "Зуны тэмцээн №2",
        opensAt: new Date(now.getTime() - 9 * day),
        closesAt: new Date(now.getTime() - 8 * day),
        entryFee: 5000,
        prize: "Утасгүй чихэвч",
        prizeImage: "/prizes/demo-headphones.svg",
        maxAttempts: MAX_ATTEMPTS,
        attemptsUsed: MAX_ATTEMPTS,
      },
      [905512, 921077, 887340, 899815, 866120, 852400, 0, 830995],
    ],
    [
      {
        id: "demo-past-1",
        name: "Зуны тэмцээн №1",
        opensAt: new Date(now.getTime() - 23 * day),
        closesAt: new Date(now.getTime() - 22 * day),
        entryFee: 2000,
        prize: "Тоглоомын хулгана",
        prizeImage: "/prizes/demo-mouse.svg",
        maxAttempts: MAX_ATTEMPTS,
        attemptsUsed: 74,
      },
      [880410, 0, 869902, 0, 893377, 841230, 815600, 0],
    ],
  ];
  for (const [c, scores] of past) {
    scores.forEach((points, i) => {
      if (points > 0)
        results.push({
          competitionId: c.id,
          userId: `demo-user-${i}`,
          points,
          finishedAt: new Date(c.closesAt.getTime() - (i + 2) * 37 * 60_000),
        });
    });
  }
  return { competitions: [competition, ...past.map(([c]) => c)], results };
}
