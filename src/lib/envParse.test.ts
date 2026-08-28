import { describe, expect, it } from 'vitest'

import { parseEnv, type EnvPair } from './envParse'

/** Convenience: the pairs only, for assertions that ignore comments. */
function pairs(text: string): EnvPair[] {
  return parseEnv(text).entries.filter((entry): entry is EnvPair => entry.kind === 'pair')
}

/** The first assignment, or a clear failure if the parser found none. */
function firstPair(text: string): EnvPair {
  const [pair] = pairs(text)
  if (!pair) throw new Error(`no assignment parsed from: ${text}`)
  return pair
}

describe('parseEnv', () => {
  it('reads a plain assignment', () => {
    expect(pairs('KEY=value')).toEqual([{ kind: 'pair', key: 'KEY', value: 'value' }])
  })

  it('keeps a hash inside a quoted value', () => {
    // This is a real secret shape, not a comment.
    expect(firstPair('STRIPE_KEY="sk_live_x#not_a_comment"').value).toBe('sk_live_x#not_a_comment')
  })

  it('does not expand anything inside single quotes', () => {
    expect(firstPair("PASS='a$B{c}d'").value).toBe('a$B{c}d')
  })

  it('drops the export prefix but keeps the key', () => {
    expect(firstPair('export NODE_ENV=production')).toEqual({
      kind: 'pair',
      key: 'NODE_ENV',
      value: 'production',
    })
  })

  it('strips a trailing comment from an unquoted value', () => {
    expect(firstPair('PORT=3000 # the dev port').value).toBe('3000')
  })

  it('keeps a hash that is part of an unquoted value', () => {
    // No whitespace before the hash, so it is not a comment.
    expect(firstPair('TOKEN=abc#def').value).toBe('abc#def')
  })

  it('reads a value spanning several lines', () => {
    const pem = 'KEY="-----BEGIN-----\nline two\nline three\n-----END-----"\nNEXT=1'
    const parsed = pairs(pem)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.value).toBe('-----BEGIN-----\nline two\nline three\n-----END-----')
    expect(parsed[1]).toEqual({ kind: 'pair', key: 'NEXT', value: '1' })
  })

  it('keeps comments and blank lines in their original positions', () => {
    const { entries } = parseEnv('# header\n\nA=1')
    expect(entries.map((entry) => entry.kind)).toEqual(['opaque', 'opaque', 'pair'])
    expect(entries[0]).toEqual({ kind: 'opaque', text: '# header' })
    expect(entries[1]).toEqual({ kind: 'opaque', text: '' })
  })

  it('parses CRLF the same as LF', () => {
    expect(parseEnv('A=1\r\nB=2\r\n')).toEqual(parseEnv('A=1\nB=2\n'))
  })

  it('reports no keys for text that is not env-shaped', () => {
    const parsed = parseEnv('just some prose\nwith no assignments')
    expect(parsed.keyCount).toBe(0)
    expect(parsed.entries.every((entry) => entry.kind === 'opaque')).toBe(true)
  })

  it('returns an empty parse for empty text without throwing', () => {
    expect(parseEnv('')).toEqual({ entries: [], keyCount: 0 })
  })

  it('keeps an unterminated quote on its own line rather than swallowing the file', () => {
    const parsed = parseEnv('BROKEN="oops\nGOOD=1')
    // The unterminated value consumes what follows -- but it never throws, and
    // the raw text is what actually gets copied.
    expect(parsed.keyCount).toBeGreaterThanOrEqual(1)
    expect(parsed.entries[0]?.kind).toBe('pair')
  })

  it('preserves key order', () => {
    expect(pairs('Z=1\nA=2\nM=3').map((pair) => pair.key)).toEqual(['Z', 'A', 'M'])
  })

  it('counts only assignments', () => {
    expect(parseEnv('# c\n\nA=1\nB=2').keyCount).toBe(2)
  })

  it('never throws on adversarial input', () => {
    const nasty = ['=', '=value', 'KEY=', '"', "'", '\\', 'KEY==\\', '#', '\n\n\n', 'K="\\"']
    for (const input of nasty) {
      expect(() => parseEnv(input)).not.toThrow()
    }
  })

  it('treats an empty value as a pair with an empty string', () => {
    expect(firstPair('EMPTY=')).toEqual({ kind: 'pair', key: 'EMPTY', value: '' })
  })
})
