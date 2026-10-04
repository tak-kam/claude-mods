import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import type {
  ExplorerBase,
  ExplorerChange,
  ExplorerCommit,
  ExplorerEntry,
  ExplorerMode,
  ExplorerHit,
  ExplorerSearch,
  ExplorerPreview,
  ExplorerView,
} from '../types'
import { iconFor, iconWidth } from './icons'
import { compileQuery, excerpt, fuzzyFilter, fuzzyIndex, matchSpan, parseGrep } from './search'
import { cellWidth, fitCells, localLinks, markdownWindow, resolveLink, splitMarkdown } from './markdown'
import { clipDiff, hunkOffset, parseLog, parseNameStatus, sliceHunk, splitHunks } from './diff'
import { cleanText, isPlainRelative, oneLine } from './safe'
import { fitCount, lastStart, rowsOf, shiftCells, widest } from './wrap'
import type { IconStyle } from './icons'

const EXPLORER = 'file-explorer'
const PREVIEW = 'file-preview'

const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const EDITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAX_ROWS = 1500
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_CODE_CHARS = 10000
const MAX_COMMITS = 100
// The explorer splits into a sidebar and a preview from this many columns.
const SPLIT_MIN_COLUMNS = 80
const SPLIT_COLUMNS = 110
const WHEEL_ROWS = 3
const MAX_FILE_RESULTS = 300
const MAX_HITS = 500
const MAX_INDEX = 200000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const HEAD: ExplorerBase = { ref: 'HEAD', label: 'HEAD' }

const root = atom({ plugin: 'file-explorer', key: 'root' } as const, '')
const view = atom({ plugin: 'file-explorer', key: 'view' } as const, 'files')
const base = atom({ plugin: 'file-explorer', key: 'base' } as const, HEAD)
const expanded = atom({ plugin: 'file-explorer', key: 'expanded' } as const, [])
const listings = atom({ plugin: 'file-explorer', key: 'listings' } as const, {})
const changes = atom({ plugin: 'file-explorer', key: 'changes' } as const, [])
const history = atom({ plugin: 'file-explorer', key: 'history' } as const, [])
const gitError = atom({ plugin: 'file-explorer', key: 'gitError' } as const, '')
const touched = atom({ plugin: 'file-explorer', key: 'touched' } as const, [])
const selected = atom({ plugin: 'file-explorer', key: 'selected' } as const, '')
const preview = atom({ plugin: 'file-explorer', key: 'preview' } as const, null)
const NO_SEARCH: ExplorerSearch = {
  mode: 'files',
  query: '',
  isRegex: false,
  isCaseSensitive: false,
  files: [],
  hits: [],
  note: '',
}
const search = atom({ plugin: 'file-explorer', key: 'search' } as const, NO_SEARCH)
const listOffset = atom({ plugin: 'file-explorer', key: 'listOffset' } as const, 0)
const follow = atom({ plugin: 'file-explorer', key: 'follow' } as const, true)
const lastPrompt = atom({ plugin: 'file-explorer', key: 'lastPrompt' } as const, null)
const wrapLines = atom({ plugin: 'file-explorer', key: 'wrapLines' } as const, true)
const sideways = atom({ plugin: 'file-explorer', key: 'sideways' } as const, 0)
const previewOffset = atom({ plugin: 'file-explorer', key: 'previewOffset' } as const, 0)

// The project's file list for name search, read once and dropped on refresh.
const cache: { files?: string[]; lower?: string[]; turnHead?: string; rootReal?: string } = {}

// What the explorer was last drawn as, so presses know where a file shows.
const layout = { isSplit: false, sidebarColumns: 0, listRows: 20, previewRows: 20, listTotal: 0, previewTotal: 0, previewLast: 0, icons: 'emoji' as IconStyle, visible: { start: 0, end: 0 } }

// VS Code's decoration colours, by the letter drawn at the row's end.
const BADGE_COLOR: Record<string, string> = {
  M: 'yellow',
  A: 'green',
  U: 'green',
  D: 'red',
  R: 'cyan',
  C: 'cyan',
  '!': 'magenta',
}
const SEVERITY = ['!', 'D', 'M', 'R', 'C', 'A', 'U']

const join = (dir: string, rel: string) => (rel === '' ? dir : `${dir}/${rel}`)
const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1)

// Every label goes through here, so none carries a control character.
const fit = (raw: string, room: number) => {
  const text = oneLine(raw)
  return room <= 1 ? text.slice(0, Math.max(0, room)) : text.length <= room ? text : `${text.slice(0, room - 1)}…`
}

const sortEntries = (entries: ExplorerEntry[]) =>
  [...entries].sort((a, b) =>
    a.isDir !== b.isDir
      ? a.isDir
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  )

// A repository's own config can name programs git runs on a plain status or
// diff (fsmonitor, external diff, textconv). The explorer runs git unasked,
// so it turns those off on every call; `--no-ext-diff --no-textconv` ride
// on the diffs.
const GIT_SAFETY = ['-c', 'core.fsmonitor=false']

async function git($: EngineInterface, args: string[]) {
  const cwd = await read($, root)
  return $.process
    .run(['git', ...GIT_SAFETY, ...args], { cwd, timeoutMs: 15000 })
    .catch(() => ({ exitCode: -1, stdout: '', stderr: 'git could not run' }))
}

// ---- files ---------------------------------------------------------------

async function loadDir($: EngineInterface, rel: string): Promise<boolean> {
  const entries = await listDir($, rel)
  await update($, listings, all => {
    if (entries !== undefined) return { ...all, [rel]: entries }
    const { [rel]: _gone, ...rest } = all
    return rest
  })
  return entries !== undefined
}

// A folder's entries, sorted, without storing them: refreshAll lists every
// open folder at once and stores the lot in one write, so the pane redraws
// once rather than once per folder.
async function listDir($: EngineInterface, rel: string): Promise<ExplorerEntry[] | undefined> {
  const dir = await read($, root)
  const listed = await $.fs.list(join(dir, rel)).catch(() => undefined)
  if (listed === undefined) return undefined
  const entries: ExplorerEntry[] = []
  for (const one of listed) {
    if (HIDDEN.has(one.name)) continue
    let isDir = one.kind === 'dir'
    if (one.isLink) {
      const target = await $.fs.stat(join(dir, rel === '' ? one.name : `${rel}/${one.name}`)).catch(() => undefined)
      isDir = target?.kind === 'dir'
    }
    entries.push({ name: one.name, isDir, size: one.size })
  }
  return sortEntries(entries)
}

async function toggleDir($: EngineInterface, rel: string) {
  const open = await read($, expanded)
  if (open.includes(rel)) {
    await update($, expanded, list => list.filter(one => one !== rel))
    return
  }
  await loadDir($, rel)
  await update($, expanded, list => (list.includes(rel) ? list : [...list, rel]))
}

// ---- git -----------------------------------------------------------------



// The working tree as a tree object, staged nothing: written through an
// index of the explorer's own, so the person's index and stash are untouched.
async function snapshotTree($: EngineInterface): Promise<string | undefined> {
  const dir = await read($, root)
  const where = await git($, ['rev-parse', '--git-path', 'file-explorer-index'])
  if (where.exitCode !== 0) return undefined
  const path = where.stdout.trim()
  const index = path.startsWith('/') ? path : join(dir, path)
  const env = { GIT_INDEX_FILE: index }
  const inGit = (args: string[]) =>
    $.process
      .run(['git', ...GIT_SAFETY, ...args], { cwd: dir, env, timeoutMs: 20000 })
      .catch(() => ({ exitCode: -1, stdout: '', stderr: '' }))
  // `git add` runs clean filters; one the repository's own config defines
  // (not git-lfs) is a program the snapshot would run unasked, so no snapshot.
  const filters = await git($, ['config', '--local', '--get-regexp', '^filter\\..*\\.(clean|process)$'])
  const isForeign = filters.stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .some(line => !/^\S+\s+git-lfs\s/.test(line))
  if (isForeign) return undefined
  // Seeded from HEAD once; later snapshots reuse its stat cache and stay fast.
  if (!(await $.fs.exists(index))) {
    const head = await git($, ['rev-parse', '--verify', '-q', 'HEAD'])
    if (head.exitCode === 0) await inGit(['read-tree', 'HEAD'])
  }
  if ((await inGit(['add', '-A'])).exitCode !== 0) return undefined
  const tree = await inGit(['write-tree'])
  return tree.exitCode === 0 ? tree.stdout.trim() : undefined
}

