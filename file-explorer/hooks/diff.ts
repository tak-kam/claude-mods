import type { ExplorerChange, ExplorerCommit } from '../types'
import { oneLine } from './safe'

// git's output and diffs, parsed and cut to fit: no engine calls here, so
// each piece is tested on its own.

export const letterOf = (status: string) => {
  const head = status.charAt(0)
  if (head === 'T') return 'M'
  if (head === 'U') return '!'
  return head === '' ? '?' : head
}

// `git diff --name-status -z`: a status, then one path, or two for R and C.
export function parseNameStatus(raw: string): ExplorerChange[] {
  const parts = raw.split('\0').filter(part => part !== '')
  const out: ExplorerChange[] = []
  for (let i = 0; i < parts.length; ) {
    const letter = letterOf(parts[i++] ?? '')
    if (letter === 'R' || letter === 'C') {
      const from = parts[i++] ?? ''
      out.push({ path: parts[i++] ?? '', letter, from })
    } else {
      out.push({ path: parts[i++] ?? '', letter })
    }
  }
  return out
}

// Keeps whole hunks while they fit; a first hunk that alone is too long is
// cut by lines and its header recounted, so it still parses as a diff.
export function clipDiff(diff: string, limit: number): { text: string; isCut: boolean } {
  if (diff.length <= limit) return { text: diff, isCut: false }
  const hunks = diff.split(/\n(?=@@ )/)
  let text = ''
  for (const hunk of hunks) {
    const joined = text === '' ? hunk : `${text}\n${hunk}`
    if (joined.length > limit - 1) break
    text = joined
  }
  if (text !== '') return { text: `${text}\n`, isCut: true }

  const lines = (hunks[0] ?? '').split('\n')
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[0] ?? '')
  if (header === null) return { text: diff.slice(0, limit), isCut: true }
  const kept: string[] = []
  let size = (lines[0] ?? '').length + 1
  let oldCount = 0
  let newCount = 0
  for (const line of lines.slice(1)) {
    if (size + line.length + 1 > limit - 40) break
    kept.push(line)
    size += line.length + 1
    if (line.startsWith('-')) oldCount++
    else if (line.startsWith('+')) newCount++
    else if (line.startsWith(' ')) {
      oldCount++
      newCount++
    }
  }
  const head = `@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3]}`
  return { text: `${[head, ...kept].join('\n')}\n`, isCut: true }
}

// `git log` records, fields split by \x1f and records by \x1e.
export function parseLog(raw: string): ExplorerCommit[] {
  return raw
    .split('\x1e')
    .map(record => record.replace(/^\n/, '').split('\x1f'))
    .filter(fields => fields.length >= 5)
    .map(([sha = '', short = '', subject = '', author = '', when = '']) => ({
      sha,
      short: oneLine(short),
      subject: oneLine(subject),
      author: oneLine(author),
      when: oneLine(when),
    }))
}

// One `@@` block per hunk, so each can be drawn and quoted on its own.
export function splitHunks(diff: string): { header: string; body: string; lines: string }[] {
  return diff
    .split(/\n(?=@@ )/)
    .filter(hunk => hunk.startsWith('@@ '))
    .map(hunk => {
      const header = hunk.slice(0, hunk.indexOf('\n') < 0 ? hunk.length : hunk.indexOf('\n'))
      const at = /\+(\d+)(?:,(\d+))?/.exec(header)
      const start = Number(at?.[1] ?? 0)
      const count = Number(at?.[2] ?? 1)
      const lines = count <= 1 ? `line ${start}` : `lines ${start}-${start + count - 1}`
      return { header, body: hunk.endsWith('\n') ? hunk : `${hunk}\n`, lines }
    })
}

// Rows `skip` to `skip + take` of a hunk's body lines, its header recounted
// so the slice still parses as a hunk.
export function sliceHunk(body: string, skip: number, take: number): string {
  const lines = body.replace(/\n$/, '').split('\n')
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[0] ?? '')
  const content = lines.slice(1)
  if (header === null) return body
  let oldStart = Number(header[1])
  let newStart = Number(header[2])
  for (const line of content.slice(0, skip)) {
    if (!line.startsWith('+')) oldStart++
    if (!line.startsWith('-')) newStart++
  }
  const kept = content.slice(skip, skip + take)
  const oldCount = kept.filter(line => !line.startsWith('+')).length
  const newCount = kept.filter(line => !line.startsWith('-')).length
  return `${[`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${header[3]}`, ...kept].join('\n')}\n`
}

// The rows before the hunk that holds new-side `line`, in drawPreview's
// windowing (a hunk is its label row and its lines).
export function hunkOffset(diff: string, line: number): number {
  let rows = 0
  for (const hunk of splitHunks(diff)) {
    const at = /\+(\d+)(?:,(\d+))?/.exec(hunk.header)
    const start = Number(at?.[1] ?? 0)
    const count = Number(at?.[2] ?? 1)
    if (line < start + Math.max(1, count)) return rows
    rows += hunk.body.replace(/\n$/, '').split('\n').length
  }
  return 0
}
