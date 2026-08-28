/**
 * Best-effort `.env` reading, for display only (U4: R8, R11, KTD4).
 *
 * This parser has no authority over what is stored. The vault holds the raw
 * file text; this only decides how it is *shown* — which keys get their own
 * masked row, and which lines are passed through untouched. Nothing here ever
 * re-serialises, so a file that this parser misreads still copies out exactly
 * as it went in.
 *
 * `.env` has no specification and every tool disagrees at the edges. The rule
 * followed here is: when a line is not confidently understood, keep it whole
 * as an opaque line rather than guess at a key and value.
 */

/** One `KEY=value` assignment. */
export interface EnvPair {
  kind: 'pair'
  key: string
  value: string
}

/** A comment, a blank line, or anything not understood. Shown verbatim. */
export interface EnvOpaque {
  kind: 'opaque'
  text: string
}

export type EnvEntry = EnvPair | EnvOpaque

export interface EnvParse {
  /** Every line of the file, in its original order. */
  entries: EnvEntry[]
  /** How many assignments were found. Zero means show the raw text (R11). */
  keyCount: number
}

/** `export FOO=`, `FOO =`, `FOO.BAR=` — the shapes that count as an assignment. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/

/**
 * Finds the closing quote, skipping `\"` inside a double-quoted value.
 * Single quotes have no escape sequence, matching shell and dotenv behaviour.
 */
function closingQuote(text: string, quote: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && quote === '"') {
      i += 1
      continue
    }
    if (text[i] === quote) return i
  }
  return -1
}

/**
 * Strips a trailing comment from an unquoted value.
 *
 * A `#` only starts a comment when whitespace precedes it, so a value like
 * `sk_live_a#b` keeps its hash — that is a real key, not a comment.
 */
function stripTrailingComment(value: string): string {
  const at = value.search(/\s#/)
  return at === -1 ? value : value.slice(0, at)
}

export function parseEnv(text: string): EnvParse {
  const entries: EnvEntry[] = []
  let keyCount = 0

  if (text === '') return { entries, keyCount }

  // CRLF and LF parse identically; the stored text keeps whichever it had.
  const lines = text.split(/\r?\n/)

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) {
      entries.push({ kind: 'opaque', text: line })
      index += 1
      continue
    }

    const match = ASSIGNMENT.exec(line)
    if (!match) {
      entries.push({ kind: 'opaque', text: line })
      index += 1
      continue
    }

    const key = match[1] ?? ''
    const rest = match[2] ?? ''
    const afterEquals = rest.trimStart()
    const quote = afterEquals[0]

    if (quote === '"' || quote === "'") {
      // A quoted value may span lines — a PEM private key is the usual case.
      let body = rest.slice(rest.indexOf(quote) + 1)
      let end = closingQuote(body, quote)
      let last = index

      while (end === -1 && last + 1 < lines.length) {
        last += 1
        body += `\n${lines[last] ?? ''}`
        end = closingQuote(body, quote)
      }

      // An unterminated quote is malformed; keep what is there rather than
      // swallowing the rest of the file.
      const value = end === -1 ? body : body.slice(0, end)
      entries.push({ kind: 'pair', key, value })
      keyCount += 1
      index = last + 1
      continue
    }

    entries.push({ kind: 'pair', key, value: stripTrailingComment(rest).trim() })
    keyCount += 1
    index += 1
  }

  return { entries, keyCount }
}
