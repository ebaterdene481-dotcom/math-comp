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

Not built yet: accounts, competitions, wallet, leaderboard data, admin.

## Layout

```
server/   Fastify + WebSocket game server (TypeScript)
  src/problems.ts   problem templates per level
  src/scoring.ts    scoring formula, answer parsing
  src/session.ts    one player's run: timer, answers, latency credit
  src/app.ts        HTTP + /ws/practice
web/      Next.js front end
  app/page.tsx            home page
  app/practice/page.tsx   practice game
```

## Run locally

```bash
npm install
npm run dev:server        # game server on :4000
npm run dev:web           # web on :3000
```

Set `NEXT_PUBLIC_GAME_WS_URL` (see `web/.env.example`) if the game server is not on
`ws://localhost:4000/ws/practice`.

## Checks

```bash
npm test          # server unit + websocket tests
npm run typecheck
npm run build
```
