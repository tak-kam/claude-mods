import type { ExplorerHit } from '../types'
import { hitLine } from './safe'

// Fuzzy file-name match, as a quick-open does: every query character in
// order, scored up for runs, word starts and hits in the base name.
export function fuzzyScore(path: string, query: string, lower?: string): number | undefined {
  const text = lower ?? path.toLowerCase()
  const wanted = query.toLowerCase().replace(/\s+/g, '')
  if (wanted === '') return 0
  const nameStart = text.lastIndexOf('/') + 1
  let score = 0
  let at = 0
  let previous = -2
  for (const char of wanted) {
    const found = text.indexOf(char, at)
    if (found < 0) return undefined
    const before = text.charAt(found - 1)
    if (found === previous + 1) score += 5
    if (found === 0 || before === '/' || before === '-' || before === '_' || before === '.') score += 4
    if (found >= nameStart) score += 2
    previous = found
    at = found + 1
  }
  // A whole-name substring beats a scattered one; shorter paths break ties.
  if (text.slice(nameStart).includes(wanted)) score += 20
  return score - path.length / 100
}

// The best `limit` paths for a query. `lower` is the paths lowercased once
// (fuzzyIndex), so a keystroke pays for no conversions; only the kept few
// are sorted, not every match.
export function fuzzyFilter(paths: readonly string[], query: string, limit: number, lower?: readonly string[]): string[] {
  const wanted = query.toLowerCase().replace(/\s+/g, '')
  const kept: { path: string; score: number }[] = []
  let floor = -Infinity
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i] ?? ''
    const score = fuzzyScore(path, wanted, lower?.[i])
    if (score === undefined || (kept.length >= limit && score <= floor)) continue
    kept.push({ path, score })
    if (kept.length > limit * 2) {
      kept.sort((a, b) => b.score - a.score)
      kept.length = limit
      floor = kept[limit - 1]?.score ?? -Infinity
    }
  }
  kept.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return kept.slice(0, limit).map(one => one.path)
}

export function fuzzyIndex(paths: readonly string[]): string[] {
  return paths.map(path => path.toLowerCase())
}

// `rg --null --line-number --column`: path NUL line:column:text, one a line.
// `git grep -z -n --column`: path NUL line NUL column NUL text.
export function parseGrep(raw: string, limit: number): ExplorerHit[] {
  const hits: ExplorerHit[] = []
  for (const record of raw.split('\n')) {
    if (hits.length >= limit) break
    const cut = record.indexOf('\0')
    if (cut < 0) continue
    const path = record.slice(0, cut)
    const rest = record.slice(cut + 1)
    const match = /^(\d+)[:\0](\d+)[:\0]([\s\S]*)$/.exec(rest)
    if (match === null) continue
    hits.push({ path, line: Number(match[1]), column: Number(match[2]), text: hitLine(match[3] ?? '') })
  }
  return hits
}

// The query as a pattern for highlighting, compiled once per drawing:
// JavaScript's regex stands in for ripgrep's, close enough to mark the hit.
export function compileQuery(query: string, options: { isRegex: boolean; isCaseSensitive: boolean }): RegExp | undefined {
  if (query === '') return undefined
  try {
    const source = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(source, options.isCaseSensitive ? '' : 'i')
  } catch {
    return undefined
  }
}

// Where the pattern lands in a line.
export function matchSpan(text: string, pattern: RegExp | undefined): { start: number; end: number } | undefined {
  const found = pattern?.exec(text)
  if (found === null || found === undefined || found[0] === '') return undefined
  return { start: found.index, end: found.index + found[0].length }
}

// A line cut to `room` cells around its hit, so the hit stays in view.
export function excerpt(
  text: string,
  span: { start: number; end: number } | undefined,
  room: number,
): { before: string; hit: string; after: string } {
  const line = text.replace(/\t/g, '  ')
  const shift = text.length - line.length
  const start = span === undefined ? 0 : Math.max(0, span.start + (shift > 0 ? countTabs(text, span.start) : 0))
  const end = span === undefined ? 0 : start + (span.end - span.start)
  const lead = line.length - line.trimStart().length
  let from = Math.min(lead, start)
  if (end - from > room) from = Math.max(0, start - 4)
  else if (end > from + room) from = Math.max(0, end - room)
  const visible = line.slice(from, from + Math.max(1, room))
  const prefix = from > lead ? '…' : ''
  const cutStart = Math.max(0, start - from)
  const cutEnd = Math.max(cutStart, Math.min(visible.length, end - from))
  return {
    before: prefix + visible.slice(prefix === '' ? 0 : 1, cutStart),
    hit: visible.slice(cutStart, cutEnd),
    after: visible.slice(cutEnd),
  }
}

function countTabs(text: string, upTo: number): number {
  let tabs = 0
  for (let i = 0; i < upTo; i++) if (text.charAt(i) === '\t') tabs++
  return tabs
}
