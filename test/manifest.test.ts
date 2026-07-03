import { describe, expect, test } from 'bun:test'
import manifest from '../.well-known/signage-app.json'

// Validates the signage-app manifest shipped at /.well-known/signage-app.json
// against the invariants in the sibling app-store repo's schema + docs
// (static/schemas/signage-app-manifest.schema.json, docs/app-manifest.md) — the
// authoritative schema is draft 2020-12 and isn't bundled here, so we encode its
// rules directly. This app takes no settings (no `settings` block, no launch
// `template`), but it DOES pace itself: it steps through the featured products on
// a loop and reloads its data, so it declares a `playback` block (the "stepped"
// case the docs call out for the RSS reader).

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

  test('declares stepped, looping playback within the schema bounds', () => {
    const playback = manifest.playback as Record<string, unknown>
    expect(playback).toBeDefined()
    // Only the four schema-permitted keys (playback has additionalProperties: false).
    expect(Object.keys(playback).sort()).toEqual(
      ['loops', 'pacing', 'refreshIntervalS', 'stepSeconds'].sort()
    )
    expect(playback.pacing).toBe('stepped')
    expect(playback.loops).toBe(true)
    // Positive integers; stepSeconds mirrors ROTATE_MS and refreshIntervalS
    // mirrors REFRESH_MS in main.ts — keep them in sync when those change.
    expect(Number.isInteger(playback.stepSeconds)).toBe(true)
    expect(playback.stepSeconds as number).toBeGreaterThan(0)
    expect(Number.isInteger(playback.refreshIntervalS)).toBe(true)
    expect(playback.refreshIntervalS as number).toBeGreaterThanOrEqual(0)
    expect(playback.refreshIntervalS as number).toBeLessThanOrEqual(86400)
  })
})
