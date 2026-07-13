// Browser entry. Bun bundles this (inlining ./products and the fallback JSON)
// into a self-contained classic script with no exports, so it loads from a plain
// <script>. Keep it export-free and free of top-level await.
//
// Flow: fetch the baked, SAME-ORIGIN /static/data/products.json (no CORS — it's
// our own file; the Product Hunt feed itself is CORS-blocked and is fetched at
// build time instead) → rotate through the featured products one at a time,
// drawing each product's monogram, detail and a QR to open it on Product Hunt.
// If that fetch fails (offline screen, mid-deploy), fall back to the copy bundled
// into this script so the board is never blank. This is a rotation, not a
// ranking — the feed has no votes (see CLAUDE.md).

// Side-effect import: installs the replaceChildren shim for the older-browser
// degraded mode. Must stay first so the shim is in place before any render.
import './polyfills'
import qrcode from 'qrcode-generator'
import { type Product, initial, isProduct, tileColor } from './products'
// Inlined into the bundle at build time, so the offline fallback needs no fetch.
import fallbackData from '../data/products.json'

const DATA_URL = '/static/data/products.json'
const FETCH_TIMEOUT_MS = 8000
const ROTATE_MS = 7000
// Re-pull the baked file periodically so a long-lived screen picks up the daily
// rebuild without a full page reload.
const REFRESH_MS = 30 * 60 * 1000

const el = (id: string): HTMLElement | null => document.getElementById(id)

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

let products: Product[] = []
let index = 0
let rotateTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const setText = (id: string, value: string): void => {
  const node = el(id)
  if (node) node.textContent = value
}

const drawQr = (url: string): void => {
  const holder = el('qr')
  const scan = el('scan')
  if (!holder || !scan) return
  try {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    holder.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 })
    scan.hidden = false
  } catch {
    holder.replaceChildren()
    scan.hidden = true
  }
}

// Rebuild the rotation ticks (one upvote triangle per product), marking the
// current one active and the ones already shown as "seen".
const renderTicks = (): void => {
  const ticks = el('ticks')
  if (!ticks) return
  const marks = Array.from({ length: products.length }, (_, i) => {
    const seen = i < index
    const active = i === index
    return `<span class="tick" data-seen="${seen}" data-active="${active}"></span>`
  })
  ticks.innerHTML = marks.join('')
}

// Restart the CSS entrance + rail-fill animations for the new slide. Removing
// then re-adding `is-in` only restarts an animation if the browser actually sees
// the removed state, so force a synchronous reflow in between. (A rAF toggle gets
// coalesced into one style recalc — the animation never restarts and the rail
// stays stuck full from the second slide onward.)
const retriggerMotion = (): void => {
  if (prefersReducedMotion()) return
  for (const node of [el('spotlight'), el('rail')]) {
    if (!node) continue
    node.classList.remove('is-in')
    void node.getBoundingClientRect()
    node.classList.add('is-in')
  }
}

const render = (i: number): void => {
  const product = products[i]
  if (!product) return

  const logo = el('logo')
  if (logo) {
    logo.textContent = initial(product.name)
    logo.style.setProperty('--tile', tileColor(product.name))
  }
  setText('name', product.name)
  setText('tagline', product.tagline)
  setText('maker', product.maker ? `by ${product.maker}` : '')
  drawQr(product.url)
  renderTicks()

  document.querySelector<HTMLElement>('.stage')?.setAttribute('data-state', 'ready')
  retriggerMotion()
}

const scheduleRotate = (): void => {
  clearTimeout(rotateTimer)
  if (products.length < 2) return
  rotateTimer = setTimeout(() => {
    index = (index + 1) % products.length
    render(index)
    scheduleRotate()
  }, ROTATE_MS)
}

const formatToday = (iso: string | undefined): string => {
  const time = iso ? Date.parse(iso) : Number.NaN
  const date = Number.isNaN(time) ? new Date() : new Date(time)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Both the baked file and the bundled fallback are untrusted `unknown` until
// validated here.
const readProducts = (data: unknown): { products: Product[]; generatedAt?: string } => {
  const record = (data ?? {}) as Record<string, unknown>
  const list = Array.isArray(record.products) ? record.products.filter(isProduct) : []
  const generatedAt = typeof record.generatedAt === 'string' ? record.generatedAt : undefined
  return { products: list, generatedAt }
}

const apply = (data: unknown): void => {
  const { products: list, generatedAt } = readProducts(data)
  if (list.length === 0) return
  products = list
  if (index >= products.length) index = 0
  setText('today', formatToday(generatedAt))
  render(index)
  scheduleRotate()
}

const fetchData = async (): Promise<void> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    apply(await res.json())
  } catch (error) {
    // Same-origin so this rarely fails, but if it does (mid-deploy, offline) and
    // nothing is on screen yet, fall back to the bundled copy.
    console.error('Product Hunt: live data unavailable, using bundled fallback —', error)
    if (products.length === 0) apply(fallbackData)
  } finally {
    clearTimeout(timer)
    if (products.length === 0) {
      document.querySelector<HTMLElement>('.stage')?.setAttribute('data-state', 'error')
    }
  }
}

const init = (): void => {
  // Drive the rail-fill duration from the rotation interval so the two stay in
  // sync if ROTATE_MS changes (the CSS only has a static fallback).
  el('rail')?.style.setProperty('--rotate-ms', `${ROTATE_MS}ms`)
  // Seed immediately from the bundled copy so rotation + QR start without waiting
  // on the network; the fetch then refreshes with the latest baked file.
  apply(fallbackData)
  fetchData()
  refreshTimer = setInterval(fetchData, REFRESH_MS)
  // Keep TS honest about the unused handle without changing runtime behaviour.
  void refreshTimer
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
