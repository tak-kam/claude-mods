export type IconStyle = 'emoji' | 'nerd' | 'ascii'

export type Icon = { glyph: string; color?: string }

type Entry = { emoji: string; nerd: string; color: string }

// By file name first, then by extension; Nerd Font glyphs follow the
// seti / vscode-icons look, coloured as VS Code draws them.
const BY_NAME: Record<string, Entry> = {
  'package.json': { emoji: '📦', nerd: '', color: 'red' },
  'package-lock.json': { emoji: '🔒', nerd: '', color: 'red' },
  'pnpm-lock.yaml': { emoji: '🔒', nerd: '', color: 'yellow' },
  'yarn.lock': { emoji: '🔒', nerd: '', color: 'blue' },
  'bun.lockb': { emoji: '🔒', nerd: '', color: 'white' },
  'Cargo.toml': { emoji: '📦', nerd: '', color: 'red' },
  'go.mod': { emoji: '📦', nerd: '', color: 'cyan' },
  Dockerfile: { emoji: '🐳', nerd: '', color: 'blue' },
  'docker-compose.yml': { emoji: '🐳', nerd: '', color: 'blue' },
  Makefile: { emoji: '🔨', nerd: '', color: 'white' },
  LICENSE: { emoji: '📜', nerd: '', color: 'yellow' },
  'README.md': { emoji: '📖', nerd: '', color: 'blue' },
  'CLAUDE.md': { emoji: '🤖', nerd: '', color: 'magenta' },
  '.gitignore': { emoji: '🙈', nerd: '', color: 'red' },
  '.gitattributes': { emoji: '🙈', nerd: '', color: 'red' },
  '.env': { emoji: '🔑', nerd: '', color: 'yellow' },
  'tsconfig.json': { emoji: '🔧', nerd: '', color: 'blue' },
}

const BY_EXT: Record<string, Entry> = {
  ts: { emoji: '📘', nerd: '', color: 'blue' },
  tsx: { emoji: '🧩', nerd: '', color: 'cyan' },
  mts: { emoji: '📘', nerd: '', color: 'blue' },
  cts: { emoji: '📘', nerd: '', color: 'blue' },
  js: { emoji: '📒', nerd: '', color: 'yellow' },
  jsx: { emoji: '🧩', nerd: '', color: 'cyan' },
  mjs: { emoji: '📒', nerd: '', color: 'yellow' },
  cjs: { emoji: '📒', nerd: '', color: 'yellow' },
  json: { emoji: '🔧', nerd: '', color: 'yellow' },
  jsonc: { emoji: '🔧', nerd: '', color: 'yellow' },
  yaml: { emoji: '🔧', nerd: '', color: 'magenta' },
  yml: { emoji: '🔧', nerd: '', color: 'magenta' },
  toml: { emoji: '🔧', nerd: '', color: 'gray' },
  md: { emoji: '📝', nerd: '', color: 'blue' },
  mdx: { emoji: '📝', nerd: '', color: 'yellow' },
  txt: { emoji: '📄', nerd: '', color: 'white' },
  py: { emoji: '🐍', nerd: '', color: 'yellow' },
  rs: { emoji: '🦀', nerd: '', color: 'red' },
  go: { emoji: '🐹', nerd: '', color: 'cyan' },
  rb: { emoji: '💎', nerd: '', color: 'red' },
  java: { emoji: '☕', nerd: '', color: 'red' },
  kt: { emoji: '🟣', nerd: '', color: 'magenta' },
  swift: { emoji: '🐦', nerd: '', color: 'red' },
  c: { emoji: '🔵', nerd: '', color: 'blue' },
  h: { emoji: '🔵', nerd: '', color: 'magenta' },
  cpp: { emoji: '🔵', nerd: '', color: 'blue' },
  cs: { emoji: '🟪', nerd: '\u{f031b}', color: 'green' },
  php: { emoji: '🐘', nerd: '', color: 'magenta' },
  html: { emoji: '🌐', nerd: '', color: 'red' },
  css: { emoji: '🎨', nerd: '', color: 'blue' },
  scss: { emoji: '🎨', nerd: '', color: 'magenta' },
  vue: { emoji: '💚', nerd: '', color: 'green' },
  svelte: { emoji: '🧡', nerd: '', color: 'red' },
  sh: { emoji: '🐚', nerd: '', color: 'green' },
  bash: { emoji: '🐚', nerd: '', color: 'green' },
  zsh: { emoji: '🐚', nerd: '', color: 'green' },
  ps1: { emoji: '🐚', nerd: '', color: 'blue' },
  sql: { emoji: '💾', nerd: '', color: 'yellow' },
  csv: { emoji: '📊', nerd: '', color: 'green' },
  lock: { emoji: '🔒', nerd: '', color: 'gray' },
  png: { emoji: '🌅', nerd: '', color: 'magenta' },
  jpg: { emoji: '🌅', nerd: '', color: 'magenta' },
  jpeg: { emoji: '🌅', nerd: '', color: 'magenta' },
  gif: { emoji: '🌅', nerd: '', color: 'magenta' },
  webp: { emoji: '🌅', nerd: '', color: 'magenta' },
  svg: { emoji: '🌅', nerd: '\u{f0721}', color: 'yellow' },
  ico: { emoji: '🌅', nerd: '', color: 'magenta' },
  pdf: { emoji: '📕', nerd: '', color: 'red' },
  zip: { emoji: '🧳', nerd: '', color: 'yellow' },
  gz: { emoji: '🧳', nerd: '', color: 'yellow' },
  ipynb: { emoji: '📓', nerd: '', color: 'yellow' },
  log: { emoji: '📃', nerd: '', color: 'gray' },
}

