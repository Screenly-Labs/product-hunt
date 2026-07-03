import { describe, expect, test } from 'bun:test'
import manifest from '../.well-known/signage-app.json'

// Validates the signage-app manifest shipped at /.well-known/signage-app.json.
// The authoritative JSON Schema lives in the sibling app-store repo, so it isn't
// available to CI here; instead we encode the same invariants the store's index
// build enforces (see docs/app-manifest.md). This app takes no settings and runs
// its own internal rotation from a single URL, so — like the On This Day app —
// it carries neither a `settings` block nor a launch `template`.

const BASE_URL = 'https://product-hunt.srly.io/'
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const URL_FIELDS = ['icon', 'homepage', 'source', 'support'] as const

describe('signage-app manifest', () => {
  test('declares the manifest format version', () => {
    expect(manifest.manifestVersion).toBe('1')
  })

  test('has the required identity fields', () => {
    expect(manifest.id).toMatch(ID_PATTERN)
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.description.length).toBeGreaterThan(0)
  })

  test('tags are unique', () => {
    const tags = manifest.tags ?? []
    expect(new Set(tags).size).toBe(tags.length)
  })

  test('URL fields are absolute https URLs', () => {
    for (const field of URL_FIELDS) {
      const value = (manifest as Record<string, unknown>)[field]
      if (value === undefined) continue
      expect(typeof value).toBe('string')
      expect(new URL(value as string).protocol).toBe('https:')
    }
  })

  test('launches from the production base URL', () => {
    expect(manifest.launch.baseUrl).toBe(BASE_URL)
    expect(new URL(manifest.launch.baseUrl).protocol).toBe('https:')
  })

  test('takes no settings, so it carries no launch template', () => {
    expect('settings' in manifest).toBe(false)
    expect('template' in manifest.launch).toBe(false)
  })
})
