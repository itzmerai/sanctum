import { describe, expect, it } from 'vitest'

import {
  DOWNLOAD_URL,
  latestRelease,
  normaliseVersion,
  parseChecksum,
  type Fetchers,
} from './release'

const FALLBACK = '0.1.0'

function fetchers(over: Partial<Fetchers> = {}): Fetchers {
  return {
    json: async () => {
      throw new Error('unexpected json call')
    },
    text: async () => {
      throw new Error('unexpected text call')
    },
    ...over,
  }
}

const RELEASE = {
  tag_name: 'v0.2.0',
  published_at: '2026-09-01T10:00:00Z',
  assets: [
    {
      name: 'Sanctum_0.2.0_x64-setup.exe',
      browser_download_url: 'https://example.invalid/installer',
    },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.invalid/sums' },
  ],
}

const HASH = 'a'.repeat(64)

describe('parseChecksum', () => {
  it('reads the hash from sha256sum output', () => {
    expect(parseChecksum(`${HASH}  Sanctum_0.2.0_x64-setup.exe`)).toBe(HASH)
  })

  it('lowercases an uppercase hash', () => {
    expect(parseChecksum(`${'A'.repeat(64)}  x.exe`)).toBe(HASH)
  })

  it('returns null when there is no hash', () => {
    expect(parseChecksum('nothing here')).toBeNull()
  })
})

describe('DOWNLOAD_URL', () => {
  it('points at a version-free asset name', () => {
    // The permalink resolves by filename, so a versioned name would 404 on
    // every release after the one it was written for.
    expect(DOWNLOAD_URL).toContain('releases/latest/download/')
    expect(DOWNLOAD_URL).not.toMatch(/d+.d+.d+/)
  })
})

describe('normaliseVersion', () => {
  it('strips a leading v', () => {
    expect(normaliseVersion('v0.2.0')).toBe('0.2.0')
  })

  it('leaves a bare version alone', () => {
    expect(normaliseVersion('0.2.0')).toBe('0.2.0')
  })
})

describe('latestRelease', () => {
  it('returns version, date and hash from a full release', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => RELEASE,
        text: async () => `${HASH}  Sanctum_0.2.0_x64-setup.exe`,
      }),
      FALLBACK,
    )

    expect(info).toEqual({
      version: '0.2.0',
      publishedAt: '2026-09-01T10:00:00Z',
      sha256: HASH,
      live: true,
    })
  })

  it('falls back when the network fails, rather than throwing', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => {
          throw new Error('offline')
        },
      }),
      FALLBACK,
    )

    // A build must not fail because GitHub was briefly unreachable.
    expect(info).toEqual({ version: FALLBACK, publishedAt: null, sha256: null, live: false })
  })

  it('falls back when the release has no installer asset', async () => {
    const info = await latestRelease(
      fetchers({ json: async () => ({ tag_name: 'v0.3.0', assets: [] }) }),
      FALLBACK,
    )

    // Advertising a version nobody can download is worse than showing 0.1.0.
    expect(info.live).toBe(false)
    expect(info.version).toBe(FALLBACK)
  })

  it('keeps the release but omits the hash when the checksum asset is missing', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => ({ ...RELEASE, assets: [RELEASE.assets[0]] }),
      }),
      FALLBACK,
    )

    expect(info.version).toBe('0.2.0')
    expect(info.sha256).toBeNull()
    expect(info.live).toBe(true)
  })

  it('keeps the release when the checksum download fails', async () => {
    const info = await latestRelease(
      fetchers({
        json: async () => RELEASE,
        text: async () => {
          throw new Error('404')
        },
      }),
      FALLBACK,
    )

    expect(info.version).toBe('0.2.0')
    expect(info.sha256).toBeNull()
  })

  it('falls back on a malformed response', async () => {
    const info = await latestRelease(fetchers({ json: async () => ({ nope: true }) }), FALLBACK)
    expect(info.live).toBe(false)
  })
})
