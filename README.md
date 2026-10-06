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
- Paid entry: the fee comes out of the wallet, then the player has 15 minutes to start.
  One open entry per player at a time; an entry not started in time expires (fee kept).
- Paid run (/play): 100 problems after a 10 s countdown. The run keeps going on the server
  if the browser disconnects; rejoining picks up the current problem with the time left
  and the running totals. The result shows the player's real rank.
- Wallet page: balance, transactions, and test top-ups in demo mode (no payment provider yet).
- Competition page (/competition): prize, fee, times, attempts left, rules, totals, the
  player's own place and the gap to the next one up, and the current leaders table.
- Past competitions page (/competitions): every closed competition with its prize and
  winner; each opens its own competition page (/competition?id=…) with the final results.
- Admin page (/admin): dashboard (current competition, attempts sold, fees, sign-ups),
  create / edit / delete competitions with a prize picture upload (PNG, JPG or WebP up to
  2 MB, checked by its first bytes), and marking a winner's prize as handed over (a cash
  prize goes into their wallet). Once anyone has paid, the fee, attempt count and opening
  time are locked. Admins are named by email in `ADMIN_EMAILS`; with `DEMO_DATA=1` the
  sample admin is admin@demo.mn / admin12345. Uploads go to `UPLOAD_DIR` (default ./uploads).
- Profile page: account details, wallet balance, competitions played with best score and
  rank. Sign in from the header on every page.
- Accounts: email + password, nickname, birth date (18+), terms acceptance; session in an
  httpOnly cookie (only its SHA-256 is stored).
- Storage: PostgreSQL via `DATABASE_URL`. Tables are created on start-up. The rules run in
  memory and every change is written to the database before the response goes out, so a
  restart or redeploy loses nothing. One server process per database. A paid run that was
  under way when the server stopped cannot be finished; its fee goes back to the wallet
  and the attempt slot is freed. Without `DATABASE_URL` everything is kept in memory
  (development only; the server refuses to start that way in production).

- Withdrawals: from the wallet page a player asks to send money (at least 10 000₮) to a
  bank account; the money leaves the wallet at once. One open request at a time. On the
  admin page («Мөнгө татах») an admin sends it by bank transfer and marks it paid, or
  rejects it with a reason and the money goes back to the wallet.

Not built yet: real payment (QPay), admin user management and
withdrawal approval. Sample competition
data loads when `DEMO_DATA=1` (on by default outside production).

## Layout

```
server/   Fastify + WebSocket game server (TypeScript)
  src/problems.ts   problem templates per level
  src/scoring.ts    scoring formula, answer parsing
  src/session.ts    one player's run: timer, answers, latency credit
  src/competition.ts  competition status, leaderboard order
  src/auth.ts       accounts, age/terms rules, sessions
  src/service.ts    wallet ledger, paid entries, standings (also used by the preview)
  src/db.ts         PostgreSQL tables, start-up load, ordered write-through
  src/app.ts        HTTP API, /ws/practice and /ws/attempt/:entryId
web/      Next.js front end
  app/page.tsx            home page
  app/CompetitionBoard.tsx  competition card on the home page
  app/AuthDialog.tsx      login / register window
  app/SiteHeader.tsx      logo and sign-in / profile link
  app/EnterDialog.tsx     pay the entry fee from the wallet
  app/profile/page.tsx    player profile
  app/wallet/page.tsx     wallet balance and transactions
  app/play/page.tsx       paid 100-problem run
  app/competition/page.tsx  competition details, rules and leaders (?id= for a past one)
  app/competitions/page.tsx past competitions and their winners
  app/admin/page.tsx        admin: dashboard, competitions, prizes
  app/practice/page.tsx   practice game
  app/game/               game screen, socket hook and results shared by practice and play
```

## Run locally

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/mathcomp   # optional in development
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
TEST_DATABASE_URL=postgres://…/mathcomp_test npm test   # also the PostgreSQL tests (empties that database)
npm run typecheck
npm run build
```
