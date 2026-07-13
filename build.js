#!/usr/bin/env bun
/* global Bun */
// Builds the static site into ./dist for GitHub Pages. Like the sibling
// on-this-day / capital-quiz apps this is a plain static bundle — no server.
//
// The twist: Product Hunt's Atom feed sends no CORS header, so the BROWSER can't
// fetch it (that's why the rss-reader sibling is a Worker). Here we fetch and
// parse the feed HERE, at build time (no CORS on the server), and bake the top
// featured products into dist/static/data/products.json — which the page then
// reads same-origin at runtime. A scheduled deploy re-runs this to refresh.
//
// Steps:
//   1. fetch + parse the feed → the featured products (fallback: committed data)
//   2. (--data-only stops here, writing the committed fallback file)
//   3. vendor fonts, assemble dist/, compile Tailwind, bundle the TS
//   4. seed index.html with the first product + rotation ticks (never blank)
//   5. write products.json, stamp asset ?v= hash, write CNAME

import { rm, mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { bundleJs, injectGate, processCss } from '@screenly-labs/signage-kit/build'
import { run as syncFonts } from './sync-fonts.js'
import { initial, parseFeed, tileColor } from './assets/static/js/products.ts'

const DIST = 'dist'
const DOMAIN = 'product-hunt.srly.io'

const FEED_URL = 'https://www.producthunt.com/feed?category=undefined'
const COMMITTED_DATA = 'assets/static/data/products.json'
const MAX_PRODUCTS = 10
const FEED_TIMEOUT_MS = 15000
const dataOnly = process.argv.includes('--data-only')

// Fetch + parse the feed into { generatedAt, products }, or null on any failure
// (network, timeout, empty parse) so the caller can fall back to committed data.
const fetchProducts = async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'screenly-product-hunt-app/0.1 (+https://product-hunt.srly.io)' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const products = parseFeed(await res.text(), MAX_PRODUCTS)
    if (products.length === 0) throw new Error('feed parsed to zero products')
    console.log(`✓ Feed: ${products.length} featured products`)
    return { generatedAt: new Date().toISOString(), products }
  } catch (error) {
    console.warn(`⚠ Feed fetch failed (${error.message}); using committed fallback`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const readCommitted = async () => JSON.parse(await readFile(COMMITTED_DATA, 'utf8'))

// --data-only: refresh the committed fallback file (used by `bun run sync-data`
// and the scheduled data refresh), then stop — no dist build.
if (dataOnly) {
  const data = await fetchProducts()
  if (!data) {
    console.error('✗ Could not fetch feed; committed data left unchanged')
    process.exit(1)
  }
  await writeFile(COMMITTED_DATA, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`✓ Wrote ${COMMITTED_DATA} (${data.products.length} products)`)
  process.exit(0)
}

// 1–2. Resolve the data: fresh feed if we can reach it, else committed fallback.
const data = (await fetchProducts()) ?? (await readCommitted())

// 3. Vendor fonts, then assemble a fresh dist/ (sources are never mutated).
await syncFonts()
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/static`, { recursive: true })
await cp('assets/static/fonts', `${DIST}/static/fonts`, { recursive: true })
await cp('assets/static/images', `${DIST}/static/images`, { recursive: true })
await writeFile(`${DIST}/index.html`, injectGate(await readFile('index.html', 'utf8')))
await cp('.well-known', `${DIST}/.well-known`, { recursive: true })

// Create the output subdirs up front so Tailwind/esbuild never race an absent dir.
await mkdir(`${DIST}/static/styles`, { recursive: true })
await mkdir(`${DIST}/static/js`, { recursive: true })

// Serve the freshly-resolved data (may be newer than the committed copy).
await mkdir(`${DIST}/static/data`, { recursive: true })
await writeFile(`${DIST}/static/data/products.json`, `${JSON.stringify(data)}\n`)
console.log(`✓ Data: ${DIST}/static/data/products.json`)

// Tailwind -> the kit's CSS pipeline (flatten @layer, down-level to the floor).
const cssOut = `${DIST}/static/styles/main.css`
const tailwind = Bun.spawn(
  [
    'node_modules/.bin/tailwindcss',
    '--input',
    'assets/static/styles/tailwind.css',
    '--output',
    cssOut
  ],
  { stdout: 'inherit', stderr: 'inherit' }
)
if ((await tailwind.exited) !== 0) {
  console.error('✗ Tailwind build failed')
  process.exit(1)
}
await writeFile(cssOut, await processCss(await readFile(cssOut, 'utf8'), { flattenLayers: true, filename: cssOut }))
console.log(`✓ CSS: ${cssOut}`)

// Client TS -> the kit's bundler (self-contained IIFE at the floor's syntax level).
await bundleJs('assets/static/js/main.ts', `${DIST}/static/js/main.js`)
console.log(`✓ JS: ${DIST}/static/js/main.js`)

// 4. Seed index.html with the first product + one rotation tick per product, so
// the screen shows real content before main.js runs.
const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const first = data.products[0]
const today = new Date(data.generatedAt ?? Date.now()).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})
const ticks = data.products
  .map((_, i) => `<span class="tick" data-seen="false" data-active="${i === 0}"></span>`)
  .join('')

let html = await readFile(`${DIST}/index.html`, 'utf8')
html = html
  .replaceAll('__TODAY__', escapeHtml(today))
  .replaceAll('__TICKS__', ticks)
  .replaceAll('__FIRST_TILE__', tileColor(first.name))
  .replaceAll('__FIRST_INITIAL__', escapeHtml(initial(first.name)))
  .replaceAll('__FIRST_NAME__', escapeHtml(first.name))
  .replaceAll('__FIRST_TAGLINE__', escapeHtml(first.tagline))
  .replaceAll('__FIRST_MAKER__', first.maker ? `by ${escapeHtml(first.maker)}` : '')

// 5. Cache-busting: hash every asset whose URL carries the ?v= token (JS, CSS,
// logo, fonts) so the token changes exactly when a shipped asset changes, then
// stamp it into the page. (The data file is fetched no-cache, so it's excluded.)
const fonts = (await readdir(`${DIST}/static/fonts`))
  .sort()
  .map((file) => `${DIST}/static/fonts/${file}`)
const fingerprintPaths = [
  `${DIST}/static/js/main.js`,
  `${DIST}/static/styles/main.css`,
  `${DIST}/static/images/screenly-logo.svg`,
  ...fonts
]
const fingerprint = await Promise.all(fingerprintPaths.map((path) => readFile(path)))
const hasher = new Bun.CryptoHasher('sha256')
for (const buf of fingerprint) hasher.update(buf)
const version = hasher.digest('hex').slice(0, 10)

html = html.replaceAll('__ASSET_VERSION__', version)
await writeFile(`${DIST}/index.html`, html)
console.log(`✓ Stamped asset version ${version}`)

// 6. Custom domain for GitHub Pages.
await writeFile(`${DIST}/CNAME`, `${DOMAIN}\n`)
console.log(`✓ CNAME: ${DOMAIN}`)

console.log('Build complete → dist/')
