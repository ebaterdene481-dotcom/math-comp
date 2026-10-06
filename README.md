# 5 секунд — математикийн тэмцээн

Paid, timed online math competition: 100 problems, 5 seconds each. The server owns the clock,
answer checking and scoring; the browser only shows problems and sends what the player typed.

Product spec (Mongolian): https://claude.ai/code/artifact/ff93ef08-c8c2-4d56-9c1e-13ebb84fdec5

## What works now

- Free 20-problem practice mode (4 per level), no account needed.
- Server-side 5 s timer, wrong answers clear but the clock keeps running, unlimited retries
  rate-limited to 5 answers per second.
- Scoring: 100 points at ≤ 0.5 s, 0 at 5 s, linear in between, kept as integer hundredths.
- Network delay credit: half the median ping, capped at 0.3 s, fixed when each problem is sent.
- Same template sequence for everyone, random numbers per run.
- Problems are drawn on a canvas, not as page text.

- Home page competition card: status (live / upcoming / finished), how many of the 100
  attempts are used, top 3 players, and an Оролцох button that opens login/register and,
  once signed in, shows the entry fee.
- Profile page: account details, wallet balance (top-up and withdraw arrive with payments),
  competitions played with best score and rank. Sign in from the header on every page.
- Accounts: email + password, nickname, birth date (18+), terms acceptance; session in an
  httpOnly cookie. In memory for now.

Not built yet: database, payment, wallet, paid competition runs, admin. Sample competition
data loads when `DEMO_DATA=1` (on by default outside production).

## Layout

```
server/   Fastify + WebSocket game server (TypeScript)
  src/problems.ts   problem templates per level
  src/scoring.ts    scoring formula, answer parsing
  src/session.ts    one player's run: timer, answers, latency credit
  src/competition.ts  competition status, leaderboard order
  src/auth.ts       accounts, age/terms rules, sessions
  src/app.ts        HTTP API + /ws/practice
web/      Next.js front end
  app/page.tsx            home page
  app/CompetitionBoard.tsx  competition card on the home page
  app/AuthDialog.tsx      login / register window
  app/SiteHeader.tsx      logo and sign-in / profile link
  app/profile/page.tsx    player profile
  app/practice/page.tsx   practice game
```

## Run locally

```bash
npm install
npm run dev:server        # game server on :4000
npm run dev:web           # web on :3000
```

Set `NEXT_PUBLIC_GAME_WS_URL` and `NEXT_PUBLIC_API_URL` (see `web/.env.example`) if the
game server is not on localhost:4000.

## Preview without Node

`npm run preview -w web` builds `web/preview/dist/preview.html`: one self-contained page with
the real pages and the game server running inside the browser (sample competition data,
accounts kept in localStorage). Only for showing the site; not used in production.

## Checks

```bash
npm test          # server unit + websocket tests
npm run typecheck
npm run build
```
