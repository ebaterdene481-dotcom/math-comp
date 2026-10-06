import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Mail } from "../src/mail.js";

const PLAYER = { email: "k@b.mn", password: "password1", nickname: "Хасар", birthDate: "1990-01-01", acceptTerms: true };

async function setup(now = () => new Date()) {
  const sent: Mail[] = [];
  const app = await buildApp({
    demo: true,
    now,
    webOrigin: "https://5sec.mn/",
    mailer: { send: async (m) => void sent.push(m) },
  });
  const linkIn = (m: Mail) => /https:\/\/5sec\.mn\/\w+\?token=\S+/.exec(m.text)![0];
  const tokenIn = (m: Mail) => new URL(linkIn(m)).searchParams.get("token");
  return { app, sent, linkIn, tokenIn };
}

const sessionOf = (r: { cookies: { name: string; value: string }[] }) => ({
  session: r.cookies.find((c) => c.name === "session")!.value,
});

describe("email verification and password reset", () => {
  it("refuses a registration whose repeated password differs", async () => {
    const { app, sent } = await setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { ...PLAYER, passwordConfirm: "password2" },
    });
    expect(r.json()).toMatchObject({ error: "password_mismatch" });
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("emails a link at registration, and only a verified player can pay or withdraw", async () => {
    const { app, sent, linkIn, tokenIn } = await setup();
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { ...PLAYER, passwordConfirm: PLAYER.password },
    });
    expect(reg.json().user.emailVerified).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("k@b.mn");
    expect(linkIn(sent[0])).toMatch(/^https:\/\/5sec\.mn\/verify\?token=/);
    const cookies = sessionOf(reg);

    await app.inject({ method: "POST", url: "/api/wallet/demo-topup", cookies, payload: { amount: 20000 } });
    const enter = await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies });
    expect(enter.statusCode).toBe(403);
    expect(enter.json().error).toBe("email_unverified");
    const out = await app.inject({
      method: "POST",
      url: "/api/wallet/withdraw",
      cookies,
      payload: { amount: 10000, bank: "Хаан банк", account: "5012345678", holder: "Хасар" },
    });
    expect(out.json().error).toBe("email_unverified");

    const v = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: tokenIn(sent[0]) } });
    expect(v.json().user.emailVerified).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/competitions/demo-1/enter", cookies })).statusCode).toBe(200);

    // A link works once.
    const again = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: tokenIn(sent[0]) } });
    expect(again.json().error).toBe("link_invalid");
    await app.close();
  });

  it("resends a link at most once a minute, and the old link stops working", async () => {
    const { app, sent, tokenIn } = await setup();
    const cookies = sessionOf(await app.inject({ method: "POST", url: "/api/auth/register", payload: PLAYER }));
    expect((await app.inject({ method: "POST", url: "/api/auth/resend-verification" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/resend-verification", cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/resend-verification", cookies })).statusCode).toBe(429);
    expect(sent).toHaveLength(2);
    const old = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: tokenIn(sent[0]) } });
    expect(old.json().error).toBe("link_invalid");
    const fresh = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: tokenIn(sent[1]) } });
    expect(fresh.statusCode).toBe(200);
    await app.close();
  });

  it("does not accept a verification link after 24 hours", async () => {
    let t = new Date("2026-10-06T12:00:00Z");
    const { app, sent, tokenIn } = await setup(() => t);
    await app.inject({ method: "POST", url: "/api/auth/register", payload: PLAYER });
    t = new Date(t.getTime() + 24 * 3600_000 + 1000);
    const r = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: tokenIn(sent[0]) } });
    expect(r.json().error).toBe("link_invalid");
    await app.close();
  });

  it("resets a forgotten password, signs out other devices, and hides who has an account", async () => {
    let t = new Date("2026-10-06T12:00:00Z");
    const { app, sent, linkIn, tokenIn } = await setup(() => t);
    const oldDevice = sessionOf(await app.inject({ method: "POST", url: "/api/auth/register", payload: PLAYER }));

    const unknown = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: "nobody@b.mn" } });
    const known = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: " K@B.mn " } });
    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect(linkIn(sent[1])).toMatch(/\/reset\?token=/);

    const mismatch = await app.inject({
      method: "POST",
      url: "/api/auth/reset",
      payload: { token: tokenIn(sent[1]), password: "newpassword", passwordConfirm: "other" },
    });
    expect(mismatch.json().error).toBe("password_mismatch");

    const r = await app.inject({
      method: "POST",
      url: "/api/auth/reset",
      payload: { token: tokenIn(sent[1]), password: "newpassword", passwordConfirm: "newpassword" },
    });
    expect(r.statusCode).toBe(200);
    // Opening the reset link proves the email, too.
    expect(r.json().user.emailVerified).toBe(true);
    expect((await app.inject({ url: "/api/me", cookies: oldDevice })).json().user).toBeNull();
    expect((await app.inject({ url: "/api/me", cookies: sessionOf(r) })).json().user.nickname).toBe("Хасар");

    const oldPw = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: PLAYER.email, password: PLAYER.password } });
    expect(oldPw.statusCode).toBe(400);
    const newPw = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: PLAYER.email, password: "newpassword" } });
    expect(newPw.statusCode).toBe(200);

    // Reset links last an hour.
    await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: PLAYER.email } });
    t = new Date(t.getTime() + 3600_000 + 1000);
    const late = await app.inject({
      method: "POST",
      url: "/api/auth/reset",
      payload: { token: tokenIn(sent[2]), password: "another123" },
    });
    expect(late.json().error).toBe("link_invalid");
    await app.close();
  });
});