// What the base is diffed against: `head`, a fresh snapshot for a turn base,
// or nothing (the working tree).
async function baseHead($: EngineInterface): Promise<string | undefined> {
  const now = await read($, base)
  if (now.kind !== 'turn') return now.head
  cache.turnHead = (await snapshotTree($)) ?? cache.turnHead
  return cache.turnHead
}

async function baseRef($: EngineInterface): Promise<string> {
  const { ref } = await read($, base)
  if (ref !== 'HEAD') return ref
  const head = await git($, ['rev-parse', '--verify', '-q', 'HEAD'])
  return head.exitCode === 0 ? 'HEAD' : EMPTY_TREE
}

async function loadChanges($: EngineInterface) {
  const inside = await git($, ['rev-parse', '--is-inside-work-tree'])
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    await update($, gitError, () => 'Not a git repository')
    await update($, changes, () => [])
    return
  }
  const head = await baseHead($)
  const range = [await baseRef($), ...(head === undefined ? [] : [head])]
  const diff = await git($, ['diff', '--no-ext-diff', '--no-textconv', '--relative', '--name-status', '-z', '-M', ...range])
  if (diff.exitCode !== 0) {
    await update($, gitError, () => fit(diff.stderr.trim() || 'git diff failed', 200))
    await update($, changes, () => [])
    return
  }
  const found = parseNameStatus(diff.stdout)
  if (head === undefined) {
    const others = await git($, ['ls-files', '--others', '--exclude-standard', '-z'])
    for (const path of others.stdout.split('\0')) {
      if (path !== '') found.push({ path, letter: 'U' })
    }
  }
  found.sort((a, b) => a.path.localeCompare(b.path))
  await update($, gitError, () => '')
  await update($, changes, () => found)
}


