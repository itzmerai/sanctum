/**
 * Gates on what actually gets served (U4, U5).
 *
 * These assert against `dist/`, not against components, because the claims
 * that matter are about the HTML a crawler or a cautious reader receives -
 * with JavaScript never running. `npm run test` builds first so this cannot
 * pass against a stale directory.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Vitest runs from the package root, and import.meta.url is not a file: URL
// under its transform - so resolve from cwd rather than from this module.
const DIST = join(process.cwd(), 'dist')
const SRC = join(process.cwd(), 'src')

function page(path: string): string {
  return readFileSync(join(DIST, path), 'utf8')
}

function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full, match))
    else if (match.test(entry.name)) out.push(full)
  }
  return out
}

describe('landing page', () => {
  const html = page('index.html')

  it('states the offline claim and the audience without scripting', () => {
    expect(html).toContain('encrypted on your own machine')
    expect(html).toContain('freelance developers')
    expect(html).toContain('no server')
  })

  it('names what the vault holds', () => {
    for (const thing of ['Credentials', 'Env files', 'Notes', 'Tasks', 'Income', 'Calendar']) {
      expect(html).toContain(thing)
    }
  })

  it('carries link-preview metadata in the served HTML', () => {
    // A client-rendered page would ship none of this, and a shared link would
    // preview as an empty card.
    for (const tag of ['og:title', 'og:description', 'og:url', 'twitter:card']) {
      expect(html).toContain(tag)
    }
  })

  it('states every limit at the same weight as the protections', () => {
    for (const limit of ['Unaudited', 'Unsigned', 'Windows only', 'No sync']) {
      expect(html).toContain(limit)
    }
    expect(html).toMatch(/Lose the passphrase and the recovery code/i)
  })

  it('uses no marketing word that implies assurance', () => {
    // Marketing drift, not typos, is the failure here: any of these on a 0.1.0
    // unaudited vault is a claim with consequences.
    for (const word of [/\bcertified\b/i, /\bmilitary\b/i, /\bbank[- ]grade\b/i, /\bunbreakable\b/i, /\bhack-?proof\b/i, /\bfully secure\b/i]) {
      expect(html).not.toMatch(word)
    }
  })

  it('never claims to be audited, only to be unaudited', () => {
    // "audited" is legitimate inside a denial and a lie outside one, so check
    // the context of each occurrence rather than banning the word.
    const claims: string[] = []
    for (const match of html.matchAll(/audited/gi)) {
      const before = html.slice(Math.max(0, (match.index ?? 0) - 60), match.index)
      if (!/\b(not|never|no|un|without|yet to be)\b|un$/i.test(before)) {
        claims.push(html.slice(Math.max(0, (match.index ?? 0) - 60), (match.index ?? 0) + 12))
      }
    }
    expect(claims, `unqualified audit claim: ${claims.join(' | ')}`).toHaveLength(0)
  })
})

describe('download page', () => {
  const html = page('download/index.html')

  it('states the SmartScreen warning and how to proceed', () => {
    expect(html).toMatch(/SmartScreen/)
    expect(html).toContain('More info')
    expect(html).toContain('Run anyway')
  })

  it('does not disguise or minimise the warning', () => {
    expect(html).toMatch(/not a false alarm/i)
  })

  it('states the system requirements', () => {
    expect(html).toMatch(/Windows 10/)
    expect(html).toMatch(/WebView2/)
  })

  it('never offers a version-pinned download link', () => {
    // The permalink resolves by asset filename, so a versioned href would 404
    // on every release after the one it was written for.
    expect(html).not.toMatch(/releases\/latest\/download\/[^"]*\d+\.\d+\.\d+/)
  })

  it('offers a real destination whether or not a release exists', () => {
    // With no release published the permalink has nothing behind it, so the
    // page must send people to the releases list rather than a 404.
    const hasPermalink = html.includes('releases/latest/download/')
    const hasReleasesList = html.includes('/releases"')
    expect(hasPermalink || hasReleasesList).toBe(true)
  })

  it('states the unrecoverable-passphrase consequence', () => {
    expect(html).toMatch(/no reset/i)
  })
})

describe('guides', () => {
  it('publishes every guide and links them from the index', () => {
    const index = page('guide/index.html')
    for (const slug of ['first-run', 'credentials', 'env-files', 'backups']) {
      expect(() => page(`guide/${slug}/index.html`)).not.toThrow()
      expect(index).toContain(`guide/${slug}/`)
    }
  })

  it('tells first-run readers what losing both credentials costs', () => {
    expect(page('guide/first-run/index.html')).toMatch(/The data is gone/i)
  })

  it('resolves internal links under the configured base path', () => {
    // Assuming the domain root would 404 every link on a project site.
    const index = page('guide/index.html')
    expect(index).not.toMatch(/href="\/guide\//)
  })
})

describe('replica components', () => {
  it('use tokens rather than hardcoded colours', () => {
    // A literal colour here is exactly the drift that makes the replica start
    // misrepresenting the product.
    const files = filesUnder(join(SRC, 'components', 'app'), /\.(tsx|css)$/)
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const hex = source.match(/#[0-9a-f]{3,8}\b/gi) ?? []
      expect(hex, `${file} contains a hardcoded colour: ${hex.join(', ')}`).toHaveLength(0)
    }
  })

  it('never renders an unmasked secret-shaped value', () => {
    const html = page('index.html')
    expect(html).not.toMatch(/sk_live/)
    expect(html).not.toMatch(/postgres:\/\/[^\s"<]*:[^\s"<]+@/)
    expect(html).not.toMatch(/AKIA[0-9A-Z]{16}/)
  })
})
