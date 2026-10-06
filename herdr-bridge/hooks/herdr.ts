import type { HerdrTarget } from '../types'

export type { HerdrTarget }

// What herdr is told, worked out from Claude Code's events: no engine calls
// here, so each piece is tested on its own.

export const SOURCE = 'claude-mods:herdr-bridge'
// herdr's own Claude integration reports as agent `claude`; metadata names
// it, so herdr applies ours to that agent and to no other.
export const AGENT = 'claude'
// herdr caps titles, labels and tokens at 80 characters.
export const MAX_TEXT = 80

export type HerdrStatus = 'idle' | 'working' | 'blocked'

// Inside a herdr pane, or not: all three variables, else nothing is sent.
export function herdrTarget(env: { HERDR_ENV?: string; HERDR_PANE_ID?: string; HERDR_BIN_PATH?: string }): HerdrTarget | undefined {
  if (env.HERDR_ENV !== '1') return undefined
  const pane = env.HERDR_PANE_ID?.trim() ?? ''
  const bin = env.HERDR_BIN_PATH?.trim() ?? ''
  if (pane === '' || bin === '' || pane.startsWith('-')) return undefined
  return { bin, pane }
}

// One line, no control or bidi characters, at most `max` characters.
export function oneLine(text: string, max = MAX_TEXT): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

// `/files`, `/clear` and the like: commands, not something to work on.
export const isCommand = (prompt: string) => /^\/[A-Za-z]/.test(prompt.trimStart())

// The first non-empty line of a prompt: what the pane is working on.
export function promptTitle(prompt: string): string {
  const first = prompt.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  return oneLine(first)
}

// The first question AskUserQuestion asks, and how many more there are.
export function questionText(questions: unknown): string {
  const list = Array.isArray(questions) ? questions : []
  const first = list[0] as { question?: unknown; header?: unknown } | undefined
  const asked = typeof first?.question === 'string' ? first.question : typeof first?.header === 'string' ? first.header : ''
  const more = list.length > 1 ? ` (+${list.length - 1})` : ''
  return asked === '' ? '' : `${asked}${more}`
}

// What a permission prompt is for: the tool, and the command, path or URL.
export function permissionText(tool: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>
  const detail = [args.command, args.file_path, args.notebook_path, args.url, args.pattern, args.path].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  return detail === undefined ? tool : `${tool} ${detail}`
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export type TurnEnd = 'answer' | 'aborted' | 'refusal' | 'error'

// The line a finished turn leaves in herdr's sidebar.
export function turnSummary(end: TurnEnd, tools: number, ms: number): string {
  const ran = tools === 1 ? '1 tool' : `${tools} tools`
  const why = end === 'aborted' ? 'interrupted · ' : end === 'error' ? 'error · ' : end === 'refusal' ? 'refused · ' : ''
  return oneLine(`${why}${ran} · ${duration(ms)}`)
}

export type Display = {
  title?: string
  status?: HerdrStatus
  label?: string
  summary?: string
  clear?: boolean
}

// `herdr pane report-metadata`: display only, never the semantic state.
export function metadataArgs(target: HerdrTarget, seq: number, display: Display): string[] {
  const argv = [target.bin, 'pane', 'report-metadata', target.pane, '--source', SOURCE, '--agent', AGENT, '--seq', String(seq)]
  if (display.clear === true) {
    argv.push('--clear-title', '--clear-state-labels', '--clear-token', 'summary')
    return argv
  }
  if (display.title === '') argv.push('--clear-title')
  else if (display.title !== undefined) argv.push('--title', oneLine(display.title))
  if (display.status !== undefined) {
    argv.push('--clear-state-labels')
    if (display.label !== undefined && display.label !== '') argv.push('--state-label', `${display.status}=${oneLine(display.label)}`)
  }
  if (display.summary !== undefined) argv.push('--token', `summary=${oneLine(display.summary)}`)
  return argv
}

// `herdr pane report-agent`: the semantic state, under this plugin's own
// source (state mode only).
export function stateArgs(target: HerdrTarget, seq: number, status: HerdrStatus, message?: string): string[] {
  const argv = [target.bin, 'pane', 'report-agent', target.pane, '--source', SOURCE, '--agent', AGENT, '--state', status, '--seq', String(seq)]
  if (message !== undefined && message !== '') argv.push('--message', oneLine(message))
  return argv
}

export function releaseArgs(target: HerdrTarget, seq: number): string[] {
  return [target.bin, 'pane', 'release-agent', target.pane, '--source', SOURCE, '--agent', AGENT, '--seq', String(seq)]
}
