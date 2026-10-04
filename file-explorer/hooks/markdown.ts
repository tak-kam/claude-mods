export type MarkdownPart =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; language: string; text: string }

// ATX headings (`# Title`) and fenced code split from the text around them,
// so they can be drawn as bands and framed blocks; the rest stays markdown.
// A fence left open runs to the end, as markdown reads it.
export function splitMarkdown(markdown: string): MarkdownPart[] {
  const parts: MarkdownPart[] = []
  let chunk: string[] = []
  let code: string[] = []
  let fence = ''
  let language = ''
  const flush = () => {
    const text = chunk.join('\n')
    if (text.trim() !== '') parts.push({ kind: 'text', text: text.replace(/^\n+|\n+$/g, '') })
    chunk = []
  }
  for (const line of markdown.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    if (fence === '') {
      if (open !== null) {
        flush()
        fence = open[1] ?? '```'
        language = open[2] ?? ''
        code = []
        continue
      }
      const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
      if (heading === null) {
        chunk.push(line)
        continue
      }
      flush()
      parts.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: plainInline(heading[2] ?? '') })
      continue
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
    if (close !== undefined && close.charAt(0) === fence.charAt(0) && close.length >= fence.length) {
      parts.push({ kind: 'code', language, text: code.join('\n') })
      fence = ''
      continue
    }
    code.push(line)
  }
  if (fence !== '') parts.push({ kind: 'code', language, text: code.join('\n') })
  flush()
  return parts
}

// The ATX headings outside fences, with their 1-based lines: the same
// reading as splitMarkdown, for an outline.
export function markdownHeadings(markdown: string): { line: number; level: number; text: string }[] {
  const found: { line: number; level: number; text: string }[] = []
  let fence = ''
  markdown.split('\n').forEach((line, i) => {
    if (fence === '') {
      const open = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (open !== undefined) {
        fence = open
        return
      }
      const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
      if (heading !== null) found.push({ line: i + 1, level: (heading[1] ?? '#').length, text: plainInline(heading[2] ?? '') })
      return
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
    if (close !== undefined && close.charAt(0) === fence.charAt(0) && close.length >= fence.length) fence = ''
  })
  return found
}

// A heading's inline markdown reduced to its text: links to their label,
// emphasis and code marks dropped.
export function plainInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
}

// Terminal cells a string takes: East Asian wide characters and emoji two.
export function cellWidth(text: string): number {
  let cells = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x300 && code <= 0x36f)) continue
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    cells += isWide ? 2 : 1
  }
  return cells
}

// The text cut or padded with spaces to exactly `cells` cells.
export function fitCells(text: string, cells: number): string {
  let out = ''
  let used = 0
  for (const char of text) {
    const size = cellWidth(char)
    if (used + size > cells) {
      if (used < cells && out !== '') {
        out = `${out.slice(0, -1)}…`
      }
      break
    }
    out += char
    used += size
  }
  return out + ' '.repeat(Math.max(0, cells - cellWidth(out)))
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

// Relative links of a markdown text: what a press may open in the explorer.
export function localLinks(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const href = match[1] ?? ''
    if (href !== '' && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) found.add(href)
    if (found.size >= 256) break
  }
  return [...found]
}

// A link's target relative to the root: from the file's folder, or from the
// root for one starting with `/`; `..` above the root is refused.
export function resolveLink(from: string, href: string): string | undefined {
  let path = href.split('#')[0] ?? ''
  try {
    path = decodeURI(path)
  } catch {}
  if (path === '') return undefined
  const parts = path.startsWith('/') ? [] : parentOf(from).split('/').filter(Boolean)
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

// Lines `from` onward of a markdown text, as many as fit `room` rows at
// `width`. A window starting inside a fenced block reopens the fence with
// its opening line, and one ending inside closes it, so code stays code.
export function markdownWindow(lines: string[], from: number, room: number, width: number): { text: string; start: number; end: number } {
  const opener: (string | undefined)[] = []
  let fence = ''
  let fenceLine: string | undefined
  for (const line of lines) {
    opener.push(fenceLine)
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (mark === undefined) continue
    if (fence === '') {
      fence = mark
      fenceLine = line
    } else if (mark.charAt(0) === fence.charAt(0) && mark.length >= fence.length) {
      fence = ''
      fenceLine = undefined
    }
  }
  const start = clamp(from, 0, Math.max(0, lines.length - 1))
  const reopen = opener[start]
  let used = reopen === undefined ? 0 : 1
  let end = start
  while (end < lines.length) {
    const line = lines[end] ?? ''
    const cost = Math.max(1, Math.ceil(line.length / Math.max(10, width))) + (/^#{1,6}\s/.test(line) ? 1 : 0)
    if (used + cost > room - 1 && end > start) break
    used += cost
    end++
  }
  const close = opener[end] ?? undefined
  const body = lines.slice(start, end)
  const text = [
    ...(reopen === undefined ? [] : [reopen]),
    ...body,
    ...(close === undefined || end >= lines.length ? [] : [(/^\s*(`{3,}|~{3,})/.exec(close)?.[1] ?? '```')]),
  ].join('\n')
  return { text, start, end }
}
