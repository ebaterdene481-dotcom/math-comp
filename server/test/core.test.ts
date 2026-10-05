import { describe, expect, it } from "vitest";
import { TEMPLATES, generateProblems, mulberry32 } from "../src/problems.js";
import { parseAnswer, scoreHundredths } from "../src/scoring.js";

describe("scoreHundredths", () => {
  it("matches the agreed formula", () => {
    expect(scoreHundredths(0)).toBe(10000);
    expect(scoreHundredths(500)).toBe(10000);
    expect(scoreHundredths(1000)).toBe(8889);
    expect(scoreHundredths(2000)).toBe(6667);
    expect(scoreHundredths(2750)).toBe(5000);
    expect(scoreHundredths(4000)).toBe(2222);
    expect(scoreHundredths(4900)).toBe(222);
    expect(scoreHundredths(5000)).toBe(0);
    expect(scoreHundredths(9000)).toBe(0);
  });
});

describe("parseAnswer", () => {
  it("accepts digits, spaces and leading zeros", () => {
    expect(parseAnswer("15")).toBe(15);
    expect(parseAnswer(" 015 ")).toBe(15);
    expect(parseAnswer("0")).toBe(0);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "-3", "1.5", "abc", "1e3", "1234567"]) expect(parseAnswer(bad)).toBeNull();
  });
});

describe("generateProblems", () => {
  it("gives 4 per level in increasing order for practice", () => {
    const ps = generateProblems(4, 1);
    expect(ps).toHaveLength(20);
    expect(ps.map((p) => p.level)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
  });

  it("uses the same template sequence for every seed", () => {
    const a = generateProblems(20, 1).map((p) => p.templateId);
    const b = generateProblems(20, 999).map((p) => p.templateId);
    expect(a).toEqual(b);
    expect(a).toHaveLength(100);
  });

  it("is reproducible from its seed", () => {
    expect(generateProblems(4, 42)).toEqual(generateProblems(4, 42));
  });

  it("produces correct, non-negative integer answers for every template", () => {
    const rng = mulberry32(7);
    for (const t of TEMPLATES) {
      for (let i = 0; i < 2000; i++) {
        const { text, answer } = t.make(rng);
        expect(Number.isInteger(answer)).toBe(true);
        expect(answer).toBeGreaterThanOrEqual(0);
        const [a, op, b] = text.split(" ");
        const x = Number(a), y = Number(b);
        const expected = op === "+" ? x + y : op === "−" ? x - y : op === "×" ? x * y : x / y;
        expect(answer, `${t.id}: ${text}`).toBe(expected);
      }
    }
  });

  it("respects carry/borrow rules in level 3 and 4 templates", () => {
    const rng = mulberry32(3);
    const get = (id: string) => TEMPLATES.find((t) => t.id === id)!;
    for (let i = 0; i < 2000; i++) {
      const [a, , b] = get("add-2d-2d-nocarry").make(rng).text.split(" ").map(Number);
      expect((a % 10) + (b % 10)).toBeLessThan(10);
      const [c, , d] = get("add-2d-2d-carry").make(rng).text.split(" ").map(Number);
      expect((c % 10) + (d % 10)).toBeGreaterThanOrEqual(10);
      const [e, , f] = get("sub-2d-2d-borrow").make(rng).text.split(" ").map(Number);
      expect(e % 10).toBeLessThan(f % 10);
      expect(e).toBeGreaterThan(f);
    }
  });
});
