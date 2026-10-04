import { describe, expect, test } from 'claude-code/testing'
import { compileQuery, excerpt, fuzzyFilter, fuzzyIndex, fuzzyScore, matchSpan, parseGrep } from '../hooks/search'

describe('fuzzyScore', () => {
  test('matches characters in order, case-insensitively', () => {
    expect(fuzzyScore('src/Main.ts', 'smt')).toBeDefined()
    expect(fuzzyScore('src/main.ts', 'tms')).toBeUndefined()
    expect(fuzzyScore('src/main.ts', 'MAIN')).toBeDefined()
  })

  test('ranks a base-name hit over a scattered one', () => {
    const name = fuzzyScore('lib/main.ts', 'main') ?? 0
    const scattered = fuzzyScore('m/a/i/n/x.ts', 'main') ?? 0
    expect(name).toBeGreaterThan(scattered)
  })

  test('ignores spaces in the query', () => {
    expect(fuzzyScore('src/main.ts', 's m')).toBe(fuzzyScore('src/main.ts', 'sm'))
  })
})

describe('fuzzyFilter', () => {
  const paths = ['README.md', 'src/main.ts', 'src/util.ts', 'docs/main-notes.md', 'test/main.test.ts']

  test('puts the best match first and leaves non-matches out', () => {
    const found = fuzzyFilter(paths, 'main.ts', 10)
    expect(found[0]).toBe('src/main.ts')
    expect(found).not.toContain('README.md')
  })

  test('gives the same answer with a lowercased index', () => {
    expect(fuzzyFilter(paths, 'mn', 10, fuzzyIndex(paths))).toEqual(fuzzyFilter(paths, 'mn', 10))
  })

  test('keeps at most the limit, the best of them', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `dir${i}/file.ts`)
    many.push('file.ts')
    const found = fuzzyFilter(many, 'file', 5)
    expect(found).toHaveLength(5)
    expect(found[0]).toBe('file.ts')
  })

  test('finds nothing in nothing', () => {
    expect(fuzzyFilter([], 'a', 5)).toEqual([])
  })
})

describe('parseGrep', () => {
  test('reads ripgrep records', () => {
    expect(parseGrep('src/a.ts\x0012:5:const x = 1\nb c.ts\x003:1:y: z\n', 10)).toEqual([
      { path: 'src/a.ts', line: 12, column: 5, text: 'const x = 1' },
      { path: 'b c.ts', line: 3, column: 1, text: 'y: z' },
    ])
  })

  test('reads git grep records', () => {
    expect(parseGrep('src/a.ts\x0012\x005\x00const x\n', 10)).toEqual([{ path: 'src/a.ts', line: 12, column: 5, text: 'const x' }])
  })

  test('stops at the limit and skips junk', () => {
    expect(parseGrep('junk\na\x001:1:x\na\x002:1:y\n', 1)).toHaveLength(1)
  })

  test('shows control characters in a hit as ?, keeping tabs', () => {
    expect(parseGrep('a\x001:1:\tx\u001b[2Jy\n', 1)[0]?.text).toBe('\tx?[2Jy')
  })
})

describe('compileQuery and matchSpan', () => {
  test('match a fixed string literally, case-insensitively by default', () => {
    const pattern = compileQuery('a.b', { isRegex: false, isCaseSensitive: false })
    expect(matchSpan('xA.By', pattern)).toEqual({ start: 1, end: 4 })
    expect(matchSpan('aXb', pattern)).toBeUndefined()
  })

  test('honour case and regex', () => {
    expect(matchSpan('Ab ab', compileQuery('ab', { isRegex: false, isCaseSensitive: true }))).toEqual({ start: 3, end: 5 })
    expect(matchSpan('x123y', compileQuery('\\d+', { isRegex: true, isCaseSensitive: false }))).toEqual({ start: 1, end: 4 })
  })

  test('give up quietly on a bad regex or an empty query', () => {
    expect(compileQuery('(', { isRegex: true, isCaseSensitive: false })).toBeUndefined()
    expect(compileQuery('', { isRegex: false, isCaseSensitive: false })).toBeUndefined()
    expect(matchSpan('abc', undefined)).toBeUndefined()
  })
})

describe('excerpt', () => {
  test('keeps a hit near the end of a long line in view', () => {
    const text = `${'x'.repeat(100)}NEEDLE${'y'.repeat(10)}`
    const piece = excerpt(text, { start: 100, end: 106 }, 20)
    expect(piece.hit).toBe('NEEDLE')
    expect((piece.before + piece.hit + piece.after).length).toBeLessThanOrEqual(20)
  })

  test('drops leading indentation before the hit', () => {
    expect(excerpt('        foo()', { start: 8, end: 11 }, 40)).toEqual({ before: '', hit: 'foo', after: '()' })
  })

  test('draws a line with no hit from its start', () => {
    expect(excerpt('plain', undefined, 3)).toEqual({ before: '', hit: '', after: 'pla' })
  })
})
