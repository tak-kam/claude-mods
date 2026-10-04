// Mermaid diagrams, drawn by the person's own mermaid-cli (`mmdc`) when it
// is installed: never installed or fetched here. This module holds the pure
// parts: which blocks are diagrams, their cache names, mmdc's arguments.

// The largest diagram source handed to mmdc.
export const MAX_DIAGRAM_CHARS = 50000

export function isMermaid(language: string): boolean {
  return /^(mermaid|mmd)$/i.test(language.trim())
}

// FNV-1a over the text, twice with different seeds: a cache name, not a
// security check (the file is ours, in a folder only the person can write).
export function diagramKey(source: string): string {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x01000193) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${source.length.toString(16)}`
}

// Where the drawings are kept, per person: XDG's cache, else the home's
// .cache, else Windows' local app data.
export function cacheFolder(env: { xdg?: string; home?: string; localAppData?: string }, kind = 'mermaid'): string | undefined {
  if (env.xdg !== undefined && env.xdg.startsWith('/')) return `${env.xdg}/claude-file-explorer/${kind}`
  if (env.localAppData !== undefined && env.localAppData !== '') return `${env.localAppData.replace(/\\/g, '/')}/claude-file-explorer/${kind}`
  if (env.home !== undefined && env.home !== '') return `${env.home.replace(/\\/g, '/')}/.cache/claude-file-explorer/${kind}`
  return undefined
}

// mmdc reading the diagram from standard input and writing one picture: a
// PNG (scaled up for a crisp terminal picture) or an SVG, on white so it
// reads on a dark terminal too.
export function mmdcArgs(output: string, format: 'png' | 'svg'): string[] {
  const args = ['mmdc', '--quiet', '--input', '-', '--output', output, '--backgroundColor', 'white']
  if (format === 'png') args.push('--scale', '2')
  return args
}

// mmdc's complaint, the parse error and what it expected, not the stack.
export function mmdcError(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line !== '' && !/^at\s/.test(line))
  const at = lines.findIndex(line => /error/i.test(line))
  const head = (lines[at] ?? lines[0] ?? 'mmdc failed').replace(/^Error:\s*/, '')
  const expected = lines.slice(at + 1).find(line => /^Expecting\b/.test(line))
  const said = expected === undefined ? head : `${head} ${expected}`
  return said.length > 200 ? `${said.slice(0, 199)}…` : said
}
