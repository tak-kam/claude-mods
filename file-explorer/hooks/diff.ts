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

// `git log --follow --name-only` with the log format above and a trailing
// separator: each commit with the path the file had in it.
export function parseFileLog(raw: string): (ExplorerCommit & { path: string })[] {
  return raw
    .split('\x1e')
    .map(record => record.replace(/^\n+/, '').split('\x1f'))
    .filter(fields => fields.length >= 6)
    .map(([sha = '', short = '', subject = '', author = '', when = '', names = '']) => {
      const path = names.split('\n').map(line => line.trim()).filter(Boolean).pop() ?? ''
      return {
        sha,
        short: oneLine(short),
        subject: oneLine(subject),
        author: oneLine(author),
        when: oneLine(when),
        // A quoted name (git's way with odd bytes) is not a usable path.
        path: path.startsWith('"') ? '' : path,
      }
    })
}

export type BlameCommit = { short: string; author: string; time: number; summary: string }

// `git blame --porcelain`: each line's commit, by final line number; a
// commit's details are printed only the first time it appears.
export function parseBlame(raw: string, limit: number): { commits: Record<string, BlameCommit>; shas: string[] } {
  const commits: Record<string, BlameCommit> = {}
  const shas: string[] = []
  let current = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('\t')) continue
    const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line)
    if (header !== null) {
      current = header[1] ?? ''
      const final = Number(header[2])
      if (final >= 1 && final <= limit) shas[final - 1] = current
      commits[current] ??= { short: current.slice(0, 7), author: '', time: 0, summary: '' }
      continue
    }
    const commit = commits[current]
    if (commit === undefined) continue
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'author') commit.author = oneLine(value)
    else if (key === 'author-time') commit.time = Number(value) || 0
    else if (key === 'summary') commit.summary = oneLine(value)
  }
  for (let i = 0; i < shas.length; i++) shas[i] ??= ''
  return { commits, shas }
}

export const UNCOMMITTED = '0'.repeat(40)

export type PullRequest = { number: number; title: string; baseRefName: string; headRefOid?: string }

// A branch name git can take as is: no option, no range, no oddities.
export function isPlainBranch(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock')
}

// `gh pr view --json number,title,baseRefName,headRefOid`: what the explorer
// needs of a pull request, or nothing when gh said something else.
export function parsePullRequest(stdout: string): PullRequest | undefined {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const pr = data as { number?: unknown; title?: unknown; baseRefName?: unknown; headRefOid?: unknown }
  if (typeof pr.number !== 'number' || !Number.isInteger(pr.number) || pr.number <= 0) return undefined
  if (typeof pr.baseRefName !== 'string' || !isPlainBranch(pr.baseRefName)) return undefined
  const head = typeof pr.headRefOid === 'string' && /^[0-9a-f]{40}$/.test(pr.headRefOid) ? pr.headRefOid : undefined
  return {
    number: pr.number,
    title: oneLine(typeof pr.title === 'string' ? pr.title : ''),
    baseRefName: pr.baseRefName,
    ...(head === undefined ? {} : { headRefOid: head }),
  }
}

// How a pull request is named in the base Button: `#41 title`.
export function pullLabel(pr: { number: number; title: string }): string {
  return pr.title === '' ? `PR #${pr.number}` : `#${pr.number} ${pr.title}`
}
