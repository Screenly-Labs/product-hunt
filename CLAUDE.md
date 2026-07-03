# CLAUDE.md

Guidance for working in this repo.

## What this is

A **static** full-screen board for digital signage, hosted on **GitHub Pages**,
that rotates through the products **featured on Product Hunt today** — one at a
time, each with a generated monogram, tagline, maker, and a QR to open it.
Sibling to the `on-this-day` / `capital-quiz` apps (same static template); it
borrows its feed-parsing idea from `rss-reader`. Unlike the `rss-reader` /
`weather-app` Cloudflare Workers, there is **no server** — just HTML/CSS/JS.

## Why this is NOT a leaderboard (read before "fixing" the ranking)

The brief was a "Product Hunt Top 10", but the constraint is **feed-only** (no
API, no scraping). We audited the feed hard, and it fundamentally can't rank:

1. **No vote/score/rank field exists in the feed.** Every entry has only title,
   link, a tagline (first `<p>` of `content`), an author, and timestamps.
2. **The feed order is shuffled on every request.** Fetched twice a minute apart,
   both the order and the position-8+ membership change. The front cluster is
   _roughly_ today's featured set, but there's no field marking where it ends
   (feed position 1 can be published weeks before a position-8 filler item), so
   you can't even cut a stable "exactly 10".
3. The real ranked leaderboard (with upvotes) is only on the leaderboard page /
   official GraphQL API. That page is behind a **Cloudflare bot challenge**, so a
   CI `fetch` gets the challenge, not data.

So the app is deliberately honest: **"Featured on Product Hunt", no rank numbers,
no vote counts.** `parseFeed` imposes a stable newest-first order purely so the
board doesn't visibly reshuffle between rebuilds — that is display order, **not**
a ranking. If someone asks for real ranks/votes, the only path is the official
API (a free token as a CI secret); don't try to derive ranking from the feed.

## Data flow (build-time fetch, because the feed has no CORS)

Product Hunt's Atom feed sends **no `Access-Control-Allow-Origin`**, so the
browser can't fetch it (the reason `rss-reader` is a Worker). Instead:

- `build.js` fetches + parses the feed **server-side** at build → bakes
  `dist/static/data/products.json`, and seeds the first product into `index.html`.
- The page reads that JSON **same-origin** at runtime (no CORS), rotates through
  it, and re-pulls every 30 min. Fallbacks: committed data at build, bundled data
  at runtime — so the board is never blank.
- Freshness comes from the **scheduled deploy** (every 3 h) re-running `build.js`.

## Stack & conventions

- **Bun** for everything (package manager, bundler, test runner). Use `bun` /
  `bunx` — never npm/npx.
- **TypeScript**, strict. **All** browser JS is authored as `.ts` and bundled by
  Bun — no hand-written JS in `assets/`.
- **Tailwind CSS v4**, CSS-first: tokens live in `@theme` in
  `assets/static/styles/tailwind.css`; compiled by `@tailwindcss/cli` at build.
- **Biome** for lint/format: single quotes, no semicolons, 2-space, 100 cols.
  CSS is intentionally excluded from Biome (it doesn't parse Tailwind at-rules).

## Commands

```sh
bun install        # deps; vendored fonts come from @fontsource via sync-fonts
bun run dev        # build + serve dist/ locally
bun run build      # assemble dist/ (fetches the live feed; see below)
bun run sync-data  # refresh committed assets/static/data/products.json from the feed
bun test           # bun:test — the feed parser + manifest shape
bun run typecheck  # tsc --noEmit
bun run lint       # biome lint --error-on-warnings
```

## Layout & build

Web root is served from the site root (custom domain), so assets are referenced
absolutely as `/static/...`.

- `assets/static/js/products.ts` — **pure, exported, unit-tested** helpers: the
  `Product` type, `parseFeed` (dependency-free Atom parsing; no DOMParser, so it
  runs in the browser build, in Bun, and under bun:test alike), `extractTagline`,
  `decodeEntities`, `stripTags`, `initial`, `tileColor`/`hashString`, `isProduct`.
- `assets/static/js/main.ts` — the browser **entry**. Fetches the same-origin
  baked JSON, rotates the spotlight, draws each product's monogram + QR
  (`qrcode-generator`), and manages the ticks/rail. Keep it **export-free** and
  free of top-level `await` so Bun bundles it to a self-contained classic script.
- `assets/static/data/products.json` — the committed fallback + test seed;
  refresh with `bun run sync-data`. Shape: `{ generatedAt, products: Product[] }`.
- `build.js` — fetch+parse the feed → bake `products.json` → assemble `dist/`,
  compile Tailwind, bundle the TS, **seed `index.html`** (first product + one
  rotation tick per product, so the screen is never blank pre-JS), stamp a
  sha256 `?v=` cache-bust, write `CNAME`. `--data-only` refreshes the committed
  fallback and stops (used by `sync-data`). Does **not** mutate sources.
- `.well-known/signage-app.json` — the [signage-app manifest](https://github.com/Screenly-Labs/app-store/blob/master/docs/app-manifest.md).
  Takes no settings (so no `settings` block and no launch `template`), but it
  paces itself, so it declares `playback` as **stepped + looping** with
  `stepSeconds` = `ROTATE_MS` and `refreshIntervalS` = `REFRESH_MS` from
  `main.ts`. Keep those in sync. `test/manifest.test.ts` guards the shape against
  the app-store schema's invariants.

## Design — "The Launch"

Each product arrives on its own launch card: a generated **monogram tile** (the
feed ships no logos, so the colour is hashed from the product name and shifts as
the board rotates) that **rises into place** — the one orchestrated motion,
gated behind `prefers-reduced-motion`. Product Hunt's **upvote triangle** is the
repeated structural mark (the kicker glyph and the rotation ticks) — used as
brand iconography, **never beside a number**, since we have no counts. Bricolage
Grotesque is the display voice (names + monogram), Hanken Grotesk the tagline,
Space Mono the "maker/terminal" utility voice (kicker, maker, date, QR caption).
One fluid root font-size (`clamp(vw+vh)`) drives the whole scale and is
orientation-neutral; landscape sets card-beside-detail, portrait stacks.

## Quality bars

- **Honesty:** never present this as ranked or add vote/rank numbers (see above).
- **Accessibility:** semantic landmarks, AA contrast, `lang`, named links,
  zoomable viewport, reduced-motion respected.
- **Resolutions:** must look correct at every entry in the README table, both
  orientations.
- Run `typecheck`, `lint`, and `test` before pushing (CI enforces them).

## Deploy

Push to **`master`** (or the 3-hourly schedule / manual dispatch) →
`.github/workflows/deploy-pages.yml` builds and publishes to Pages. PRs run
`ci.yml` (typecheck + lint + test + build). Action versions are SHA-pinned.
