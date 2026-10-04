// What reaches the terminal from a repository: file names, file contents,
// commit messages, search hits. Any of them can carry escape sequences (a
// window title, a clipboard write) or bidi overrides that reorder how code
// reads (Trojan Source), so none is drawn as it came.

// C0 and C1 controls and DEL; tab and newline are kept where text is
// multi-line.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const LINE_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

// Explicit bidi embeddings, overrides and isolates: made visible, never
// applied, so a reviewer sees the text in the order the compiler does.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g

// Multi-line text for Code and Markdown: CRLF folded, controls dropped,
// bidi controls shown as U+FFFD.
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(BIDI, '\ufffd')
}

// A single line for a label: every control, tab and newline included, shown
// as `?`, bidi controls as U+FFFD.
export function oneLine(text: string): string {
  return text.replace(LINE_CONTROLS, '?').replace(BIDI, '\ufffd')
}

// A search hit's line: as oneLine, but tabs kept for the excerpt to expand.
export function hitLine(text: string): string {
  return text.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, '?').replace(BIDI, '\ufffd')
}

// A path relative to the root with no `.` or `..` segment: what a tool's
// path must come to before the explorer acts on it.
export function isPlainRelative(rel: string): boolean {
  return rel !== '' && !rel.startsWith('/') && rel.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
