import { markdownHeadings } from './markdown'
import { oneLine } from './safe'

// One entry of a file's outline: a symbol or a heading, the lines it spans
// (1-based, `end` inclusive) and how deep it sits.
export type OutlineEntry = { line: number; end: number; depth: number; name: string; kind: OutlineKind }
export type OutlineKind = 'heading' | 'function' | 'class' | 'type' | 'const' | 'method' | 'module'

type Rule = { pattern: RegExp; kind: OutlineKind }

const ID = '[A-Za-z_$][\\w$]*'
// Words that open a block like a method does, but are not one.
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'constructor'])

const SCRIPT: Rule[] = [
  { pattern: new RegExp(`^(\\s*)(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})`), kind: 'function' },
  { pattern: new RegExp(`^(\\s*)(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${ID})`), kind: 'class' },
  { pattern: new RegExp(`^(\\s*)(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum)\\s+(${ID})`), kind: 'type' },
  { pattern: new RegExp(`^()(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${ID})\\s*(?::[^=]*)?=>`), kind: 'function' },
  { pattern: new RegExp(`^()export\\s+(?:const|let|var)\\s+(${ID})`), kind: 'const' },
  {
    pattern: new RegExp(`^(\\s+)(?:(?:public|private|protected|static|async|readonly|override|get|set)\\s+)*\\*?(${ID})\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^{;]*)?\\{\\s*$`),
    kind: 'method',
  },
]

const PYTHON: Rule[] = [
  { pattern: /^(\s*)(?:async\s+)?def\s+(\w+)/, kind: 'function' },
  { pattern: /^(\s*)class\s+(\w+)/, kind: 'class' },
]

const GO: Rule[] = [
  { pattern: /^()func\s+(\([^)]*\)\s*\w+|\w+)/, kind: 'function' },
  { pattern: /^()type\s+(\w+)/, kind: 'type' },
]

const RUST: Rule[] = [
  { pattern: /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/, kind: 'function' },
  { pattern: /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|union|trait|type)\s+(\w+)/, kind: 'type' },
  { pattern: /^(\s*)(?:unsafe\s+)?impl(?:<[^>]*>)?\s+([^{]+?)\s*(?:where\b[^{]*)?\{?\s*$/, kind: 'class' },
  { pattern: /^(\s*)(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/, kind: 'module' },
]

const RULES: Record<string, Rule[]> = {
  ts: SCRIPT, tsx: SCRIPT, mts: SCRIPT, cts: SCRIPT, js: SCRIPT, jsx: SCRIPT, mjs: SCRIPT, cjs: SCRIPT,
  py: PYTHON, pyi: PYTHON,
  go: GO,
  rs: RUST,
}

const MARKDOWN = new Set(['md', 'markdown', 'mdx'])

// Whether a file of this name gets an outline at all.
export function hasOutline(path: string): boolean {
  const ext = extension(path)
  return MARKDOWN.has(ext) || ext in RULES
}

// The outline of a file: headings for markdown, symbols found line by line
// for the languages above (no parser, so a first cut, not a language server).
export function outlineOf(path: string, text: string, limit = 500): OutlineEntry[] {
  const ext = extension(path)
  const lines = text.split('\n')
  if (MARKDOWN.has(ext)) {
    const headings = markdownHeadings(text).slice(0, limit)
    const top = Math.min(...headings.map(one => one.level))
    return withEnds(
      headings.map(one => ({ line: one.line, end: 0, depth: one.level - top, name: oneLine(one.text), kind: 'heading' as const })),
      lines,
      BLANK,
    )
  }
  const rules = RULES[ext]
  if (rules === undefined) return []
  const found: { line: number; indent: number; name: string; kind: OutlineKind }[] = []
  let comment = false
  for (let i = 0; i < lines.length && found.length < limit; i++) {
    const line = lines[i] ?? ''
    // Block comments hold code-like prose; skip them.
    if (comment) {
      if (line.includes('*/')) comment = false
      continue
    }
    if (rules === SCRIPT && /^\s*\/\*/.test(line) && !line.includes('*/')) {
      comment = true
      continue
    }
    for (const rule of rules) {
      const match = rule.pattern.exec(line)
      if (match === null) continue
      const name = (match[2] ?? '').replace(/\s+/g, ' ').trim()
      if (rule.kind === 'method' && NOT_METHODS.has(name)) continue
      found.push({ line: i + 1, indent: indentOf(match[1] ?? ''), name: oneLine(name), kind: rule.kind })
      break
    }
  }
  // Depth from indentation: each distinct indent seen is a level.
  const levels = [...new Set(found.map(one => one.indent))].sort((a, b) => a - b)
  return withEnds(
    found.map(one => ({ line: one.line, end: 0, depth: levels.indexOf(one.indent), name: one.name, kind: one.kind })),
    lines,
    TRAILER,
    found.map(one => one.indent),
  )
}

// What closes a span without belonging to it: blank lines, and in code the
// comments, decorators and attributes that open the next symbol.
const BLANK = /^\s*$/
const TRAILER = /^\s*(?:$|\/\/|\/\*|\*|#|@)/

// Each entry runs to the line before the next at its depth or shallower,
// else to the end, less the trailing lines `trailer` matches. With
// `indents`, an indented symbol (a method) also ends where its block does:
// before the first line indented less than it.
function withEnds(entries: OutlineEntry[], lines: string[], trailer: RegExp, indents?: number[]): OutlineEntry[] {
  return entries.map((entry, i) => {
    const next = entries.slice(i + 1).find(one => one.depth <= entry.depth)
    let end = next === undefined ? lines.length : next.line - 1
    const indent = indents?.[i] ?? 0
    if (indent > 0) {
      for (let at = entry.line + 1; at <= end; at++) {
        const line = lines[at - 1] ?? ''
        if (line.trim() !== '' && indentOf(/^\s*/.exec(line)?.[0] ?? '') < indent) {
          end = at - 1
          break
        }
      }
    }
    while (end > entry.line) {
      const line = lines[end - 1] ?? ''
      // A block comment closing the span goes whole, whatever its body says.
      if (trailer === TRAILER && /\*\/\s*$/.test(line)) {
        while (end > entry.line && !(lines[end - 1] ?? '').includes('/*')) end--
        if (end > entry.line) end--
        continue
      }
      if (!trailer.test(line)) break
      end--
    }
    return { ...entry, end }
  })
}

function indentOf(lead: string): number {
  let cells = 0
  for (const char of lead) cells += char === '\t' ? 4 : 1
  return cells
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}
