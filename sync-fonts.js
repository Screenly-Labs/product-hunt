#!/usr/bin/env bun
/* global Bun */
// Copies the self-hosted webfont files out of the Bun-managed @fontsource
// packages into ./assets/static/fonts, where they're shipped to /static/fonts/.
// Bun owns the font versions (package.json); this step vendors the exact files we
// serve ourselves — no CDN at runtime.
//
// Fonts: Bricolage Grotesque (the display voice — product names and the monogram
// letter), Hanken Grotesk (taglines and body), Space Mono (the "maker/terminal"
// utility voice — the kicker, the maker credit, dates and the QR caption).

import { rm } from 'node:fs/promises'

const FONTS = [
  '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2',
  '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
  '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2',
  '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2'
]
const DEST_DIR = 'assets/static/fonts'

export const run = async () => {
  let count = 0

  // Clear the vendored dir first so a renamed/removed font can't linger and get
  // shipped — this dir is gitignored and rebuilt from @fontsource every time.
  await rm(DEST_DIR, { recursive: true, force: true })

  for (const rel of FONTS) {
    const file = rel.split('/').pop()
    const src = Bun.file(`node_modules/${rel}`)

    if (!(await src.exists())) {
      console.error(`✗ Missing ${file} — run \`bun install\` first.`)
      process.exit(1)
    }

    await Bun.write(`${DEST_DIR}/${file}`, src)
    console.log(`✓ Font: ${DEST_DIR}/${file}`)
    count++
  }

  console.log(`Fonts synced — ${count} file(s) vendored from @fontsource.`)
}

// Allow running standalone: `bun run sync-fonts.js`
if (import.meta.main) {
  await run()
}
