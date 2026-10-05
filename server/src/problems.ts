// Problem generation. Every attempt uses the same sequence of templates
// (so difficulty is equal for everyone); only the numbers are random.

export type Level = 1 | 2 | 3 | 4 | 5;

export interface Problem {
  level: Level;
  templateId: string;
  text: string;
  answer: number;
}

export type Rng = () => number;

/** Small deterministic PRNG so a problem set can be reproduced from its seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

interface Template {
  id: string;
  level: Level;
  make: (rng: Rng) => { text: string; answer: number };
}

export const TEMPLATES: Template[] = [
  // Level 1: very easy
  {
    id: "add-1d-1d",
    level: 1,
    make: (rng) => {
      const a = int(rng, 1, 9), b = int(rng, 1, 9);
      return { text: `${a} + ${b}`, answer: a + b };
    },
  },
  {
    id: "sub-teen-1d",
    level: 1,
    make: (rng) => {
      const b = int(rng, 2, 9), answer = int(rng, 1, 9);
      return { text: `${answer + b} − ${b}`, answer };
    },
  },
  // Level 2: easy
  {
    id: "add-2d-1d",
    level: 2,
    make: (rng) => {
      const a = int(rng, 11, 89), b = int(rng, 2, 9);
      return { text: `${a} + ${b}`, answer: a + b };
    },
  },
  {
    id: "sub-2d-1d",
    level: 2,
    make: (rng) => {
      const a = int(rng, 21, 99), b = int(rng, 2, 9);
      return { text: `${a} − ${b}`, answer: a - b };
    },
  },
  // Level 3: medium
  {
    id: "add-2d-2d-nocarry",
    level: 3,
    make: (rng) => {
      const at = int(rng, 1, 7), bt = int(rng, 1, 8 - at);
      const au = int(rng, 0, 8), bu = int(rng, 0, 9 - au);
      const a = at * 10 + au, b = bt * 10 + bu;
      return { text: `${a} + ${b}`, answer: a + b };
    },
  },
  {
    id: "mul-table",
    level: 3,
    make: (rng) => {
      const a = int(rng, 3, 9), b = int(rng, 3, 9);
      return { text: `${a} × ${b}`, answer: a * b };
    },
  },
  // Level 4: moderately difficult
  {
    id: "add-2d-2d-carry",
    level: 4,
    make: (rng) => {
      const au = int(rng, 2, 9), bu = int(rng, 10 - au, 9);
      const a = int(rng, 1, 8) * 10 + au, b = int(rng, 1, 8) * 10 + bu;
      return { text: `${a} + ${b}`, answer: a + b };
    },
  },
  {
    id: "sub-2d-2d-borrow",
    level: 4,
    make: (rng) => {
      const bu = int(rng, 2, 9), au = int(rng, 0, bu - 1);
      const bt = int(rng, 1, 7), at = int(rng, bt + 1, 9);
      const a = at * 10 + au, b = bt * 10 + bu;
      return { text: `${a} − ${b}`, answer: a - b };
    },
  },
  // Level 5: hardest, still solvable in 5 seconds
  {
    id: "mul-2d-1d",
    level: 5,
    make: (rng) => {
      const a = int(rng, 12, 39), b = int(rng, 3, 9);
      return { text: `${a} × ${b}`, answer: a * b };
    },
  },
  {
    id: "div-exact",
    level: 5,
    make: (rng) => {
      const b = int(rng, 3, 12), answer = int(rng, 6, 15);
      return { text: `${b * answer} ÷ ${b}`, answer };
    },
  },
];

const byLevel = (level: Level) => TEMPLATES.filter((t) => t.level === level);

/**
 * Builds a problem set: `perLevel` problems for each level, easiest first.
 * Templates alternate within a level in a fixed order, so the template
 * sequence is identical for every attempt with the same `perLevel`.
 */
export function generateProblems(perLevel: number, seed: number): Problem[] {
  const rng = mulberry32(seed);
  const out: Problem[] = [];
  for (const level of [1, 2, 3, 4, 5] as Level[]) {
    const templates = byLevel(level);
    for (let i = 0; i < perLevel; i++) {
      const t = templates[i % templates.length];
      out.push({ level, templateId: t.id, ...t.make(rng) });
    }
  }
  return out;
}

/** Practice mode: 20 problems, 4 per level. A competition attempt uses 20 per level. */
export const PRACTICE_PER_LEVEL = 4;
export const ATTEMPT_PER_LEVEL = 20;
