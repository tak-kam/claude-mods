import { cellWidth, fitCells } from './markdown'
import { oneLine } from './safe'

// ---- CSV / TSV -------------------------------------------------------------

// A record and the 1-based line it starts on (a quoted field can hold
// newlines, so records and lines part ways).
export type DataRecord = { line: number; cells: string[] }

export function isDelimited(path: string): boolean {
  return /\.(csv|tsv|tab)$/i.test(path)
}

export function isJson(path: string): boolean {
  return /\.(json|jsonl|ndjson|geojson)$/i.test(path)
}

export function isJsonLines(path: string): boolean {
  return /\.(jsonl|ndjson)$/i.test(path)
}

// RFC 4180, leniently: quoted fields with doubled quotes, delimiters and
// newlines; a stray quote inside a bare field is kept as text.
export function parseDelimited(text: string, delimiter: string, limit: number): { records: DataRecord[]; isCut: boolean } {
  const records: DataRecord[] = []
  let cells: string[] = []
  let cell = ''
  let line = 1
  let start = 1
  let isQuoted = false
  let atFieldStart = true
  const body = text.replace(/^﻿/, '')
  const endRecord = () => {
    cells.push(cell)
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: start, cells })
    cells = []
    cell = ''
    atFieldStart = true
  }
  for (let i = 0; i < body.length; i++) {
    if (records.length >= limit) return { records, isCut: true }
    const char = body.charAt(i)
    if (isQuoted) {
      if (char === '"') {
        if (body.charAt(i + 1) === '"') {
          cell += '"'
          i++
        } else {
          isQuoted = false
        }
      } else {
        if (char === '\n') line++
        cell += char
      }
      continue
    }
    if (char === '"' && atFieldStart) {
      isQuoted = true
      atFieldStart = false
      continue
    }
    if (char === delimiter) {
      cells.push(cell)
      cell = ''
      atFieldStart = true
      continue
    }
    if (char === '\r' && body.charAt(i + 1) === '\n') continue
    if (char === '\n') {
      endRecord()
      line++
      start = line
      continue
    }
    cell += char
    atFieldStart = false
  }
  if (cell !== '' || cells.length > 0) endRecord()
  return { records: records.slice(0, limit), isCut: records.length > limit }
}

// The records as aligned rows of text: the first a header, then a rule.
// Columns are as wide as their widest cell, up to `most` cells; ragged
// rows are padded. Cell text is made one safe line.
export function tableLines(records: readonly DataRecord[], most: number): { line: number; text: string; isHeader?: boolean; isRule?: boolean }[] {
  const columns = Math.max(0, ...records.map(record => record.cells.length))
  const widths = new Array<number>(columns).fill(1)
  const safe = records.map(record => record.cells.map(cell => oneLine(cell)))
  for (const row of safe) row.forEach((cell, i) => (widths[i] = Math.min(most, Math.max(widths[i] ?? 1, cellWidth(cell)))))
  const draw = (row: readonly string[]) =>
    widths.map((width, i) => fitCell(row[i] ?? '', width)).join(' │ ').trimEnd()
  const out: { line: number; text: string; isHeader?: boolean; isRule?: boolean }[] = []
  safe.forEach((row, i) => {
    out.push({ line: records[i]?.line ?? 0, text: draw(row), isHeader: i === 0 ? true : undefined })
    if (i === 0) out.push({ line: records[0]?.line ?? 0, text: widths.map(width => '─'.repeat(width)).join('─┼─'), isRule: true })
  })
  return out
}

// A cell padded to its column, or cut with a mark that says so.
function fitCell(text: string, width: number): string {
  if (cellWidth(text) <= width) return fitCells(text, width)
  const kept = fitCells(text, width - 1).trimEnd()
  return `${kept}…${' '.repeat(Math.max(0, width - 1 - cellWidth(kept)))}`
}

// ---- JSON ------------------------------------------------------------------

export type JsonNode =
  | { kind: 'object'; line: number; entries: { key: string; node: JsonNode }[] }
  | { kind: 'array'; line: number; items: JsonNode[] }
  | { kind: 'string' | 'number' | 'boolean' | 'null'; line: number; text: string }
  | { kind: 'error'; line: number; text: string }

export type JsonResult = { root: JsonNode } | { error: string; line: number; column: number }

const MAX_DEPTH = 256

