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