const FILE: Entry = { emoji: '📄', nerd: '', color: 'gray' }

const FOLDER_COLOR = 'blue'

// Folders whose names VS Code themes draw with an icon of their own.
const SPECIAL_DIRS: Record<string, { emoji: string; nerd: string }> = {
  '.github': { emoji: '🐙', nerd: '' },
  '.git': { emoji: '🙈', nerd: '' },
  node_modules: { emoji: '📦', nerd: '' },
  src: { emoji: '📁', nerd: '\u{f08de}' },
  test: { emoji: '🧪', nerd: '\u{f0668}' },
  tests: { emoji: '🧪', nerd: '\u{f0668}' },
  docs: { emoji: '📚', nerd: '\u{f0dbf}' },
  '.claude': { emoji: '🤖', nerd: '' },
  '.claude-plugin': { emoji: '🤖', nerd: '' },
}

function entryFor(name: string): Entry {
  const exact = BY_NAME[name]
  if (exact !== undefined) return exact
  if (name.startsWith('.env')) return BY_NAME['.env'] ?? FILE
  if (/^Dockerfile/.test(name)) return BY_NAME.Dockerfile ?? FILE
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return FILE
  const ext = name.slice(dot + 1).toLowerCase()
  if (name.endsWith('.d.ts')) return BY_EXT.ts ?? FILE
  return BY_EXT[ext] ?? FILE
}

// Every glyph returned is followed by one space, so names line up.
export function iconFor(name: string, isDir: boolean, isOpen: boolean, style: IconStyle): Icon {
  if (style === 'ascii') return isDir ? { glyph: '', color: FOLDER_COLOR } : { glyph: '· ' }
  if (isDir) {
    const special = SPECIAL_DIRS[name]
    if (style === 'nerd') {
      return { glyph: `${special?.nerd ?? (isOpen ? '' : '')} `, color: FOLDER_COLOR }
    }
    return { glyph: `${special?.emoji ?? (isOpen ? '📂' : '📁')} ` }
  }
  const entry = entryFor(name)
  return style === 'nerd' ? { glyph: `${entry.nerd} `, color: entry.color } : { glyph: `${entry.emoji} ` }
}

// Terminal cells a glyph takes: emoji draw two cells, Nerd Font glyphs one.
export function iconWidth(icon: Icon, style: IconStyle): number {
  if (icon.glyph === '') return 0
  return style === 'emoji' ? 3 : 2
}
