import { describe, expect, test } from 'claude-code/testing'
import { formatAge, formatSize, isIgnored, parseIgnored } from '../hooks/details'

describe('formatSize', () => {
  test('bytes, then one decimal while small, then whole units', () => {
    expect(formatSize(0)).toBe('0')
    expect(formatSize(812)).toBe('812')
    expect(formatSize(4300)).toBe('4.2K')
    expect(formatSize(12 * 1024 + 100)).toBe('12K')
    expect(formatSize(3.1 * 1024 * 1024)).toBe('3.1M')
  })
})

describe('formatAge', () => {
  const now = 1_000 * 86_400_000
  test('rounds down to the largest unit', () => {
    expect(formatAge(now - 10_000, now)).toBe('now')
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m')
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d')
    expect(formatAge(now - 400 * 86_400_000, now)).toBe('1y')
  })

  test('says nothing without a time or a clock, and nothing odd for the future', () => {
    expect(formatAge(0, now)).toBe('')
    expect(formatAge(now, 0)).toBe('')
    expect(formatAge(now + 60_000, now)).toBe('now')
  })
})

describe('ignored paths', () => {
  test('parses NUL-separated paths up to a limit', () => {
    expect(parseIgnored('build/\0.env\0\0', 10)).toEqual(['build/', '.env'])
    expect(parseIgnored('a\0b\0c\0', 2)).toEqual(['a', 'b'])
  })

  test('matches a path, a folder, or anything beneath an ignored folder', () => {
    const set = new Set(['build/', '.env'])
    expect(isIgnored('.env', set)).toBe(true)
    expect(isIgnored('build', set)).toBe(true)
    expect(isIgnored('build/out/a.js', set)).toBe(true)
    expect(isIgnored('builder.ts', set)).toBe(false)
    expect(isIgnored('src/.env', set)).toBe(false)
  })
})
