// Pure, framework-free helpers for the Featured on Product Hunt app. Kept apart
// from main.ts so they can be unit-tested with `bun:test`; main.ts is the
// (no-exports) browser entry that wires these into the DOM, and build.js reuses
// them server-side to bake the data file.
//
// Data source: Product Hunt's public Atom feed
//   https://www.producthunt.com/feed?category=undefined
// The feed has NO vote/score/rank field and its entry order is shuffled on every
// request, so it cannot yield a ranked "Top 10" — only the set of products
// currently featured. `parseFeed` turns its untrusted XML into our flat Product
// and imposes a STABLE order (newest launch first) so the board doesn't visibly
// reshuffle between rebuilds. See CLAUDE.md → "Why this isn't a leaderboard".

// One featured product. `tagline` is Product Hunt's one-line pitch (the first
// paragraph of the entry body); `maker` is the submitter; `url` is the Product
// Hunt page (used for the on-screen QR and credit). `publishedAt` is the launch
// time in epoch ms, or null when absent — used only to order the board.
export type Product = {
  id: string
  name: string
  tagline: string
  maker: string
  url: string
  publishedAt: number | null
}

// Tile colours for the generated monogram "logo" — the feed ships no images, so
// each product gets a solid tile keyed off its name. Warm-led and tuned to sit
// beside Product Hunt orange (the first entry) rather than clash with it.
export const TILE_COLORS = [
  '#DA552F',
  '#E8833B',
  '#D8A23A',
  '#5B8C3E',
  '#2FA98A',
  '#3E7CB1',
  '#7B5EA7',
  '#C2417B'
] as const

// A tiny named-entity set plus numeric refs; anything unlisted is left as-is
// rather than guessed at. The feed double-escapes its body (`&lt;p&gt;`), so
// callers decode once to reveal the markup, then once more on the leaf text.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…'
}

export const decodeEntities = (input: string): string => {
  if (!input.includes('&')) return input
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X'
      const cp = isHex ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      if (!Number.isFinite(cp)) return match
      try {
        return String.fromCodePoint(cp)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

// Strip tags, decode entities, collapse whitespace → display text.
export const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

// The feed body is a run of <p> blocks: the first is the product's tagline, a
// later one is the "Discussion | Link" navigation. Decode the escaped markup,
// then return the first paragraph that is real prose (has text, carries no <a>).
export const extractTagline = (content: string): string => {
  const html = decodeEntities(content)
  const paragraphs = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)
  const blocks = paragraphs ?? [html]
  for (const block of blocks) {
    if (/<a\b/i.test(block)) continue // the Discussion | Link paragraph
    const text = stripTags(block)
    if (text) return text
  }
  return ''
}

// Deterministic 32-bit string hash (FNV-1a), so the same product always gets the
// same monogram tile in the browser and at build time.
export const hashString = (input: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export const tileColor = (name: string): string =>
  TILE_COLORS[hashString(name) % TILE_COLORS.length]

// First letter/digit of the name for the monogram, uppercased. Skips leading
// emoji/punctuation (some launches lead with an emoji); falls back to '#'.
export const initial = (name: string): string => {
  const match = name.match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : '#'
}

// Runtime type guard — both the baked JSON and the parsed feed are untrusted.
export const isProduct = (value: unknown): value is Product => {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.tagline === 'string' &&
    typeof p.maker === 'string' &&
    typeof p.url === 'string' &&
    p.url.length > 0 &&
    (p.publishedAt === null || typeof p.publishedAt === 'number')
  )
}

const firstMatch = (block: string, re: RegExp): string => {
  const m = re.exec(block)
  return m ? m[1] : ''
}

// Maps the feed's untrusted Atom XML to our flat products, imposing a stable
// newest-first order and capping at `max`. Skips entries missing a name or a
// linkable Product Hunt URL. Dependency-free (no DOMParser) so it runs in the
// browser build, in Bun at build time, and under bun:test alike.
export const parseFeed = (xml: string, max = 10): Product[] => {
  const entries = xml.match(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi) ?? []
  const products: Product[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const name = stripTags(firstMatch(entry, /<title\b[^>]*>([\s\S]*?)<\/title>/i))
    // rel="alternate" is the product page; the feed lists exactly one <link>.
    const url = decodeEntities(
      firstMatch(entry, /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)
    ).trim()
    if (!name || !url) continue

    const idText = firstMatch(entry, /<id\b[^>]*>([\s\S]*?)<\/id>/i)
    const id = /Post\/(\d+)/.exec(idText)?.[1] ?? url
    if (seen.has(id)) continue
    seen.add(id)

    const tagline = extractTagline(firstMatch(entry, /<content\b[^>]*>([\s\S]*?)<\/content>/i))
    const maker = stripTags(
      firstMatch(entry, /<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)
    )
    const publishedText = firstMatch(entry, /<published\b[^>]*>([\s\S]*?)<\/published>/i).trim()
    const parsed = publishedText ? Date.parse(publishedText) : Number.NaN
    const publishedAt = Number.isNaN(parsed) ? null : parsed

    products.push({ id, name, tagline, maker, url, publishedAt })
  }

  // Stable sort, newest launch first; undated entries sink to the end but keep
  // their feed order. This is display order, NOT a ranking — the feed has none.
  products.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return products.slice(0, max)
}