// A strict JSON parser that keeps each value's line, and on bad input
// says where (the runtime's own error carries no position everywhere).
export function parseJson(text: string, maxNodes = 200000): JsonResult {
  let at = 0
  let line = 1
  let lineStart = 0
  let nodes = 0
  const body = text.replace(/^﻿/, '')
  class Bad extends Error {}
  const fail = (what: string): never => {
    throw new Bad(what)
  }
  const space = () => {
    for (;;) {
      const char = body.charAt(at)
      if (char === '\n') {
        line++
        lineStart = at + 1
      } else if (char !== ' ' && char !== '\t' && char !== '\r') return
      at++
    }
  }
  const string = (): string => {
    at++
    let out = ''
    for (;;) {
      if (at >= body.length) fail('unterminated string')
      const char = body.charAt(at)
      if (char === '"') {
        at++
        return out
      }
      if (char === '\n' || char < ' ') fail('control character in string')
      if (char === '\\') {
        const next = body.charAt(at + 1)
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (next === 'u') {
          const hex = body.slice(at + 2, at + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape')
          out += String.fromCharCode(parseInt(hex, 16))
          at += 6
          continue
        }
        const value = simple[next]
        if (value === undefined) fail('bad escape')
        out += value
        at += 2
        continue
      }
      out += char
      at++
    }
  }
  const value = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail('nested too deeply')
    if (++nodes > maxNodes) fail('too many values to show')
    space()
    const from = line
    const char = body.charAt(at)
    if (char === '{') {
      at++
      const entries: { key: string; node: JsonNode }[] = []
      space()
      if (body.charAt(at) === '}') {
        at++
        return { kind: 'object', line: from, entries }
      }
      for (;;) {
        space()
        if (body.charAt(at) !== '"') fail('expected a key')
        const key = string()
        space()
        if (body.charAt(at) !== ':') fail("expected ':'")
        at++
        entries.push({ key, node: value(depth + 1) })
        space()
        const sep = body.charAt(at)
        at++
        if (sep === '}') return { kind: 'object', line: from, entries }
        if (sep !== ',') {
          at--
          fail("expected ',' or '}'")
        }
      }
    }
    if (char === '[') {
      at++
      const items: JsonNode[] = []
      space()
      if (body.charAt(at) === ']') {
        at++
        return { kind: 'array', line: from, items }
      }
      for (;;) {
        items.push(value(depth + 1))
        space()
        const sep = body.charAt(at)
        at++
        if (sep === ']') return { kind: 'array', line: from, items }
        if (sep !== ',') {
          at--
          fail("expected ',' or ']'")
        }
      }
    }
    if (char === '"') return { kind: 'string', line: from, text: string() }
    const word = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(body.slice(at, at + 400))?.[0]
    if (word === undefined) fail(at >= body.length ? 'unexpected end' : `unexpected ${JSON.stringify(char)}`)
    const text = word as string
    at += text.length
    const kind = text === 'true' || text === 'false' ? 'boolean' : text === 'null' ? 'null' : 'number'
    return { kind, line: from, text }
  }
  try {
    const root = value(0)
    space()
    if (at < body.length) fail('unexpected text after the value')
    return { root }
  } catch (error) {
    if (!(error instanceof Bad)) throw error
    return { error: error.message, line, column: at - lineStart + 1 }
  }
}

// JSON Lines: one value a line, under an array; a bad line is an error
// entry in place, so the rest still shows.
export function parseJsonLines(text: string, limit: number): JsonNode {
  const items: JsonNode[] = []
  text.split('\n').forEach((raw, i) => {
    if (items.length >= limit || raw.trim() === '') return
    const parsed = parseJson(raw, 20000)
    items.push('root' in parsed ? shiftLines(parsed.root, i) : { kind: 'error', line: i + 1, text: `${parsed.error} at column ${parsed.column}` })
  })
  return { kind: 'array', line: 1, items }
}

function shiftLines(node: JsonNode, by: number): JsonNode {
  if (node.kind === 'object') return { ...node, line: node.line + by, entries: node.entries.map(one => ({ key: one.key, node: shiftLines(one.node, by) })) }
  if (node.kind === 'array') return { ...node, line: node.line + by, items: node.items.map(one => shiftLines(one, by)) }
  return { ...node, line: node.line + by }
}

// `a.b[3].c`, quoting keys that are not plain names.
export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return parent === '' ? key : `${parent}.${key}`
  return `${parent}[${JSON.stringify(key)}]`
}

export type JsonRow = {
  path: string
  depth: number
  key: string
  kind: JsonNode['kind']
  text: string
  isOpen?: boolean
  line: number
}

// The tree as rows, the root's children at depth 0. A container is open
// by default above `openDepth`; `toggled` flips that per path.
export function jsonRows(root: JsonNode, toggled: ReadonlySet<string>, openDepth: number, limit: number): JsonRow[] {
  const rows: JsonRow[] = []
  const isOpen = (path: string, depth: number) => (depth < openDepth) !== toggled.has(path)
  const walk = (node: JsonNode, path: string, key: string, depth: number) => {
    if (rows.length >= limit) return
    const name = oneLine(key)
    if (node.kind === 'object' || node.kind === 'array') {
      const size = node.kind === 'object' ? node.entries.length : node.items.length
      const open = size > 0 && isOpen(path, depth)
      rows.push({ path, depth, key: name, kind: node.kind, text: node.kind === 'object' ? `{${size}}` : `[${size}]`, isOpen: size > 0 ? open : undefined, line: node.line })
      if (!open) return
      if (node.kind === 'object') for (const one of node.entries) walk(one.node, childPath(path, one.key), one.key, depth + 1)
      else node.items.forEach((one, i) => walk(one, childPath(path, i), String(i), depth + 1))
      return
    }
    const text = node.kind === 'string' ? JSON.stringify(node.text) : node.text
    rows.push({ path, depth, key: name, kind: node.kind, text: oneLine(text), line: node.line })
  }
  if (root.kind === 'object') for (const one of root.entries) walk(one.node, childPath('', one.key), one.key, 0)
  else if (root.kind === 'array') root.items.forEach((one, i) => walk(one, childPath('', i), String(i), 0))
  else walk(root, '', '', 0)
  return rows
}
