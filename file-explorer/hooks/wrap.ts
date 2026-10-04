import { cellWidth } from './markdown'

// How long lines are shown in the preview: wrapped under the gutter (the
// default), or cut at the edge and scrolled sideways. A window over
// wrapped lines must count the rows each line takes, not the lines, or it
// overflows the pane.

const TAB = 4

export function expandTabs(line: string): string {
  if (!line.includes('\t')) return line
  let out = ''
  for (const char of line) {
    out += char === '\t' ? ' '.repeat(TAB - (cellWidth(out) % TAB)) : char
  }
  return out
}

// Rows a line takes when wrapped into `room` cells; one at least.
export function rowsOf(line: string, room: number): number {
  return Math.max(1, Math.ceil(cellWidth(expandTabs(line)) / Math.max(1, room)))
}

// How many units from `from` fit `room` rows, each unit costing its rows:
// one at least, so a window always moves.
export function fitCount(costs: readonly number[], from: number, room: number): number {
  let used = 0
  let count = 0
  for (let i = from; i < costs.length; i++) {
    const cost = costs[i] ?? 1
    if (count > 0 && used + cost > room) break
    used += cost
    count++
  }
  return count
}

// The last start whose window still reaches the end: the furthest a scroll
// may go so the final unit shows, wrapped or not.
export function lastStart(costs: readonly number[], room: number): number {
  let used = 0
  let start = costs.length
  while (start > 0) {
    const cost = costs[start - 1] ?? 1
    if (used + cost > room && start < costs.length) break
    used += cost
    start--
  }
  return start
}

// The line with its first `cells` cells dropped, for sideways scrolling.
export function shiftCells(line: string, cells: number): string {
  if (cells <= 0) return line
  let used = 0
  let at = 0
  const text = expandTabs(line)
  for (const char of text) {
    if (used >= cells) break
    used += cellWidth(char)
    at += char.length
  }
  return text.slice(at)
}

// The widest line, in cells: whether sideways scrolling has anywhere to go.
export function widest(lines: readonly string[]): number {
  let most = 0
  for (const line of lines) most = Math.max(most, cellWidth(expandTabs(line)))
  return most
}

// Cells a Button takes on the terminal: a hotkey is drawn before a plain
// label as `w: ↩`. Symbols outside ASCII count two, since terminals set to
// East Asian ambiguous-wide draw ▲ ↩ ❝ that way.
export function buttonCells(label: string, hasHotkey: boolean): number {
  let cells = 0
  for (const char of label) cells += char.charCodeAt(0) < 0x80 ? 1 : Math.max(2, cellWidth(char))
  return cells + (hasHotkey ? 3 : 0)
}

// Items packed into rows of `room` cells with one-cell gaps, in order: a
// toolbar laid out the way it will draw, so no Button falls off the edge
// (a Button not drawn has no hotkey).
export function packRows<T extends { cells: number }>(items: readonly T[], room: number): T[][] {
  const rows: T[][] = []
  let row: T[] = []
  let used = 0
  for (const item of items) {
    const need = row.length === 0 ? item.cells : used + 1 + item.cells
    if (row.length > 0 && need > room) {
      rows.push(row)
      row = [item]
      used = item.cells
    } else {
      row.push(item)
      used = need
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}
