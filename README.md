# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mannn7/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mannn7/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01): it ranks protocols that record no token by the implied value of the token they may one day issue, and gives each one a concrete farm plan. The value follows from the snapshot's own figures — TVL, seven-day growth, and how long the protocol has run with no token — never from a list of names. Wrapped, staked and bridged products of tokens that already trade are left out, and the dashboard renders with no network at all.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Then open `out/dashboard/index.html` (it reads `out/data.js` beside it). In the grader the program reads the sealed snapshot at `/input/snapshot.json` and writes the board, the dashboard data, the dashboard, the screenshots and the dossier to `/output`.

## The model (radar-2)

```
implied = round(TVL × 0.30 × growth × maturity)
growth   = 1 + 0.6 × clamp(change_7d, -50, +100) / 100
maturity = 0.5 + 0.5 × min(age_days, 730) / 730
```

Age is the days from `listed_at` to the snapshot's `as_of` date (180 days when unlisted). The board covers all 40 watchlist slugs plus every rankable pre-token protocol below the $50,000,000 floor — 178 rows. Protocols whose token already trades are set aside in a separate Live view at their market cap.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, scores the board, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
- `lib/model.ts` — the value model, the board builder and the farm-plan generator
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js` (sortable, filterable, hash-routed detail views)
- `screenshots/` — three screenshots of the running dashboard on the computed board
- `vendor/makefun-board.ts` — make.fun's dossier library, unchanged
