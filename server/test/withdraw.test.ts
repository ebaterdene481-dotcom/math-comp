import { describe, expect, it } from "vitest";
import { CompetitionService, MIN_WITHDRAWAL } from "../src/service.js";

const ok = { bank: "Хаан банк", account: "5012 3456 78", holder: "Б. Хасар" };

function setup() {
  const t = new Date("2026-10-06T12:00:00Z");
  return new CompetitionService(() => t, () => "Хасар");
}

describe("withdrawals", () => {
  it("takes the money out when asked and keeps it out once paid", () => {
    const s = setup();
    s.demoTopUp("a", 15000);
    const w = s.requestWithdrawal("a", { ...ok, amount: 12000 });
    expect(w).toMatchObject({ status: "pending", account: "5012345678" });
    expect(s.balance("a")).toBe(3000);
    s.markWithdrawalPaid(w.id);
    expect(s.balance("a")).toBe(3000);
    expect(s.withdrawalsOf("a")[0].status).toBe("paid");
    expect(() => s.markWithdrawalPaid(w.id)).toThrow(expect.objectContaining({ code: "decided" }));
  });

  it("gives the money back when an admin rejects it, with the reason", () => {
    const s = setup();
    s.demoTopUp("a", 20000);
    const w = s.requestWithdrawal("a", { ...ok, amount: 20000 });
    expect(() => s.rejectWithdrawal(w.id, "")).toThrow(expect.objectContaining({ code: "reason_required" }));
    s.rejectWithdrawal(w.id, "Данс эзэмшигчийн нэр таарахгүй");
    expect(s.balance("a")).toBe(20000);
    expect(s.wallet("a").transactions[0]).toMatchObject({ kind: "refund", amount: 20000 });
    expect(s.withdrawalsOf("a")[0]).toMatchObject({ status: "rejected", reason: "Данс эзэмшигчийн нэр таарахгүй" });
  });

  it("refuses less than the minimum, more than the balance, bad details and a second open request", () => {
    const s = setup();
    s.demoTopUp("a", 30000);
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: MIN_WITHDRAWAL - 1 }))).toBe("amount_small");
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: 40000 }))).toBe("insufficient_funds");
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: 10000, bank: "Банк" }))).toBe("bank_invalid");
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: 10000, account: "12ab" }))).toBe("account_invalid");
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: 10000, holder: "" }))).toBe("holder_invalid");
    s.requestWithdrawal("a", { ...ok, amount: 10000 });
    expect(code(() => s.requestWithdrawal("a", { ...ok, amount: 10000 }))).toBe("pending_withdrawal");
    expect(s.balance("a")).toBe(20000);
    expect(s.adminWithdrawals()[0]).toMatchObject({ nickname: "Хасар", balance: 20000, status: "pending" });
  });
});
