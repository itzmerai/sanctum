/**
 * Latest-release metadata, read at build time (U6: R11, R17, KTD6).
 *
 * The version and hash shown on the download page come from the published
 * release rather than a constant in this repo. A hardcoded version is correct
 * on the day it is written and quietly wrong afterwards, which on a page whose
 * job is letting people verify what they downloaded is worse than showing
 * nothing.
 *
 * The download *link* is deliberately not taken from here - it is GitHub's
 * `releases/latest/download` permalink, which stays correct between builds
 * (KTD5). This module supplies what the permalink cannot: which version that
 * currently is, when it shipped, and its checksum.
 */

export const REPO = 'itzmerai/sanctum'

/** The asset the download button points at, by name. */
export const INSTALLER_SUFFIX = '-setup.exe'

/**
 * The permalink resolves by asset filename, so the release workflow publishes
 * a version-free copy alongside the versioned one. Linking to
 * `Sanctum_0.1.0_x64-setup.exe` would go stale on the next release.
 */
export const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/Sanctum-setup.exe`

/** Where to send people when no release exists yet, so nothing 404s. */
export const RELEASES_URL = `https://github.com/${REPO}/releases`

/**
 * Why there is no live release, when there isn't one.
 *
 * 'unreachable' and 'none' are different facts and the page says different
 * things about them - claiming a network failure when GitHub answered fine
 * and simply has nothing published is a lie on a page about honesty.
 */
export type ReleaseState = 'live' | 'none' | 'unreachable'

export interface ReleaseInfo {
  version: string
  /** ISO date, or null when the release could not be read. */
  publishedAt: string | null
  /** Lowercase hex SHA-256, or null when no checksum asset was published. */
  sha256: string | null
  /** True when this came from the API rather than the fallback. */
  live: boolean
  state: ReleaseState
}

interface GitHubAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name?: string
  published_at?: string
  assets?: GitHubAsset[]
}

/** Both the network calls this module makes, injected so tests need none. */
export interface Fetchers {
  json: (url: string) => Promise<unknown>
  text: (url: string) => Promise<string>
}

/**
 * Pulls the SHA-256 out of a `SHA256SUMS.txt` body.
 *
 * The format is the one `sha256sum` emits: hash, whitespace, filename.
 */
export function parseChecksum(body: string): string | null {
  const match = /\b([0-9a-f]{64})\b/i.exec(body)
  return match?.[1]?.toLowerCase() ?? null
}

/** Strips a leading `v` so the page shows `0.2.0`, not `v0.2.0`. */
export function normaliseVersion(tag: string): string {
  return tag.replace(/^v/i, '')
}

/**
 * Reads the latest release.
 *
 * Never throws. A build must not fail because GitHub was briefly unreachable
 * or rate-limited - the page falls back to the version this repo declares and
 * omits the hash, which is honest about what it does and does not know.
 */
export async function latestRelease(
  fetchers: Fetchers,
  fallbackVersion: string,
): Promise<ReleaseInfo> {
  const fallback = (state: ReleaseState): ReleaseInfo => ({
    version: fallbackVersion,
    publishedAt: null,
    sha256: null,
    live: false,
    state,
  })

  let release: GitHubRelease | null
  try {
    release = (await fetchers.json(
      `https://api.github.com/repos/${REPO}/releases/latest`,
    )) as GitHubRelease | null
  } catch {
    // Could not ask. Distinct from asking and being told there is nothing.
    return fallback('unreachable')
  }

  // A 404 resolves null: the repository simply has no releases yet.
  if (!release) return fallback('none')
  if (typeof release.tag_name !== 'string') return fallback('unreachable')

  const assets = Array.isArray(release.assets) ? release.assets : []
  const installer = assets.find((asset) => asset.name?.endsWith(INSTALLER_SUFFIX))
  // A release with no installer is not one a visitor can download from, which
  // reads the same to them as no release at all.
  if (!installer) return fallback('none')

  const checksumAsset = assets.find((asset) => /sha256sums/i.test(asset.name ?? ''))
  let sha256: string | null = null
  if (checksumAsset) {
    try {
      sha256 = parseChecksum(await fetchers.text(checksumAsset.browser_download_url))
    } catch {
      // A missing checksum is a smaller problem than a failed build.
      sha256 = null
    }
  }

  return {
    version: normaliseVersion(release.tag_name),
    publishedAt: release.published_at ?? null,
    sha256,
    live: true,
    state: 'live',
  }
}

/** The real fetchers, with the workflow's token when one is present. */
export function httpFetchers(token?: string | undefined): Fetchers {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sanctum-site-build',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  return {
    json: async (url) => {
      const response = await fetch(url, { headers })
      // A 404 is an answer, not a failure: it means nothing is published.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${response.status} from ${url}`)
      return response.json()
    },
    text: async (url) => {
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`${response.status} from ${url}`)
      return response.text()
    },
  }
}