async function diffOf($: EngineInterface, change: ExplorerChange): Promise<{ diff: string; note: string }> {
  const now = await read($, base)
  const head = now.kind === 'turn' ? cache.turnHead : now.head
  const result =
    change.letter === 'U'
      ? await git($, ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--no-color', '--', '/dev/null', change.path])
      : await git($, [
          'diff', '--no-ext-diff', '--no-textconv', '--relative', '--no-color', '-M', await baseRef($),
          ...(head === undefined ? [] : [head]),
          '--',
          ...(change.from === undefined ? [] : [change.from]),
          change.path,
        ])
  if (result.exitCode !== 0 && result.exitCode !== 1) return { diff: '', note: 'git diff failed' }
  if (/^Binary files /m.test(result.stdout)) return { diff: '', note: 'binary file changed' }
  const renamed = change.from === undefined ? '' : `renamed from ${change.from}`
  const at = result.stdout.indexOf('@@ ')
  if (at < 0) return { diff: '', note: renamed || 'no textual change' }
  const { text, isCut } = clipDiff(cleanText(result.stdout.slice(at)), MAX_CODE_CHARS)
  return { diff: text, note: [renamed, isCut ? 'diff cut to fit' : ''].filter(Boolean).join(' · ') }
}

async function setBase($: EngineInterface, next: ExplorerBase) {
  await update($, base, () => next)
  await loadChanges($)
  await reloadPreview($)
}

async function defaultBranchBase($: EngineInterface): Promise<ExplorerBase | undefined> {
  const remote = await git($, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'])
  const candidates = [remote.stdout.trim(), 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean)
  for (const name of candidates) {
    const merge = await git($, ['merge-base', 'HEAD', name])
    if (merge.exitCode === 0) return { ref: merge.stdout.trim(), label: `${name} (merge-base)` }
  }
  return undefined
}

// HEAD → the last prompt → the default branch's merge-base → HEAD.
async function cycleBase($: EngineInterface) {
  const now = await read($, base)
  const turn = await read($, lastPrompt)
  if (now.ref === 'HEAD' && now.head === undefined && turn !== null) return setBase($, turn)
  if (now.kind === 'turn' || (now.ref === 'HEAD' && now.head === undefined)) {
    const branch = await defaultBranchBase($)
    if (branch !== undefined) return setBase($, branch)
    if (now.kind !== 'turn') $.ui.toast('No main or master branch to compare with')
  }
  await setBase($, HEAD)
}

// Taken as each prompt is sent, so the changes a turn made can be shown alone.
async function snapshotPrompt($: EngineInterface) {
  const tree = await snapshotTree($)
  if (tree === undefined) return
  const at = new Date(await $.clock.now())
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const turn: ExplorerBase = { ref: tree, label: `last prompt (${time})`, kind: 'turn' }
  await update($, lastPrompt, () => turn)
  cache.turnHead = tree
  if ((await read($, base)).kind === 'turn') await update($, base, () => turn)
}

async function resolveCommit($: EngineInterface, name: string): Promise<string | undefined> {
  const found = await git($, ['rev-parse', '--verify', '-q', `${name}^{commit}`])
  return found.exitCode === 0 ? found.stdout.trim() : undefined
}

async function chooseBase($: EngineInterface, typed: string) {
  const name = typed.trim()
  if (name === '' || name === 'HEAD') return setBase($, HEAD)
  // A ref is never an option: refuse what git would read as one.
  if (name.split(/\.\.\.?/).some(part => part.startsWith('-'))) {
    $.ui.toast(`Not a ref: ${oneLine(name)}`)
    return
  }
  if (name === 'turn' || name === 'prompt') {
    const turn = await read($, lastPrompt)
    if (turn === null) $.ui.toast('No prompt sent yet this session')
    else await setBase($, turn)
    return
  }
  const range = /^(.+?)\.\.(\.?)(.+)$/.exec(name)
  if (range !== null) {
    const [, from = '', isThreeDot, to = ''] = range
    const head = await resolveCommit($, to)
    let ref = await resolveCommit($, from)
    if (ref !== undefined && head !== undefined && isThreeDot === '.') {
      const merge = await git($, ['merge-base', ref, head])
      ref = merge.exitCode === 0 ? merge.stdout.trim() : undefined
    }
    if (ref === undefined || head === undefined) $.ui.toast(`Unknown range: ${oneLine(name)}`)
    else await setBase($, { ref, head, label: name })
    return
  }
  const found = await git($, ['rev-parse', '--verify', '-q', `${name}^{commit}`])
  if (found.exitCode !== 0) $.ui.toast(`Unknown ref: ${oneLine(name)}`)
  else await setBase($, { ref: found.stdout.trim(), label: name })
}


async function loadHistory($: EngineInterface) {
  const log = await git($, [
    'log', `-n${MAX_COMMITS}`, '--no-color',
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1e',
  ])
  await update($, history, () => (log.exitCode === 0 ? parseLog(log.stdout) : []))
}

// A commit's own changes: its first parent (or the empty tree) against it.
async function openCommit($: EngineInterface, commit: ExplorerCommit) {
  const parent = await git($, ['rev-parse', '--verify', '-q', `${commit.sha}^`])
  const ref = parent.exitCode === 0 ? parent.stdout.trim() : EMPTY_TREE
  await setBase($, { ref, head: commit.sha, label: `${commit.short} ${commit.subject}` })
  await update($, view, () => 'changes' as const)
}

// ---- search --------------------------------------------------------------

async function run($: EngineInterface, argv: string[]) {
  const cwd = await read($, root)
  return $.process
    .run(argv, { cwd, timeoutMs: 20000 })
    .catch(() => ({ exitCode: -1, stdout: '', stderr: `${argv[0]} could not run` }))
}

// Files as ripgrep lists them (ignore files honoured, hidden ones kept but
// .git), else as git does, untracked included.
async function fileIndex($: EngineInterface): Promise<string[]> {
  if (cache.files !== undefined) return cache.files
  const listed = await run($, ['rg', '--files', '--hidden', '--glob', '!.git', '--null'])
  const raw =
    listed.exitCode === 0
      ? listed.stdout
      : (await git($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).stdout
  cache.files = raw.split('\0').filter(path => path !== '').slice(0, MAX_INDEX)
  cache.lower = fuzzyIndex(cache.files)
  return cache.files
}

async function searchFiles($: EngineInterface, query: string) {
  const files = query.trim() === '' ? [] : fuzzyFilter(await fileIndex($), query, MAX_FILE_RESULTS, cache.lower)
  const note = query.trim() === '' ? '' : files.length === 0 ? 'No files match.' : `${files.length}${files.length >= MAX_FILE_RESULTS ? '+' : ''} files`
  await update($, search, now => ({ ...now, mode: 'files' as const, query, files, note }))
  await update($, listOffset, () => 0)
}

async function searchText($: EngineInterface, query: string) {
  const now = await read($, search)
  if (query.trim() === '') {
    await update($, search, was => ({ ...was, mode: 'text' as const, query, hits: [], note: '' }))
    return
  }
  await update($, search, was => ({ ...was, mode: 'text' as const, query, note: 'Searching…' }))
  const flags = now.isCaseSensitive ? ['--case-sensitive'] : ['--ignore-case']
  let result = await run($, [
    'rg', '--null', '--line-number', '--column', '--no-heading', '--color', 'never',
    '--max-columns', '400', '--max-columns-preview', '--max-count', '100',
    '--hidden', '--glob', '!.git', ...flags, ...(now.isRegex ? [] : ['--fixed-strings']), '-e', query,
  ])
  let tool = 'rg'
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    tool = 'git grep'
    result = await git($, [
      'grep', '--no-textconv', '-z', '-n', '--column', '-I', '--untracked',
      ...(now.isCaseSensitive ? [] : ['-i']), now.isRegex ? '-E' : '-F', '-e', query,
    ])
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    const reason = result.stderr.trim().split('\n')[0] ?? ''
    await update($, search, was => ({ ...was, hits: [], note: fit(`${tool} failed: ${reason}`, 200) }))
    return
  }
  const hits = parseGrep(result.stdout, MAX_HITS)
  const files = new Set(hits.map(hit => hit.path)).size
  const note =
    hits.length === 0
      ? 'No matches.'
      : `${hits.length}${hits.length >= MAX_HITS ? '+' : ''} matches in ${files} file${files === 1 ? '' : 's'}`
  await update($, search, was => ({ ...was, hits, note }))
  await update($, listOffset, () => 0)
}

async function toggleSearchFlag($: EngineInterface, flag: 'isRegex' | 'isCaseSensitive') {
  await update($, search, now => ({ ...now, [flag]: !now[flag] }))
  const now = await read($, search)
  if (now.mode === 'text' && now.query.trim() !== '') await searchText($, now.query)
}

async function openHit($: EngineInterface, hit: ExplorerHit) {
  await showPath($, hit.path, { mode: 'file' })
  await update($, previewOffset, () => Math.max(0, hit.line - 4))
}

// ---- preview -------------------------------------------------------------

async function fileText($: EngineInterface, rel: string, _size?: number) {
  const dir = await read($, root)
  // Where the path really lands: a link out of the project (to ~/.ssh, say)
  // is named, never read into the pane.
  const stat = await $.fs.stat(join(dir, rel), { resolve: true }).catch(() => undefined)
  if (stat === undefined) return { text: '', note: 'not on disk', isOnDisk: false }
  cache.rootReal ??= (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath ?? dir
  const real = stat.realPath ?? ''
  if (real !== cache.rootReal && !real.startsWith(`${cache.rootReal}/`)) {
    return { text: '', note: `links outside the project: ${oneLine(real || 'unresolved')}`, isOnDisk: false }
  }
  const bytes = stat.size
  if (bytes > MAX_PREVIEW_BYTES) {
    return { text: '', note: `${Math.round(bytes / 1024)} KiB: too large to preview`, isOnDisk: true }
  }
  const text = await $.fs.read(join(dir, rel)).catch(() => undefined)
  if (text === undefined) return { text: '', note: 'could not be read', isOnDisk: false }
  if (text.includes('\0')) return { text: '', note: 'binary file', isOnDisk: true }
  const clean = cleanText(text)
  if (clean.length <= MAX_CODE_CHARS) return { text: clean, note: '', isOnDisk: true }
  const cut = clean.lastIndexOf('\n', MAX_CODE_CHARS) + 1 || MAX_CODE_CHARS
  return { text: clean.slice(0, cut), note: 'preview cut at 10000 characters', isOnDisk: true }
}

const isMarkdown = (rel: string) => /\.(md|mdx|markdown)$/i.test(rel)

// What a file opens as from the tree: markdown rendered, the rest as source.
const fileMode = (rel: string): ExplorerMode => (isMarkdown(rel) ? 'rendered' : 'file')

async function showPath($: EngineInterface, rel: string, options: { mode?: ExplorerMode; size?: number } = {}) {
  await update($, selected, () => rel)
  const change = (await read($, changes)).find(one => one.path === rel)
  const now = await read($, base)
  const isInRange = change !== undefined && now.head !== undefined && now.kind !== 'turn'
  const file =
    change?.letter === 'D'
      ? { text: '', note: 'deleted', isOnDisk: false }
      : isInRange
        ? { text: '', note: '', isOnDisk: false }
        : await fileText($, rel, options.size)
  const diff = change === undefined ? { diff: '', note: '' } : await diffOf($, change)
  const asked = options.mode ?? (change === undefined ? fileMode(rel) : 'diff')
  const wanted = asked === 'rendered' && !isMarkdown(rel) ? 'file' : asked
  const mode = change === undefined ? (wanted === 'diff' ? fileMode(rel) : wanted) : file.isOnDisk ? wanted : 'diff'
  const shown: ExplorerPreview = {
    path: rel,
    mode,
    text: file.text,
    diff: diff.diff,
    note: mode === 'diff' ? diff.note : file.note,
    isChanged: change !== undefined,
    isOnDisk: file.isOnDisk,
  }
  const before = await read($, preview)
  if (before === null || before.path !== rel || before.mode !== mode) {
    await update($, previewOffset, () => 0)
    await update($, sideways, () => 0)
  }
  await update($, preview, () => shown)
  await reveal($, rel)
  if (!layout.isSplit) await $.ui.open({ id: PREVIEW, title: baseName(rel) })
}

// Scrolls the sidebar so the row of `rel` is in its window.
async function reveal($: EngineInterface, rel: string) {
  const current = await read($, view)
  let at = -1
  if (current === 'changes') at = (await read($, changes)).findIndex(one => one.path === rel)
  if (current === 'files') {
    at = flatten(await read($, listings), new Set(await read($, expanded))).findIndex(row => row.rel === rel)
  }
  if (at < 0) return
  await update($, listOffset, offset =>
    at < offset ? at : at >= offset + layout.listRows ? at - layout.listRows + 1 : offset,
  )
}

async function reloadPreview($: EngineInterface) {
  const shown = await read($, preview)
  if (shown === null) return
  const isOpen = !layout.isSplit && (await $.ui.panes()).some(pane => pane.id === PREVIEW)
  const isSplitOpen = layout.isSplit && (await $.ui.panes()).some(pane => pane.id === EXPLORER)
  if (isOpen || isSplitOpen) {
    const offset = await read($, previewOffset)
    await showPath($, shown.path, { mode: shown.mode })
    await update($, previewOffset, () => offset)
  }
}

async function mention($: EngineInterface, rel: string) {
  const { text, cursor } = await $.prompt.read()
  const before = text.slice(0, cursor)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const filled = await $.prompt.fill({ text: `${lead}@${rel} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not insert @${oneLine(rel)}`)
}

async function quote($: EngineInterface, text: string, caption: string, language: string) {
  const fence = text.includes('```') ? '````' : '```'
  const { text: draft, cursor } = await $.prompt.read()
  const lead = draft.slice(0, cursor).trim() === '' ? '' : '\n'
  const block = `${lead}${caption}:\n${fence}${language}\n${text.trimEnd()}\n${fence}\n`
  const filled = await $.prompt.fill({ text: block, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast('Could not quote into the prompt')
}

async function quoteSelection($: EngineInterface, path: string) {
  const shown = await read($, preview)
  const picked = await $.ui.selection()
  if (picked === undefined || picked.text.trim() === '') {
    $.ui.toast('Select lines with the mouse first, or quote a hunk')
    return
  }
  const lines = shown === null || shown.path !== path || shown.mode === 'diff' ? { start: 0, end: 0 } : await pickedLines($, shown)
  const label = linesLabel(lines.start, lines.end)
  await quote($, picked.text, `\`${path}\` ${label === '' ? '(selected)' : label}`, '')
}



async function refreshAll($: EngineInterface) {
  const open = await read($, expanded)
  const folders = ['', ...open]
  const listed = await Promise.all(folders.map(rel => listDir($, rel)))
  const next: Record<string, ExplorerEntry[]> = {}
  folders.forEach((rel, i) => {
    const entries = listed[i]
    if (entries !== undefined) next[rel] = entries
  })
  await update($, listings, () => next)
  const kept = open.filter(rel => next[rel] !== undefined)
  if (kept.length !== open.length) await update($, expanded, () => kept)
  cache.files = undefined
  cache.lower = undefined
  await loadChanges($)
  await loadHistory($)
  await reloadPreview($)
}

async function openExplorer($: EngineInterface, wanted: string) {
  if (wanted === 'files' || wanted === 'changes' || wanted === 'history' || wanted === 'search') await update($, view, () => wanted as ExplorerView)
  await refreshAll($)
  return $.ui.open({ id: EXPLORER, title: 'Explorer', focus: true, columns: SPLIT_COLUMNS })
}

// ---- drawing helpers -----------------------------------------------------

type Row = { rel: string; depth: number; entry: ExplorerEntry }

function flatten(all: Record<string, ExplorerEntry[]>, open: Set<string>): Row[] {
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of all[dir] ?? []) {
      if (rows.length >= MAX_ROWS) return
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
      rows.push({ rel, depth, entry })
      if (entry.isDir && open.has(rel)) walk(rel, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

// A folder shows the most severe letter among the changes beneath it.
function folderBadges(list: ExplorerChange[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { path, letter } of list) {
    for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) {
      const had = out[dir]
      if (had === undefined || SEVERITY.indexOf(letter) < SEVERITY.indexOf(had)) out[dir] = letter
    }
  }
  return out
}



// Opens every folder down to `dir`, so the tree shows where a file is.
async function unfold($: EngineInterface, dir: string) {
  const folders: string[] = []
  for (let up = dir; up !== ''; up = parentOf(up)) folders.unshift(up)
  for (const folder of folders) {
    if (!(await read($, expanded)).includes(folder)) await toggleDir($, folder)
  }
}

async function openLink($: EngineInterface, from: string, href: string) {
  const rel = resolveLink(from, href)
  if (rel === undefined) {
    $.ui.toast(`Outside the project: ${oneLine(href)}`)
    return
  }
  const dir = await read($, root)
  const stat = await $.fs.stat(join(dir, rel)).catch(() => undefined)
  if (stat === undefined) {
    $.ui.toast(`Not found: ${oneLine(rel)}`)
    return
  }
  await unfold($, stat.kind === 'dir' ? rel : parentOf(rel))
  await update($, view, () => 'files' as const)
  if (stat.kind === 'dir') {
    await update($, selected, () => rel)
    await reveal($, rel)
  } else {
    await showPath($, rel, { mode: fileMode(rel), size: stat.size })
  }
}


// ---- following Claude ----------------------------------------------------

const lineOf = (text: string, at: number) => (at < 0 ? 1 : text.slice(0, at).split('\n').length)


// Shows in the preview what Claude just read or wrote: the file at the lines
// it read, or the diff at the hunk it edited. Split view only, so it never
// opens a pane over the person's work.
async function followTool($: EngineInterface, tool: string, args: Record<string, unknown>) {
  if (!layout.isSplit || !(await read($, follow))) return
  if (!(await $.ui.panes()).some(pane => pane.id === EXPLORER && pane.isShown)) return
  const filePath = args.file_path ?? args.notebook_path
  if (typeof filePath !== 'string') return
  const dir = await read($, root)
  const normal = filePath.replace(/\\/g, '/')
  if (!normal.startsWith(`${dir}/`)) return
  const rel = normal.slice(dir.length + 1)
  if (!isPlainRelative(rel)) return
  if ((await read($, view)) === 'files') await unfold($, parentOf(rel))

  if (tool === 'Read') {
    await showPath($, rel, { mode: 'file' })
    const from = typeof args.offset === 'number' ? args.offset : 1
    await update($, previewOffset, () => Math.max(0, from - 1))
    return
  }
  await loadChanges($)
  const edits = Array.isArray(args.edits) ? (args.edits as { new_string?: unknown }[]) : []
  const written = typeof args.new_string === 'string' ? args.new_string : edits[0]?.new_string
  const text = await $.fs.read(join(dir, rel)).catch(() => '')
  const line = typeof written === 'string' && written !== '' ? lineOf(text, text.indexOf(written)) : 1
  const isChanged = (await read($, changes)).some(one => one.path === rel)
  await showPath($, rel, { mode: isChanged ? 'diff' : 'file' })
  const shown = await read($, preview)
  const offset = shown?.mode === 'diff' ? hunkOffset(shown.diff, line) : Math.max(0, line - 4)
  await update($, previewOffset, () => offset)
}

// The lines a reference names: the mouse selection's (by the gutter's
// numbers, else found in the file), else the lines the preview shows.
async function pickedLines($: EngineInterface, shown: ExplorerPreview): Promise<{ start: number; end: number; text?: string }> {
  const picked = await $.ui.selection()
  const text = picked?.text ?? ''
  if (text.trim() !== '') {
    const rows = text.split('\n').filter(row => row.trim() !== '')
    const numbers = rows.map(row => /^\s*(\d+)[\s│|:]/.exec(row)?.[1]).filter((n): n is string => n !== undefined)
    if (numbers.length === rows.length && numbers.length > 0) {
      const values = numbers.map(Number)
      return { start: Math.min(...values), end: Math.max(...values), text }
    }
    const lines = shown.text.split('\n')
    const first = (rows[0] ?? '').trim()
    const near = layout.visible.start
    let at = -1
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? '').trim() === first && (at < 0 || Math.abs(i + 1 - near) < Math.abs(at + 1 - near))) at = i
    }
    if (at >= 0) return { start: at + 1, end: at + rows.length, text }
    return { start: 0, end: 0, text }
  }
  return { ...layout.visible }
}

const linesLabel = (start: number, end: number) =>
  start <= 0 ? '' : start === end ? `line ${start}` : `lines ${start}-${end}`

// `@path (lines a-b)` into the prompt: the file attached, the lines named.
async function referenceLines($: EngineInterface, shown: ExplorerPreview) {
  const { start, end } = await pickedLines($, shown)
  const label = linesLabel(start, end)
  const { text, cursor } = await $.prompt.read()
  const before = text.slice(0, cursor)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const filled = await $.prompt.fill({ text: `${lead}@${shown.path}${label === '' ? '' : ` (${label})`} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not insert @${oneLine(shown.path)}`)
}

// ---- drawing -------------------------------------------------------------

type Elements = ElementTable
type InputElement = ElementTable<'terminal'>['Input'] | undefined

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

// The search tab's mode row, query field and status line.
async function drawSearchControls(
  $: EngineInterface,
  els: Elements,
  Input: InputElement,
  width: number,
): Promise<RenderElement> {
  const { Box, Text, Button } = els
  const found = await read($, search)
  const isText = found.mode === 'text'
  const setMode = (mode: 'files' | 'text') => async () => {
    await update($, search, now => ({ ...now, mode }))
    const now = await read($, search)
    if (mode === 'files') await searchFiles($, now.query)
    else if (now.hits.length === 0) await searchText($, now.query)
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key="search:files" label="Name" plain dimColor={isText ? true : undefined} onPress={setMode('files')} />
        <Button key="search:text" label="Text" plain dimColor={isText ? undefined : true} onPress={setMode('text')} />
        {isText && (
          <Button key="search:case" label="Aa" plain dimColor={found.isCaseSensitive ? undefined : true}
            onPress={() => toggleSearchFlag($, 'isCaseSensitive')} />
        )}
        {isText && (
          <Button key="search:regex" label=".*" plain dimColor={found.isRegex ? undefined : true}
            onPress={() => toggleSearchFlag($, 'isRegex')} />
        )}
      </Box>
      {Input !== undefined && (
        <Input
          key="search-input"
          placeholder={isText ? 'text in files (Enter)' : 'file name'}
          autoFocus
          onInput={async (value: string) => {
            if (isText) await update($, search, now => ({ ...now, query: value }))
            else await searchFiles($, value)
            // Keep typing in the field however much the results moved around it.
            await $.ui.focus({ requestId: EXPLORER, key: 'search-input' }).catch(() => undefined)
          }}
          onSubmit={async (value: string) => {
            if (isText) return searchText($, value)
            await searchFiles($, value)
            const first = (await read($, search)).files[0]
            if (first !== undefined) await showPath($, first, { mode: fileMode(first) })
          }}
        />
      )}
      <Text dimColor>{fit(found.note || (isText ? 'ripgrep, ignore files honoured' : 'fuzzy, as you type'), width)}</Text>
    </Box>
  )
}

// The tree, the changes or the history; `rows` bounds the list to a window
// of its own (split view), absent draws it whole for the pane to scroll.
async function drawSidebar(
  $: EngineInterface,
  els: Elements,
  Input: InputElement,
  width: number,
  rows: number | undefined,
): Promise<RenderElement> {
  const { Box, Text, Button } = els
  const dir = await read($, root)
  const current = await read($, view)
  const list = await read($, changes)
  const edited = new Set(await read($, touched))
  const chosen = await read($, selected)
  const against = await read($, base)

  let lines: { key: string; node: () => RenderElement }[] = []
  let fixed = 2
  const extra: RenderElement[] = []

  if (current === 'search') {
    const found = await read($, search)
    fixed += 3
    if (Input === undefined) extra.push(<Text dimColor>Search needs a surface with text input.</Text>)
    if (found.mode === 'files') {
      lines = found.files.map(path => {
        const icon = iconFor(baseName(path), false, false, layout.icons)
        const room = width - 2 - iconWidth(icon, layout.icons)
        const label = fit(baseName(path), room)
        const rest = room - label.length - 1
        return {
          key: path,
          node: () => (
            <Box key={`line:${path}`} flexDirection="row">
              <Text color="blue">{path === chosen ? '▌' : ' '}</Text>
              {icon.glyph !== '' && <Text color={icon.color}>{icon.glyph}</Text>}
              <Button key={`found:${path}`} label={label} plain onPress={() => showPath($, path, { mode: fileMode(path) })} />
              {parentOf(path) !== '' && rest > 3 && <Text dimColor> {fit(parentOf(path), rest)}</Text>}
            </Box>
          ),
        }
      })
    } else {
      let lastPath = ''
      const pattern = compileQuery(found.query, found)
      const counts = new Map<string, number>()
      for (const hit of found.hits) counts.set(hit.path, (counts.get(hit.path) ?? 0) + 1)
      for (const hit of found.hits) {
        if (hit.path !== lastPath) {
          lastPath = hit.path
          const icon = iconFor(baseName(hit.path), false, false, layout.icons)
          const count = ` ${counts.get(hit.path) ?? 0}`
          const room = width - 1 - iconWidth(icon, layout.icons) - count.length
          lines.push({
            key: `file:${hit.path}`,
            node: () => (
              <Box key={`hits:${hit.path}`} flexDirection="row">
                <Text color="blue">{hit.path === chosen ? '▌' : ' '}</Text>
                {icon.glyph !== '' && <Text color={icon.color}>{icon.glyph}</Text>}
                <Button key={`hitfile:${hit.path}`} label={fit(hit.path, room)} plain onPress={() => openHit($, hit)} />
                <Box flexGrow={1} />
                <Text dimColor>{count}</Text>
              </Box>
            ),
          })
        }
        const number = String(hit.line)
        const room = width - 4 - number.length
        lines.push({
          key: `${hit.path}:${hit.line}:${hit.column}`,
          node: () => {
            const piece = excerpt(hit.text, matchSpan(hit.text, pattern), room)
            return (
            <Box key={`hitline:${hit.path}:${hit.line}:${hit.column}`} flexDirection="row">
              <Text>{'   '}</Text>
              <Button key={`hit:${hit.path}:${hit.line}:${hit.column}`} label={number} plain dimColor onPress={() => openHit($, hit)} />
              <Text> {piece.before}</Text>
              <Text color="black" backgroundColor="yellow">{piece.hit}</Text>
              <Text>{piece.after}</Text>
            </Box>
            )
          },
        })
      }
    }
  } else if (current === 'history') {
    const commits = await read($, history)
    if (commits.length === 0) extra.push(<Text dimColor>No commits.</Text>)
    lines = commits.map(commit => {
      const room = width - commit.short.length - 2
      const subject = fit(commit.subject, room)
      const rest = room - subject.length - 1
      return {
        key: commit.sha,
        node: () => (
          <Box key={`line:${commit.sha}`} flexDirection="row">
            <Text color="blue">{against.head === commit.sha ? '▌' : ' '}</Text>
            <Text color="yellow">{fit(commit.short, 12)} </Text>
            <Button key={`commit:${commit.sha}`} label={subject} plain onPress={() => openCommit($, commit)} />
            {rest > 6 && <Text dimColor> {fit(`${commit.when}, ${commit.author}`, rest)}</Text>}
          </Box>
        ),
      }
    })
  } else if (current === 'changes') {
    const failed = await read($, gitError)
    fixed += Input === undefined ? 1 : 2
    if (failed !== '') extra.push(<Text color="red">{failed}</Text>)
    else if (list.length === 0) extra.push(<Text dimColor>No changes.</Text>)
    lines = list.map(change => {
      const where = parentOf(change.path)
      const mark = edited.has(change.path) ? '✎' : ''
      const icon = iconFor(baseName(change.path), false, false, layout.icons)
      const room = width - 4 - mark.length - iconWidth(icon, layout.icons)
      const label = fit(baseName(change.path), room)
      const rest = room - label.length - 1
      return {
        key: change.path,
        node: () => (
          <Box key={`line:${change.path}`} flexDirection="row">
            <Text color="blue">{change.path === chosen ? '▌' : ' '}</Text>
            {icon.glyph !== '' && <Text color={icon.color}>{icon.glyph}</Text>}
            <Button
              key={`change:${change.path}`}
              label={label}
              plain
              dimColor={change.letter === 'D' ? true : undefined}
              onPress={() => showPath($, change.path, { mode: 'diff' })}
            />
            {where !== '' && rest > 3 && <Text dimColor> {fit(where, rest)}</Text>}
            <Box flexGrow={1} />
            {mark !== '' && <Text color="blue">{mark}</Text>}
            <Text color={BADGE_COLOR[change.letter] ?? 'yellow'}> {change.letter}</Text>
          </Box>
        ),
      }
    })
  } else {
    const all = await read($, listings)
    const open = new Set(await read($, expanded))
    const status: Record<string, string> = {}
    for (const change of list) status[change.path] = change.letter
    const folders = folderBadges(list)
    const tree = flatten(all, open)
    if (tree.length === 0) extra.push(<Text dimColor>(empty)</Text>)
    lines = tree.map(({ rel, depth, entry }) => {
      const letter = entry.isDir ? folders[rel] : status[rel]
      const badge = letter === undefined ? '' : entry.isDir ? '●' : letter
      const mark = edited.has(rel) ? '✎' : ''
      const indent = '  '.repeat(depth)
      // Folders: a blue chevron, their icon and a trailing slash; files: their icon.
      const isOpen = open.has(rel)
      const chevron = entry.isDir ? (isOpen ? '▾ ' : '▸ ') : layout.icons === 'ascii' ? '' : '  '
      const icon = iconFor(entry.name, entry.isDir, isOpen, layout.icons)
      const name = entry.isDir ? `${entry.name}/` : entry.name
      const used = indent.length + chevron.length + iconWidth(icon, layout.icons) + badge.length + mark.length
      const room = width - 3 - used
      return {
        key: rel,
        node: () => (
          <Box key={`line:${rel}`} flexDirection="row">
            <Text color="blue">{rel === chosen ? '▌' : ' '}</Text>
            <Text dimColor>{indent}</Text>
            {chevron !== '' && (entry.isDir ? <Text color="blue" bold>{chevron}</Text> : <Text>{chevron}</Text>)}
            {icon.glyph !== '' &&
              (icon.color === undefined ? (
                <Text dimColor={layout.icons === 'ascii' ? true : undefined}>{icon.glyph}</Text>
              ) : (
                <Text color={icon.color}>{icon.glyph}</Text>
              ))}
            <Button
              key={`row:${rel}`}
              label={fit(name, room)}
              plain
              onPress={() => (entry.isDir ? toggleDir($, rel) : showPath($, rel, { mode: fileMode(rel), size: entry.size }))}
            />
            <Box flexGrow={1} />
            {mark !== '' && <Text color="blue">{mark}</Text>}
            {badge !== '' && <Text color={BADGE_COLOR[letter ?? ''] ?? 'yellow'}> {badge}</Text>}
          </Box>
        ),
      }
    })
  }

  const room = rows === undefined ? lines.length : Math.max(1, rows - fixed - extra.length)
  layout.listRows = room
  layout.listTotal = lines.length
  const offset = rows === undefined ? 0 : clamp(await read($, listOffset), 0, Math.max(0, lines.length - room))
  const isOver = lines.length > room
  const scroll = (by: number) =>
    update($, listOffset, now => {
      const last = Math.max(0, lines.length - layout.listRows)
      return clamp(Math.min(now, last) + by, 0, last)
    })

  return (
    <Box flexDirection="column" width={rows === undefined ? undefined : width}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{fit(baseName(dir).toUpperCase() || dir, width - (rows === undefined ? 8 : 16))}</Text>
        <Box flexDirection="row" gap={1}>
          {rows !== undefined && (
            <Button key="follow" label="follow" plain dimColor={(await read($, follow)) ? undefined : true}
              onPress={() => update($, follow, now => !now)} />
          )}
          <Button key="refresh" label="↻" plain onPress={() => refreshAll($)} />
          {current === 'files' && <Button key="collapse" label="⊟" plain onPress={() => update($, expanded, () => [])} />}
          <Button
            key="mention"
            label="@"
            plain
            onPress={async () => {
              const rel = await read($, selected)
              if (rel === '') $.ui.toast('Select a file first')
              else await mention($, rel)
            }}
          />
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          <Button key="tab:files" label="Files" plain hotkey="f" dimColor={current === 'files' ? undefined : true}
            onPress={() => update($, view, () => 'files' as const)} />
          <Button key="tab:changes" label={`${width < 40 ? 'Chg' : 'Changes'} ${list.length}`} plain hotkey="c"
            dimColor={current === 'changes' ? undefined : true}
            onPress={() => update($, view, () => 'changes' as const)} />
          <Button key="tab:history" label={width < 40 ? 'Log' : 'History'} plain hotkey="h"
            dimColor={current === 'history' ? undefined : true}
            onPress={() => update($, view, () => 'history' as const)} />
          <Button key="tab:search" label={width < 40 ? 'Find' : 'Search'} plain hotkey="s"
            dimColor={current === 'search' ? undefined : true}
            onPress={() => update($, view, () => 'search' as const)} />
        </Box>
        {/* Always drawn in the split view, dim when the list fits: these sit
            before the search field, and a control appearing or vanishing there
            as results change moved the focus off the field mid-typing. */}
        {rows !== undefined && (
          <Box flexDirection="row">
            <Button key="list:up" label="▲" plain dimColor={isOver ? undefined : true}
              onPress={() => scroll(-Math.max(1, room - 2))} />
            <Button key="list:down" label="▼" plain dimColor={isOver ? undefined : true}
              onPress={() => scroll(Math.max(1, room - 2))} />
          </Box>
        )}
      </Box>
      {current === 'changes' && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{against.head === undefined ? 'vs' : 'in'}</Text>
          <Button key="base" label={fit(against.label, width - 4)} plain onPress={() => cycleBase($)} />
        </Box>
      )}
      {current === 'changes' && Input !== undefined && (
        <Input key="base-ref" placeholder="ref or a..b (empty = HEAD)" onSubmit={(value: string) => chooseBase($, value)} />
      )}
      {current === 'search' && (await drawSearchControls($, els, Input, width))}
      {extra}
      {lines.slice(offset, offset + room).map(line => line.node())}
    </Box>
  )
}

// The open file or diff; `rows` windows it by previewOffset (split view).
async function drawPreview(
  $: EngineInterface,
  els: Elements,
  width: number,
  rows: number | undefined,
  isOwnPane: boolean,
): Promise<RenderElement> {
  const { Box, Text, Button, Code, Markdown } = els
  const shown = await read($, preview)
  if (shown === null) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Select a file in the explorer.</Text>
      </Box>
    )
  }
  const list = await read($, changes)
  const against = await read($, base)
  const at = list.findIndex(one => one.path === shown.path)
  const change = list[at]
  const verb = against.head === undefined ? 'vs' : 'in'
  const step = (by: number) => {
    const target = at < 0 ? list[0] : list[(at + by + list.length) % list.length]
    if (target !== undefined) void showPath($, target.path, { mode: 'diff' })
  }

  // Each hunk is a label row and its lines; the file is its lines.
  const hunks = shown.mode === 'diff' ? splitHunks(shown.diff) : []
  const isSource = shown.mode === 'file' || shown.mode === 'rendered'
  const fileLines = isSource && shown.text !== '' ? shown.text.replace(/\n$/, '').split('\n') : []
  const hunkRows = hunks.map(hunk => hunk.body.replace(/\n$/, '').split('\n').length)
  const total = isSource ? fileLines.length : hunkRows.reduce((sum, n) => sum + n, 0)
  const hasModes = shown.isChanged || isMarkdown(shown.path)
  const fixed = 1 + (hasModes ? 1 : 0) + (shown.note !== '' ? 1 : 0)
  const room = rows === undefined ? total : Math.max(1, rows - fixed)
  const isWrapped = await read($, wrapLines)
  const shift = isWrapped ? 0 : await read($, sideways)

  // The rows each unit takes: a line wrapped into the room beside its gutter
  // (line numbers; a diff's two plus its marker), a hunk label one.
  const digits = String(Math.max(total, 1)).length
  const gutter = shown.mode === 'diff' ? digits * 2 + 5 : digits + 3
  const lineRoom = Math.max(10, width - gutter - 1)
  const costs: number[] = []
  if (shown.mode === 'file') for (const line of fileLines) costs.push(isWrapped ? rowsOf(line, lineRoom) : 1)
  if (shown.mode === 'diff') {
    for (const hunk of hunks) {
      costs.push(1)
      for (const line of hunk.body.replace(/\n$/, '').split('\n').slice(1)) {
        costs.push(isWrapped ? rowsOf(line.slice(1), lineRoom) : 1)
      }
    }
  }
  const isCounted = shown.mode === 'file' || shown.mode === 'diff'
  const last = rows === undefined ? 0 : isCounted ? lastStart(costs, room) : Math.max(0, total - room)
  layout.previewRows = room
  layout.previewTotal = total
  layout.previewLast = last
  const offset = rows === undefined ? 0 : clamp(await read($, previewOffset), 0, last)
  const count = rows === undefined ? total : isCounted ? fitCount(costs, offset, room) : room
  const scroll = (by: number) =>
    update($, previewOffset, now => clamp(Math.min(now, layout.previewLast) + by, 0, layout.previewLast))
  const isOver = last > 0
  const widestLine = !isWrapped && isCounted ? widest(isSource ? fileLines : hunks.map(hunk => hunk.body).join('\n').split('\n')) : 0
  const canShift = !isWrapped && widestLine > lineRoom
  const sidewaysStep = Math.max(8, Math.floor(lineRoom / 2))
  const slide = (by: number) =>
    update($, sideways, now => clamp(now + by, 0, Math.max(0, widestLine - lineRoom + 2)))

  const body: RenderElement[] = []
  let shownEnd = Math.min(total, offset + count)
  layout.visible = shown.mode === 'file' ? { start: offset + 1, end: shownEnd } : { start: 0, end: 0 }
  if (shown.mode === 'rendered' && fileLines.length > 0) {
    const part = rows === undefined
      ? { text: fileLines.join('\n'), start: 0, end: fileLines.length }
      : markdownWindow(fileLines, offset, room, width)
    shownEnd = part.end
    layout.visible = { start: part.start + 1, end: part.end }
    // Headings drawn by hand, since a terminal has one size of type: H1 a
    // full-width band, H2 a coloured title over a rule, H3 a marked title.
    // Fenced code is framed, its language set into the top edge.
    splitMarkdown(part.text).forEach((piece, i) => {
      if (piece.kind === 'code') {
        body.push(
          <Box key={`code:${i}`} borderStyle="round" borderColor="gray" paddingX={1} width={Math.max(8, width - 1)}>
            {piece.language !== '' && (
              <Box position="absolute" top={-1} left={1}>
                <Text dimColor> {fit(piece.language, Math.max(1, width - 8))} </Text>
              </Box>
            )}
            {piece.text === '' ? (
              <Text> </Text>
            ) : (
              <Code
                source={`${piece.text}\n`}
                language={piece.language === '' ? undefined : piece.language}
                wrap={isWrapped ? 'wrap' : 'truncate-end'}
              />
            )}
          </Box>,
        )
        return
      }
      if (piece.kind === 'heading') {
        const top = i === 0 ? 0 : 1
        if (piece.level === 1) {
          body.push(
            <Box key={`h:${i}`} marginTop={top}>
              <Text bold color="black" backgroundColor="cyan">{fitCells(` ${piece.text}`, Math.max(4, width - 1))}</Text>
            </Box>,
          )
        } else if (piece.level === 2) {
          body.push(
            <Box key={`h:${i}`} flexDirection="column" marginTop={top}>
              <Text bold color="cyan">{fitCells(piece.text, Math.max(4, width - 1)).trimEnd()}</Text>
              <Text color="cyan" dimColor>{'─'.repeat(Math.max(4, Math.min(width - 1, cellWidth(piece.text) + 2)))}</Text>
            </Box>,
          )
        } else {
          body.push(
            <Box key={`h:${i}`} marginTop={top}>
              <Text color={piece.level === 3 ? 'blue' : undefined} bold>{piece.level === 3 ? '▍' : ''}</Text>
              <Text bold dimColor={piece.level >= 5 ? true : undefined}>
                {fitCells(piece.text, Math.max(4, width - 2)).trimEnd()}
              </Text>
            </Box>,
          )
        }
        return
      }
      const links = localLinks(piece.text)
      body.push(
        links.length > 0 ? (
          <Markdown
            key={`md:${i}`}
            text={piece.text}
            pressableLinks={links}
            onLinkPress={link => openLink($, shown.path, link.href)}
          />
        ) : (
          <Markdown key={`md:${i}`} text={piece.text} />
        ),
      )
    })
  }
  if (shown.mode === 'file' && fileLines.length > 0) {
    body.push(
      <Code
        source={`${fileLines.slice(offset, offset + count).map(line => shiftCells(line, shift)).join('\n')}\n`}
        path={shown.path}
        startLine={offset + 1}
        wrap={isWrapped ? 'wrap' : 'truncate-end'}
      />,
    )
  }
  let skip = offset
  let left = count
  hunks.forEach((hunk, i) => {
    const size = hunkRows[i] ?? 1
    if (left <= 0 || skip >= size) {
      skip = Math.max(0, skip - size)
      return
    }
    // The first hunk in view names the lines a reference without a
    // selection points at.
    if (layout.visible.start === 0) {
      const at = /\+(\d+)(?:,(\d+))?/.exec(hunk.header)
      const start = Number(at?.[1] ?? 0)
      layout.visible = { start, end: start + Math.max(1, Number(at?.[2] ?? 1)) - 1 }
    }
    // Row 0 of a hunk is its label; the rest are its body lines.
    if (skip === 0) {
      body.push(
        <Box key={`hunk:${i}`} flexDirection="row" justifyContent="space-between">
          <Text dimColor>{fit(hunk.lines, width - 10)}</Text>
          <Button
            key={`quote:${i}`}
            label="❝ quote"
            plain
            dimColor
            onPress={() => quote($, hunk.body, `\`${shown.path}\` ${hunk.lines} (diff ${verb} ${against.label})`, 'diff')}
          />
        </Box>,
      )
      left--
    }
    const from = Math.max(0, skip - 1)
    const take = Math.min(left, size - 1 - from)
    if (take > 0) {
      const part = sliceHunk(hunk.body, from, take)
      const source = shift === 0
        ? part
        : part.split('\n').map((line, n) => (n === 0 || line === '' ? line : line.charAt(0) + shiftCells(line.slice(1), shift))).join('\n')
      body.push(<Code source={source} format="diff" path={shown.path} wrap={isWrapped ? 'wrap' : 'truncate-end'} />)
      left -= take
    }
    skip = 0
  })

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {layout.icons === 'ascii' ? '' : iconFor(baseName(shown.path), false, false, layout.icons).glyph}
          {fit(shown.path, width - 19)}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="wrap" label="↩" plain hotkey="w" dimColor={isWrapped ? undefined : true}
            onPress={() => update($, wrapLines, now => !now)} />
          {canShift && <Button key="left" label="◀" plain dimColor={shift === 0 ? true : undefined} onPress={() => slide(-sidewaysStep)} />}
          {canShift && <Button key="right" label="▶" plain onPress={() => slide(sidewaysStep)} />}
          {isOver && <Button key="up" label="▲" plain hotkey="k" onPress={() => scroll(-Math.max(1, Math.floor(room / 2)))} />}
          {isOver && <Button key="down" label="▼" plain hotkey="j" onPress={() => scroll(Math.max(1, Math.floor(room / 2)))} />}
          {list.length > 0 && <Button key="prev" label="‹" plain hotkey="p" onPress={() => step(-1)} />}
          {list.length > 0 && <Button key="next" label="›" plain hotkey="n" onPress={() => step(1)} />}
          <Button key="quote" label="❝" plain hotkey="q" onPress={() => quoteSelection($, shown.path)} />
          <Button key="ref" label="#" plain hotkey="r" onPress={() => referenceLines($, shown)} />
          {isOwnPane && <Button key="mention" label="@" plain onPress={() => mention($, shown.path)} />}
          {isOwnPane && (
            <Button key="close" label="✕" plain role="dismiss" onPress={() => $.ui.close({ id: PREVIEW })} />
          )}
        </Box>
      </Box>
      {hasModes && (
        <Box flexDirection="row" gap={1}>
          {shown.isOnDisk && isMarkdown(shown.path) && (
            <Button key="mode:rendered" label="Preview" plain hotkey="m" dimColor={shown.mode === 'rendered' ? undefined : true}
              onPress={() => showPath($, shown.path, { mode: 'rendered' })} />
          )}
          {shown.isOnDisk && (
            <Button key="mode:file" label={isMarkdown(shown.path) ? 'Source' : 'File'} plain hotkey="o"
              dimColor={shown.mode === 'file' ? undefined : true}
              onPress={() => showPath($, shown.path, { mode: 'file' })} />
          )}
          {shown.isChanged && (
            <Button key="mode:diff" label="Diff" plain hotkey="d" dimColor={shown.mode === 'diff' ? undefined : true}
              onPress={() => showPath($, shown.path, { mode: 'diff' })} />
          )}
          {change !== undefined && (
            <Text dimColor>
              <Text color={BADGE_COLOR[change.letter] ?? 'yellow'}>{change.letter}</Text>
              {` ${verb} ${fit(against.label, width - 30)} · ${at + 1}/${list.length}`}
            </Text>
          )}
          {isOver && <Text dimColor>{` ${offset + 1}-${shownEnd}/${total}`}</Text>}
        </Box>
      )}
      {!hasModes && isOver && <Text dimColor>{`lines ${offset + 1}-${shownEnd} of ${total}`}</Text>}
      {shown.note !== '' && <Text dimColor>{shown.note}</Text>}
      {body}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const style = options.icons
  layout.icons = style === 'nerd' || style === 'ascii' ? style : 'emoji'
  let pending: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'files',
      description: 'Open the file explorer',
      argumentHint: '[files|changes|history|search]',
    })
    await $.command.register({
      name: 'search',
      description: 'Search file contents with ripgrep, shown in the explorer',
      argumentHint: '[text]',
    })
    await $.command.register({
      name: 'changes',
      description: 'Browse git changes against a ref or a range (HEAD by default)',
      argumentHint: '[ref | a..b | turn]',
    })
    if ((await read($, root)) !== e.cwd) {
      await update($, root, () => e.cwd)
      await update($, expanded, () => [])
      await update($, listings, () => ({}))
      await update($, base, () => HEAD)
    }
    await refreshAll($)
    void $.ui.open({ id: EXPLORER, title: 'Explorer' })

    return next(e)
  })

  on('command.run', { command: 'files' }, async ($, e) => {
    const opened = await openExplorer($, e.args.trim())
    return { text: opened.isPlaced ? 'Explorer opened.' : `Explorer not shown: ${opened.reason}` }
  })

  on('command.run', { command: 'search' }, async ($, e) => {
    const query = e.args.trim()
    if (query !== '') await searchText($, query)
    else await update($, search, now => ({ ...now, mode: 'text' as const }))
    const opened = await openExplorer($, 'search')
    const { note } = await read($, search)
    return { text: opened.isPlaced ? note || 'Search opened.' : `Explorer not shown: ${opened.reason}` }
  })

  on('command.run', { command: 'changes' }, async ($, e) => {
    if (e.args.trim() !== '') await chooseBase($, e.args)
    const opened = await openExplorer($, 'changes')
    const { label } = await read($, base)
    const count = (await read($, changes)).length
    return {
      text: opened.isPlaced
        ? `${count} changed file${count === 1 ? '' : 's'} against ${label}.`
        : `Explorer not shown: ${opened.reason}`,
    }
  })

  // Each prompt snapshots the working tree, for the last-prompt base.
  // Deferred to a timer so sending the prompt never waits on git; the
  // snapshot lands well before the model's first edit.
  on('prompt.submit', async ($, e, next) => {
    $.clock.after(0, () => void snapshotPrompt($).catch(() => undefined))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    const isError = (ran as { isError?: unknown }).isError === true
    if (!isError && (tool === 'Read' || EDITING_TOOLS.has(tool))) {
      // After the result is handed back, so following never slows Claude down.
      const args = { ...(e as unknown as Record<string, unknown>) }
      $.clock.after(0, () => void followTool($, tool, args).catch(() => undefined))
    }
    if (!EDITING_TOOLS.has(tool) && tool !== 'Bash') return ran

    const args = e as { file_path?: unknown; notebook_path?: unknown }
    const filePath = args.file_path ?? args.notebook_path
    if (EDITING_TOOLS.has(tool) && typeof filePath === 'string') {
      const dir = await read($, root)
      const normal = filePath.replace(/\\/g, '/')
      const rel = normal.startsWith(`${dir}/`) ? normal.slice(dir.length + 1) : normal
      if (isPlainRelative(rel)) {
        await update($, touched, list => (list.includes(rel) ? list : [...list, rel]))
      }
    }

    // A burst of edits refreshes once.
    pending?.cancel()
    pending = $.clock.after(400, () => {
      pending = undefined
      void refreshAll($)
    })

    return ran
  })

  // Split view: the wheel scrolls the column under the pointer.
  on('ui.scroll', { component: 'Pane', requestId: EXPLORER }, async ($, e, next) => {
    if (!layout.isSplit || e.origin.kind !== 'person' || e.pointer === undefined) return next(e)
    const by = Math.sign(e.by) * Math.max(WHEEL_ROWS, Math.abs(e.by))
    // Clamped to the last window, so a wheel past the end does not bank rows.
    if (e.pointer.column < layout.sidebarColumns) {
      const last = Math.max(0, layout.listTotal - layout.listRows)
      await update($, listOffset, now => clamp(Math.min(now, last) + by, 0, last))
    } else {
      const last = layout.previewLast
      await update($, previewOffset, now => clamp(Math.min(now, last) + by, 0, last))
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: EXPLORER }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const width = Math.max(20, e.props.bodyColumns)
    const rows = Math.max(8, e.props.scroll.bodyRows)
    layout.isSplit = width >= SPLIT_MIN_COLUMNS
    if (!layout.isSplit) return drawSidebar($, els, Input, width, undefined)

    const sidebar = clamp(Math.floor(width * 0.32), 26, 44)
    layout.sidebarColumns = sidebar
    return (
      <Box flexDirection="row">
        {await drawSidebar($, els, Input, sidebar, rows)}
        <Box width={1} marginRight={1}>
          <Text dimColor>{Array.from({ length: rows }, () => '│').join('\n')}</Text>
        </Box>
        {await drawPreview($, els, width - sidebar - 2, rows, false)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PREVIEW }, async ($, e) => {
    return drawPreview($, $.ui.resolve(e), Math.max(20, e.props.bodyColumns), undefined, true)
  })
}
