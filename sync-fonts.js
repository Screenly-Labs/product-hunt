#!/usr/bin/env bun
// Vendor this app's webfonts into ./assets/static/fonts. The files, versions,
// and copy logic all live in @screenly-labs/signage-kit — this just names the
// families "The Launch" uses: Bricolage Grotesque (display voice — product
// names + the monogram letter), Hanken Grotesk (taglines and body), and Space
// Mono (the "maker/terminal" utility voice — kicker, maker, date, QR caption).
import { syncFonts } from '@screenly-labs/signage-kit/sync-fonts'

export const run = () => syncFonts(['bricolage-grotesque', 'hanken-grotesk', 'space-mono'])

// Allow running standalone: `bun run sync-fonts.js`
if (import.meta.main) {
  await run()
}
