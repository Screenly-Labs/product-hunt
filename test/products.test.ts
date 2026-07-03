import { describe, expect, test } from 'bun:test'
import {
  TILE_COLORS,
  decodeEntities,
  extractTagline,
  hashString,
  initial,
  isProduct,
  parseFeed,
  stripTags,
  tileColor
} from '../assets/static/js/products'

const fixture = await Bun.file(new URL('./fixtures/producthunt.atom', import.meta.url)).text()

describe('decodeEntities', () => {
  test('decodes named and numeric entities, once', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b')
    expect(decodeEntities('&lt;p&gt;')).toBe('<p>')
    expect(decodeEntities('&#39;quote&#39;')).toBe("'quote'")
    expect(decodeEntities('&#x2014;')).toBe('—')
  })
  test('leaves unknown entities and plain text untouched', () => {
    expect(decodeEntities('100% &weird; text')).toBe('100% &weird; text')
    expect(decodeEntities('no entities here')).toBe('no entities here')
  })
})

describe('stripTags', () => {
  test('removes tags, decodes entities, collapses whitespace', () => {
    expect(stripTags('<p>  hello   <b>world</b>  </p>')).toBe('hello world')
    expect(stripTags('Ben &amp; Jerry')).toBe('Ben & Jerry')
  })
})

describe('extractTagline', () => {
  test('returns the first prose paragraph, skipping the Discussion | Link one', () => {
    const content =
      '&lt;p&gt; A neat tool &lt;/p&gt; &lt;p&gt; &lt;a href="x"&gt;Discussion&lt;/a&gt; | &lt;a href="y"&gt;Link&lt;/a&gt; &lt;/p&gt;'
    expect(extractTagline(content)).toBe('A neat tool')
  })
  test('is empty when there is no prose paragraph', () => {
    expect(extractTagline('&lt;p&gt;&lt;a href="y"&gt;Link&lt;/a&gt;&lt;/p&gt;')).toBe('')
  })
})

describe('initial', () => {
  test('takes the first letter or digit, uppercased', () => {
    expect(initial('Glaze by Raycast')).toBe('G')
    expect(initial('nxt')).toBe('N')
    expect(initial('123 Go')).toBe('1')
  })
  test('skips leading emoji/punctuation and falls back to #', () => {
    expect(initial('🚀 Rocket')).toBe('R')
    expect(initial('✨')).toBe('#')
  })
})

describe('tileColor / hashString', () => {
  test('is deterministic and always a palette colour', () => {
    expect(tileColor('Vox')).toBe(tileColor('Vox'))
    expect([...TILE_COLORS] as string[]).toContain(tileColor('Some Random Product'))
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('isProduct', () => {
  test('accepts a well-formed product and rejects malformed ones', () => {
    const ok = { id: '1', name: 'A', tagline: '', maker: '', url: 'https://x', publishedAt: null }
    expect(isProduct(ok)).toBe(true)
    expect(isProduct({ ...ok, url: '' })).toBe(false)
    expect(isProduct({ ...ok, name: '' })).toBe(false)
    expect(isProduct({ ...ok, publishedAt: 'nope' })).toBe(false)
    expect(isProduct(null)).toBe(false)
  })
})

describe('parseFeed', () => {
  const products = parseFeed(fixture, 10)

  test('parses the fixture into the requested number of products', () => {
    expect(products.length).toBe(10)
  })

  test('every product has a name, a Product Hunt URL, and passes the guard', () => {
    for (const p of products) {
      expect(isProduct(p)).toBe(true)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.url).toMatch(/^https:\/\/www\.producthunt\.com\//)
    }
  })

  test('extracts tagline and maker from a known entry', () => {
    const glaze = products.find((p) => p.name === 'Glaze by Raycast')
    expect(glaze?.tagline).toBe('Create your own Mac apps by chatting with AI')
    expect(glaze?.maker).toBe('Chris Messina')
    expect(glaze?.id).toBe('1186480')
  })

  test('orders by launch time, newest first (stable display order, not a ranking)', () => {
    const dated = products.filter((p) => p.publishedAt !== null).map((p) => p.publishedAt as number)
    const sorted = [...dated].sort((a, b) => b - a)
    expect(dated).toEqual(sorted)
  })

  test('dedupes by post id', () => {
    const ids = products.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('respects the max cap', () => {
    expect(parseFeed(fixture, 3).length).toBe(3)
  })

  test('returns an empty array for non-feed input', () => {
    expect(parseFeed('<html>not a feed</html>')).toEqual([])
  })
})
