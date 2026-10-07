import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type {
  ExplorerBase,
  ExplorerChange,
  ExplorerCommit,
  ExplorerDiagram,
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
import { clipDiff, hunkOffset, isPlainBranch, parseBlame, parseFileLog, parseGitHubRemote, parseLog, parseNameStatus, parsePullRequest, parseRestPull, pullLabel, sliceHunk, splitHunks, UNCOMMITTED } from './diff'
import { cleanText, isPlainRelative, oneLine } from './safe'
import { helpText } from './help'
import { formatAge, formatSize, isIgnored, parseIgnored } from './details'
import { hasOutline, outlineOf } from './outline'
import { isDelimited, isJson, isJsonLines, jsonRows, parseDelimited, parseJson, parseJsonLines, tableLines } from './data'
import type { JsonNode, JsonRow } from './data'
import { decodeBase64, imageCells, imageFormatOf, imageInfo } from './image'
import { pickRaster, rasterArgs, SIPS, svgArgs, convertError } from './convert'
import type { Converters, RasterTool } from './convert'
import { cacheFolder, diagramKey, isMermaid, MAX_DIAGRAM_CHARS, mmdcArgs, mmdcError } from './mermaid'
import type { OutlineEntry, OutlineKind } from './outline'
import type { HelpLanguage } from './help'
import type { PullRequest } from './diff'
import { buttonCells, fitCount, lastStart, packRows, rowsOf, shiftCells, widest } from './wrap'
import type { IconStyle } from './icons'

const EXPLORER = 'file-explorer'
const PREVIEW = 'file-preview'

const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const EDITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAX_ROWS = 1500
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_CODE_CHARS = 10000
// Pictures: drawn up to this size; headers read from files `fs.read` takes.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_READ_BYTES = 4 * 1024 * 1024
const IMAGE_HEADER_BYTES = 256 * 1024
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
const ignored = atom({ plugin: 'file-explorer', key: 'ignored' } as const, [])
const hideIgnored = atom({ plugin: 'file-explorer', key: 'hideIgnored' } as const, false)
const pins = atom({ plugin: 'file-explorer', key: 'pins' } as const, [])
const historyOf = atom({ plugin: 'file-explorer', key: 'historyOf' } as const, '')
const fileHistory = atom({ plugin: 'file-explorer', key: 'fileHistory' } as const, [])
const blame = atom({ plugin: 'file-explorer', key: 'blame' } as const, null)
const diagrams = atom({ plugin: 'file-explorer', key: 'diagrams' } as const, {})
const pictures = atom({ plugin: 'file-explorer', key: 'pictures' } as const, {})
const converters = atom({ plugin: 'file-explorer', key: 'converters' } as const, null)
const mermaidTool = atom({ plugin: 'file-explorer', key: 'mermaidTool' } as const, 'unknown')
const symbol = atom({ plugin: 'file-explorer', key: 'symbol' } as const, null)
const dataView = atom({ plugin: 'file-explorer', key: 'dataView' } as const, { path: '', toggled: [], pick: '' })
const listOffset = atom({ plugin: 'file-explorer', key: 'listOffset' } as const, 0)
const follow = atom({ plugin: 'file-explorer', key: 'follow' } as const, true)
const lastPrompt = atom({ plugin: 'file-explorer', key: 'lastPrompt' } as const, null)
const wrapLines = atom({ plugin: 'file-explorer', key: 'wrapLines' } as const, true)
const sideways = atom({ plugin: 'file-explorer', key: 'sideways' } as const, 0)
const previewOffset = atom({ plugin: 'file-explorer', key: 'previewOffset' } as const, 0)

// The project's file list for name search, read once and dropped on refresh.
const cache: {
  files?: string[]
  lower?: string[]
  turnHead?: string
  rootReal?: string
  // The outline of the text last outlined, kept while that text is shown.
  outline?: { path: string; text: string; entries: OutlineEntry[] }
  // The data file last parsed, kept while that text is shown.
  data?: { path: string; text: string; parsed: ParsedData }
  // The last blame run, by path, HEAD and the text it was run on.
  blame?: { key: string; value: { path: string; shas: string[]; commits: Record<string, { short: string; author: string; time: number; summary: string }> } }
} = {}

// What the explorer was last drawn as, so presses know where a file shows.
const layout = { isSplit: false, sidebarColumns: 0, listRows: 20, previewRows: 20, listTotal: 0, previewTotal: 0, previewLast: 0, icons: 'emoji' as IconStyle, language: 'en' as HelpLanguage, visible: { start: 0, end: 0 }, mermaid: 'auto' as 'auto' | 'off', pictures: 'auto' as 'auto' | 'off' }

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
    entries.push({ name: one.name, isDir, size: one.size, mtimeMs: one.mtimeMs })
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
    if (merge.exitCode === 0) return { ref: merge.stdout.trim(), label: `${name} (merge-base)`, kind: 'branch' }
  }
  return undefined
}

// HEAD → the last prompt → this branch's pull request → the default
// branch's merge-base → HEAD; a step with nothing to show is skipped.
async function cycleBase($: EngineInterface) {
  const now = await read($, base)
  const isHead = now.ref === 'HEAD' && now.head === undefined
  const turn = await read($, lastPrompt)
  if (isHead && turn !== null) return setBase($, turn)
  if (isHead || now.kind === 'turn') {
    const pr = await branchPullBase($)
    if (pr !== undefined) return setBase($, pr)
  }
  if (isHead || now.kind === 'turn' || (now.kind === 'pr' && now.head === undefined)) {
    const branch = await defaultBranchBase($)
    if (branch !== undefined) return setBase($, branch)
    if (isHead) $.ui.toast('No main or master branch to compare with')
  }
  await setBase($, HEAD)
}

// ---- pull requests --------------------------------------------------------

// gh, when the person has it: what a pull request merges into, its number
// and title. Never asked to log in or to choose (no prompts), never long.
async function ghPull($: EngineInterface, which: string[]) {
  const cwd = await read($, root)
  const ran = await $.process
    .run(['gh', 'pr', 'view', ...which, '--json', 'number,title,baseRefName,headRefOid'], {
      cwd,
      timeoutMs: 15000,
      env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    })
    .catch(() => undefined)
  return ran !== undefined && ran.exitCode === 0 ? parsePullRequest(ran.stdout) : undefined
}

// The merge-base of `head` with a branch, as the remote has it if it can.
async function mergeBaseWith($: EngineInterface, branch: string, head: string): Promise<string | undefined> {
  for (const name of [`origin/${branch}`, branch]) {
    const merge = await git($, ['merge-base', name, head])
    if (merge.exitCode === 0) return merge.stdout.trim()
  }
  return undefined
}

// Without gh: GitHub's public REST API, for a github.com origin. It answers
// for public repositories (a private one needs gh); a refusal is no answer.
async function restPull($: EngineInterface, number?: number): Promise<PullRequest | undefined> {
  const remote = await git($, ['remote', 'get-url', 'origin'])
  const repo = remote.exitCode === 0 ? parseGitHubRemote(remote.stdout) : undefined
  if (repo === undefined) return undefined
  let path = `/repos/${repo.owner}/${repo.repo}/pulls/${number ?? ''}`
  if (number === undefined) {
    const branch = (await git($, ['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim()
    if (!isPlainBranch(branch)) return undefined
    path = `/repos/${repo.owner}/${repo.repo}/pulls?state=open&per_page=1&head=${encodeURIComponent(`${repo.owner}:${branch}`)}`
  }
  const answer = await $.http
    .fetch(`https://api.github.com${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'claude-mods-file-explorer' },
    })
    .catch(() => undefined)
  return answer?.ok === true ? parseRestPull(answer.text) : undefined
}

// A pull request's base, number and title: from gh, else GitHub's API.
async function pullInfo($: EngineInterface, number?: number): Promise<PullRequest | undefined> {
  return (await ghPull($, number === undefined ? [] : [String(number)])) ?? (await restPull($, number))
}

// This branch's pull request, as GitHub shows it: from where the branch
// left its base to the working tree (uncommitted work included). `target`,
// when given, is the base: the PR's own is only asked for its name.
async function branchPullBase($: EngineInterface, target?: string): Promise<ExplorerBase | undefined> {
  const pr = await pullInfo($)
  const branch = target ?? pr?.baseRefName
  if (branch === undefined) return undefined
  const ref = await mergeBaseWith($, branch, 'HEAD')
  if (ref === undefined) return undefined
  return { ref, label: `${pr === undefined ? 'this branch' : pullLabel(pr)} (vs ${branch})`, kind: 'pr' }
}

// Remote-supplied config could name a program for a transport; a fetch the
// explorer runs allows none, never prompts, and gives up in a minute.
const FETCH_SAFETY = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', '-c', 'core.fsmonitor=false']

async function fetchRef($: EngineInterface, refspec: string) {
  const cwd = await read($, root)
  return $.process
    .run(['git', ...FETCH_SAFETY, 'fetch', '--no-tags', '--no-write-fetch-head', 'origin', refspec], {
      cwd,
      timeoutMs: 60000,
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
    .catch(() => ({ exitCode: -1, stdout: '', stderr: 'git could not run' }))
}

// Another pull request, by number: its head fetched from origin (GitHub's
// `pull/N/head`) into a ref of the explorer's own, its base branch fetched
// beside it so the fork point is today's, and shown from that fork point to
// the head, as GitHub shows it. Only when asked: this goes to the network.
async function openPull($: EngineInterface, number: number, target?: string) {
  const pr = await pullInfo($, number)
  const local = `refs/file-explorer/pull/${number}`
  $.ui.toast(`Fetching pull request #${number}…`)
  const fetched = await fetchRef($, `+refs/pull/${number}/head:${local}`)
  const head = fetched.exitCode === 0 ? await resolveCommit($, local) : undefined
  if (head === undefined) {
    $.ui.toast(`Could not fetch pull request #${number}: ${oneLine(fetched.stderr.trim().split('\n').pop() ?? '')}`)
    return
  }
  const branch = target ?? pr?.baseRefName ?? (await defaultBranchName($))
  if (branch === undefined) {
    $.ui.toast(`No base branch found for pull request #${number}`)
    return
  }
  // The base as origin has it now; when that fails, as this clone has it.
  const baseCopy = `refs/file-explorer/base/${branch}`
  const isFresh = (await fetchRef($, `+refs/heads/${branch}:${baseCopy}`)).exitCode === 0
  const ref = isFresh ? await mergeBaseWith($, baseCopy, head) : await mergeBaseWith($, branch, head)
  if (ref === undefined) {
    $.ui.toast(`No fork point with ${branch} for pull request #${number}`)
    return
  }
  const label = pr === undefined ? `PR #${number}` : pullLabel(pr)
  await setBase($, { ref, head, label: `${label} (vs ${branch})`, kind: 'pr' })
}

// The default branch's name, as origin/HEAD, main or master.
async function defaultBranchName($: EngineInterface): Promise<string | undefined> {
  const remote = await git($, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'])
  const named = remote.stdout.trim().replace(/^origin\//, '')
  for (const name of [named, 'main', 'master'].filter(isPlainBranch)) {
    if ((await resolveCommit($, `origin/${name}`)) !== undefined || (await resolveCommit($, name)) !== undefined) return name
  }
  return undefined
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
  // `pr`: this branch's pull request; `pr 123` or `#123`: that one. A
  // branch after either is the base to compare with (`pr 123 develop`).
  const pull = /^(?:(?:pr|pull)(?:\s+#?(\d+))?|#(\d+))(?:\s+(\S+))?$/i.exec(name)
  if (pull !== null) {
    const number = Number(pull[1] ?? pull[2] ?? 0)
    const target = pull[3]
    if (target !== undefined && !isPlainBranch(target)) {
      $.ui.toast(`Not a branch: ${oneLine(target)}`)
      return
    }
    if (number > 0) return openPull($, number, target)
    const pr = await branchPullBase($, target)
    if (pr !== undefined) return setBase($, pr)
    const branch = await defaultBranchBase($)
    $.ui.toast(
      target !== undefined
        ? `No fork point with ${target}`
        : branch === undefined
          ? 'No pull request found for this branch'
          : 'No pull request found (gh, or a public GitHub repository); showing the default branch',
    )
    if (branch !== undefined) await setBase($, branch)
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

const LOG_FORMAT = '--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f'
const MAX_BLAME_LINES = 20000

// The History tab narrowed to one file, renames followed.
async function loadFileLog($: EngineInterface, rel: string) {
  const log = await git($, ['log', '--follow', `-n${MAX_COMMITS}`, '--no-color', '--name-only', LOG_FORMAT, '--', rel])
  await update($, fileHistory, () => (log.exitCode === 0 ? parseFileLog(log.stdout) : []))
}

async function showFileLog($: EngineInterface, rel: string) {
  await update($, historyOf, () => rel)
  await loadFileLog($, rel)
  await update($, view, () => 'history' as const)
  await update($, listOffset, () => 0)
}

// A commit from a file's history: the commit's changes, that file's diff shown.
async function openFileCommit($: EngineInterface, commit: ExplorerCommit & { path: string }) {
  await openCommit($, commit)
  const rel = commit.path !== '' && isPlainRelative(commit.path) ? commit.path : await read($, historyOf)
  await showPath($, rel, { mode: 'diff' })
}

// Blame of the shown file, run only when asked and kept while the file and
// HEAD stay the same.
async function loadBlame($: EngineInterface, shown: ExplorerPreview): Promise<boolean> {
  const head = await git($, ['rev-parse', '--verify', '-q', 'HEAD'])
  const key = `${shown.path}\0${head.stdout.trim()}\0${shown.text}`
  if (cache.blame?.key === key) {
    const kept = cache.blame.value
    await update($, blame, () => kept)
    return true
  }
  const blamed = await git($, ['blame', '--porcelain', '--no-textconv', '--', shown.path])
  if (blamed.exitCode !== 0) {
    $.ui.toast(`No blame: ${oneLine(blamed.stderr.trim().split('\n')[0] ?? 'git blame failed')}`)
    return false
  }
  const value = { path: shown.path, ...parseBlame(blamed.stdout, MAX_BLAME_LINES) }
  cache.blame = { key, value }
  await update($, blame, () => value)
  return true
}

async function toggleBlame($: EngineInterface, rel: string) {
  const now = await read($, blame)
  if (now !== null && now.path === rel) {
    await update($, blame, () => null)
    return
  }
  let shown = await read($, preview)
  if (shown === null || shown.path !== rel) return
  if (shown.mode !== 'file') {
    await showPath($, rel, { mode: 'file' })
    shown = await read($, preview)
  }
  if (shown !== null) await loadBlame($, shown)
}

// The commit a blame line points at, opened as a history entry would be.
async function openBlamed($: EngineInterface, rel: string, sha: string, details: { short: string; author: string; summary: string }) {
  if (sha === UNCOMMITTED) {
    await showPath($, rel, { mode: 'diff' })
    return
  }
  await openFileCommit($, { sha, short: details.short, subject: details.summary, author: details.author, when: '', path: rel })
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

// Moves the explorer's focus ring onto one of its elements. Off the search
// field, a letter is the toolbar's hotkey again instead of a typed key.
async function focusOn($: EngineInterface, key: string) {
  await $.ui.focus({ requestId: EXPLORER, key }).catch(() => undefined)
}

// Opens a search result and leaves the focus on its row, out of the field.
async function openFound($: EngineInterface, path: string) {
  await showPath($, path, { mode: fileMode(path) })
  await focusOn($, `found:${path}`)
}

async function openHit($: EngineInterface, hit: ExplorerHit) {
  await showPath($, hit.path, { mode: 'file' })
  await update($, previewOffset, () => Math.max(0, hit.line - 4))
  await focusOn($, `hit:${hit.path}:${hit.line}:${hit.column}`)
}

// The open file's outline, worked out once per text shown.
function outlineFor(shown: ExplorerPreview): OutlineEntry[] {
  const kept = cache.outline
  if (kept !== undefined && kept.path === shown.path && kept.text === shown.text) return kept.entries
  const entries = outlineOf(shown.path, shown.text)
  cache.outline = { path: shown.path, text: shown.text, entries }
  return entries
}

// Scrolls the preview to an outline entry, out of a diff into the file.
async function jumpTo($: EngineInterface, entry: OutlineEntry) {
  const shown = await read($, preview)
  if (shown === null) return
  if (shown.mode === 'diff') await update($, preview, now => (now === null ? now : { ...now, mode: fileMode(now.path) }))
  await update($, symbol, () => ({ path: shown.path, start: entry.line, end: entry.end }))
  await update($, previewOffset, () => Math.max(0, entry.line - 1))
  await focusOn($, `sym:${entry.line}`)
}

const KIND_MARK: Record<OutlineKind, { glyph: string; color: string }> = {
  heading: { glyph: '#', color: 'blue' },
  function: { glyph: 'ƒ', color: 'yellow' },
  method: { glyph: 'ƒ', color: 'yellow' },
  class: { glyph: 'C', color: 'cyan' },
  type: { glyph: 'T', color: 'green' },
  const: { glyph: 'k', color: 'magenta' },
  module: { glyph: 'M', color: 'blue' },
}

type ParsedData =
  | { kind: 'table'; lines: ReturnType<typeof tableLines>; isCut: boolean }
  | { kind: 'tree'; root: JsonNode }
  | { kind: 'error'; text: string; line: number }

const MAX_DATA_RECORDS = 5000
const MAX_DATA_ROWS = 5000
const MAX_CELL = 40

// The shown data file parsed, once per text.
function dataFor(shown: ExplorerPreview): ParsedData {
  const kept = cache.data
  if (kept !== undefined && kept.path === shown.path && kept.text === shown.text) return kept.parsed
  let parsed: ParsedData
  if (isDelimited(shown.path)) {
    const delimiter = /\.csv$/i.test(shown.path) ? ',' : '\t'
    const { records, isCut } = parseDelimited(shown.text, delimiter, MAX_DATA_RECORDS)
    parsed = { kind: 'table', lines: tableLines(records, MAX_CELL), isCut }
  } else if (isJsonLines(shown.path)) {
    parsed = { kind: 'tree', root: parseJsonLines(shown.text, MAX_DATA_RECORDS) }
  } else {
    const result = parseJson(shown.text)
    parsed = 'root' in result
      ? { kind: 'tree', root: result.root }
      : { kind: 'error', text: `Not valid JSON: ${result.error} at line ${result.line}, column ${result.column}.`, line: result.line }
  }
  cache.data = { path: shown.path, text: shown.text, parsed }
  return parsed
}

// Picks a JSON node, and folds or unfolds it when it holds others.
async function pickNode($: EngineInterface, path: string, row: JsonRow) {
  await update($, dataView, now => {
    const toggled = now.path === path ? now.toggled : []
    const flipped = row.isOpen === undefined
      ? toggled
      : toggled.includes(row.path) ? toggled.filter(one => one !== row.path) : [...toggled, row.path]
    return { path, toggled: flipped, pick: row.path }
  })
  await focusOn($, `json:${row.path}`)
}

const JSON_COLOR: Record<string, string | undefined> = {
  string: 'green',
  number: 'cyan',
  boolean: 'magenta',
  null: undefined,
  error: 'red',
}

const MAX_DIAGRAMS = 20
const MAX_SVG_CHARS = 131072

// The mermaid blocks of a markdown text, as splitMarkdown reads them.
function mermaidSources(text: string): string[] {
  return splitMarkdown(text)
    .flatMap(part => (part.kind === 'code' && isMermaid(part.language) ? [part.text] : []))
    .filter(source => source.trim() !== '' && source.length <= MAX_DIAGRAM_CHARS)
    .slice(0, MAX_DIAGRAMS)
}

// Whether the person has mmdc: asked once, again after a refresh.
async function hasMmdc($: EngineInterface): Promise<boolean> {
  const known = await read($, mermaidTool)
  if (known !== 'unknown') return known === 'yes'
  const ran = await $.process.run(['mmdc', '--version'], { timeoutMs: 20000 }).catch(() => undefined)
  const isThere = ran !== undefined && ran.exitCode === 0
  await update($, mermaidTool, () => (isThere ? 'yes' : 'no'))
  return isThere
}

// The person's own cache folder for drawings, made private (0700) by node,
// which mmdc needs anyway: never a shared temp another user could seed.
async function diagramFolder($: EngineInterface, kind = 'mermaid'): Promise<string | undefined> {
  const folder = cacheFolder({
    xdg: await $.env.get('XDG_CACHE_HOME'),
    home: (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')),
    localAppData: await $.env.get('LOCALAPPDATA'),
  }, kind)
  if (folder === undefined) return undefined
  const made = await $.process
    .run(['node', '-e', "require('fs').mkdirSync(process.argv[1], { recursive: true, mode: 0o700 })", folder], { timeoutMs: 10000 })
    .catch(() => undefined)
  return made?.exitCode === 0 ? folder : undefined
}

// ---- picture conversion ----------------------------------------------------

const MAX_SVG_BYTES = 4 * 1024 * 1024

// The converters on this machine, looked for once (again after a refresh).
async function findConverters($: EngineInterface): Promise<Converters> {
  const known = await read($, converters)
  if (known !== null) return known
  const answers = async (argv: string[], says?: RegExp) => {
    const ran = await $.process.run(argv, { timeoutMs: 10000 }).catch(() => undefined)
    return ran !== undefined && ran.exitCode === 0 && (says === undefined || says.test(`${ran.stdout}${ran.stderr}`))
  }
  const present: Partial<Record<RasterTool, boolean>> = {
    sips: await $.fs.exists(SIPS).catch(() => false),
    ffmpeg: await answers(['ffmpeg', '-version']),
    magick: await answers(['magick', '-version'], /ImageMagick/),
  }
  // ImageMagick 6 is `convert`, a name Windows also uses for another tool.
  if (present.magick !== true) present.convert = await answers(['convert', '-version'], /ImageMagick/)
  const found: Converters = {
    raster: pickRaster(present),
    svg: (await answers(['rsvg-convert', '--version'])) ? 'rsvg-convert' : undefined,
  }
  await update($, converters, () => found)
  return found
}

// A converted picture's key: the file's path, time and size, so an edit
// converts again and nothing else does.
const pictureKey = (shown: ExplorerPreview) => diagramKey(`${shown.path}\0${Math.round(shown.mtimeMs ?? 0)}\0${shown.size ?? 0}`)

// What the shown file would convert from: a JPEG/GIF/WebP, or an SVG.
const convertible = (shown: ExplorerPreview): 'raster' | 'svg' | undefined =>
  shown.mode !== 'file' || !shown.isOnDisk
    ? undefined
    : shown.image !== undefined && shown.image.format !== 'png'
      ? 'raster'
      : /\.svg$/i.test(shown.path) && shown.text !== ''
        ? 'svg'
        : undefined

// Converts the shown picture to a PNG in the person's private cache, with a
// tool they have; the terminal then draws that.
async function convertPicture($: EngineInterface) {
  if (layout.pictures === 'off') return
  const shown = await read($, preview)
  if (shown === null) return
  const kind = convertible(shown)
  if (kind === undefined) return
  const key = pictureKey(shown)
  if ((await read($, pictures))[key] !== undefined) return
  const found = await findConverters($)
  const tool = kind === 'raster' ? found.raster : found.svg
  if (tool === undefined) return
  // The input is the file's real path inside the project, never a link out.
  const stat = await $.fs.stat(join(await read($, root), shown.path), { resolve: true }).catch(() => undefined)
  const real = stat?.realPath ?? ''
  const inside = cache.rootReal !== undefined && real.startsWith(`${cache.rootReal}/`)
  if (!inside || stat === undefined || (kind === 'svg' && stat.size > MAX_SVG_BYTES)) return
  const folder = await diagramFolder($, 'pictures')
  if (folder === undefined) return
  const output = `${folder}/${key}.png`
  await update($, pictures, all => ({ ...all, [key]: { status: 'drawing' as const } }))
  let failed: string | undefined
  if (!(await $.fs.exists(output).catch(() => false))) {
    let argv: string[]
    try {
      argv = kind === 'raster' ? rasterArgs(tool as RasterTool, shown.image?.format ?? 'jpeg', real, output) : svgArgs(real, output)
    } catch {
      argv = []
    }
    const ran = argv.length === 0 ? undefined : await $.process.run(argv, { timeoutMs: 30000 }).catch(() => undefined)
    failed = ran === undefined ? `${tool} did not finish.` : ran.exitCode === 0 ? undefined : convertError(ran.stderr, tool)
  }
  if (failed !== undefined) {
    await update($, pictures, all => ({ ...all, [key]: { status: 'error' as const, error: failed } }))
    return
  }
  const head = await $.fs.read(output, { as: 'bytes' }).catch(() => undefined)
  const info = typeof head?.base64 === 'string' ? imageInfo(decodeBase64(head.base64, 64)) : undefined
  const drawn: ExplorerDiagram = info?.format === 'png'
    ? { status: 'ok', png: output, width: info.width, height: info.height }
    : { status: 'error', error: `${tool} wrote no PNG.` }
  await update($, pictures, all => ({ ...all, [key]: drawn }))
}

// Draws the shown markdown's mermaid blocks with mmdc, one after another, a
// PNG for the terminal and an SVG for the apps, kept by content.
async function drawDiagrams($: EngineInterface) {
  if (layout.mermaid === 'off') return
  const shown = await read($, preview)
  if (shown === null || shown.mode !== 'rendered') return
  const known = await read($, diagrams)
  const sources = mermaidSources(shown.text).filter(source => known[diagramKey(source)] === undefined)
  if (sources.length === 0 || !(await hasMmdc($))) return
  const folder = await diagramFolder($)
  for (const source of sources) {
    const key = diagramKey(source)
    if ((await read($, diagrams))[key] !== undefined) continue
    if (folder === undefined) {
      await update($, diagrams, all => ({ ...all, [key]: { status: 'error' as const, error: 'No cache folder for drawings (HOME is unset).' } }))
      continue
    }
    await update($, diagrams, all => ({ ...all, [key]: { status: 'drawing' as const } }))
    const drawn = await drawOne($, folder, key, source)
    await update($, diagrams, all => ({ ...all, [key]: drawn }))
  }
}

async function drawOne($: EngineInterface, folder: string, key: string, source: string): Promise<ExplorerDiagram> {
  const png = `${folder}/${key}.png`
  const svg = `${folder}/${key}.svg`
  const make = async (output: string, format: 'png' | 'svg') => {
    if (await $.fs.exists(output).catch(() => false)) return undefined
    const ran = await $.process.run(mmdcArgs(output, format), { stdin: source, timeoutMs: 60000 }).catch(() => undefined)
    if (ran === undefined) return 'mmdc did not finish.'
    return ran.exitCode === 0 ? undefined : mmdcError(ran.stderr)
  }
  const failed = await make(png, 'png')
  if (failed !== undefined) return { status: 'error', error: failed }
  const head = await $.fs.read(png, { as: 'bytes' }).catch(() => undefined)
  const info = typeof head?.base64 === 'string' ? imageInfo(decodeBase64(head.base64, 64)) : undefined
  // The SVG is for the apps; a diagram without one still shows in the terminal.
  const vector = (await make(svg, 'svg')) === undefined ? await $.fs.read(svg).catch(() => undefined) : undefined
  return {
    status: 'ok',
    png,
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    svg: vector !== undefined && vector.length <= MAX_SVG_CHARS && vector.trimStart().startsWith('<svg') ? vector : undefined,
  }
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
  const facts = { size: bytes, mtimeMs: stat.mtimeMs }
  // A picture is not text: its header says what it is, and the terminal
  // reads the file itself to draw it.
  const named = imageFormatOf(rel)
  if (named !== undefined && stat.kind === 'file') {
    if (bytes > MAX_IMAGE_BYTES) return { text: '', note: `${Math.round(bytes / 1024)} KiB: too large to preview`, isOnDisk: true, ...facts }
    const head = bytes <= MAX_READ_BYTES ? await $.fs.read(join(dir, rel), { as: 'bytes' }).catch(() => undefined) : undefined
    const info = typeof head?.base64 === 'string' ? imageInfo(decodeBase64(head.base64, IMAGE_HEADER_BYTES)) : undefined
    const image = { format: info?.format ?? named, width: info?.width ?? 0, height: info?.height ?? 0, file: real }
    return { text: '', note: '', isOnDisk: true, image, ...facts }
  }
  if (bytes > MAX_PREVIEW_BYTES) {
    return { text: '', note: `${Math.round(bytes / 1024)} KiB: too large to preview`, isOnDisk: true, ...facts }
  }
  const text = await $.fs.read(join(dir, rel)).catch(() => undefined)
  if (text === undefined) return { text: '', note: 'could not be read', isOnDisk: false }
  if (text.includes('\0')) return { text: '', note: 'binary file', isOnDisk: true, ...facts }
  const clean = cleanText(text)
  if (clean.length <= MAX_CODE_CHARS) return { text: clean, note: '', isOnDisk: true, ...facts }
  const cut = clean.lastIndexOf('\n', MAX_CODE_CHARS) + 1 || MAX_CODE_CHARS
  return { text: clean.slice(0, cut), note: 'preview cut at 10000 characters', isOnDisk: true, ...facts }
}

const isMarkdown = (rel: string) => /\.(md|mdx|markdown)$/i.test(rel)

// What a file opens as from the tree: markdown rendered, the rest as source.
const isData = (rel: string) => isDelimited(rel) || isJson(rel)
const fileMode = (rel: string): ExplorerMode => (isMarkdown(rel) ? 'rendered' : isData(rel) ? 'data' : 'file')

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
  const wanted = (asked === 'rendered' && !isMarkdown(rel)) || (asked === 'data' && !isData(rel)) ? 'file' : asked
  const mode = change === undefined ? (wanted === 'diff' ? fileMode(rel) : wanted) : file.isOnDisk ? wanted : 'diff'
  const shown: ExplorerPreview = {
    path: rel,
    mode,
    text: file.text,
    diff: diff.diff,
    note: mode === 'diff' ? diff.note : file.note,
    isChanged: change !== undefined,
    isOnDisk: file.isOnDisk,
    size: (file as { size?: number }).size,
    mtimeMs: (file as { mtimeMs?: number }).mtimeMs,
    image: (file as { image?: ExplorerPreview['image'] }).image,
  }
  const before = await read($, preview)
  if (before === null || before.path !== rel || before.mode !== mode) {
    await update($, previewOffset, () => 0)
    await update($, sideways, () => 0)
  }
  await update($, preview, () => shown)
  if (layout.pictures === 'auto' && convertible(shown) !== undefined) {
    $.clock.after(0, () => void convertPicture($).catch(() => undefined))
  }
  if (mode === 'rendered' && layout.mermaid === 'auto' && /^\s*(`{3,}|~{3,})\s*(mermaid|mmd)\b/im.test(shown.text)) {
    $.clock.after(0, () => void drawDiagrams($).catch(() => undefined))
  }
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
  if (shown === null || shown.isHelp === true) return
  const isOpen = !layout.isSplit && (await $.ui.panes()).some(pane => pane.id === PREVIEW)
  const isSplitOpen = layout.isSplit && (await $.ui.panes()).some(pane => pane.id === EXPLORER)
  if (isOpen || isSplitOpen) {
    const offset = await read($, previewOffset)
    await showPath($, shown.path, { mode: shown.mode })
    await update($, previewOffset, () => offset)
    const blamed = await read($, blame)
    const now = await read($, preview)
    if (blamed !== null && now !== null && blamed.path === now.path && now.mode === 'file') await loadBlame($, now)
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

// Quotes the mouse selection into the prompt, named by the file in the
// preview and its lines when the selection is from there. Answers what it did.
async function quoteSelection($: EngineInterface, path: string | undefined): Promise<string> {
  const shown = await read($, preview)
  const picked = await $.ui.selection()
  if (picked === undefined || picked.text.trim() === '') {
    const why = 'Select lines with the mouse first (fullscreen mode), or quote a hunk'
    $.ui.toast(why)
    return why
  }
  const isPreview = picked.requestId === undefined && path !== undefined && shown !== null && shown.path === path
  const lines = isPreview && shown.mode !== 'diff' ? await pickedLines($, shown) : { start: 0, end: 0 }
  const label = linesLabel(lines.start, lines.end)
  const caption = isPreview ? `\`${path}\` ${label === '' ? '(selected)' : label}` : 'Selected'
  await quote($, picked.text, caption, '')
  const count = picked.text.trimEnd().split('\n').length
  return `Quoted ${count} line${count === 1 ? '' : 's'}${isPreview ? ` of ${oneLine(path)}` : ''} into the prompt.`
}



// ---- ignored files -------------------------------------------------------

const MAX_IGNORED = 5000

// What .gitignore leaves out, whole folders as one entry; empty outside git.
async function loadIgnored($: EngineInterface) {
  const listed = await git($, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
  const found = listed.exitCode === 0 ? parseIgnored(listed.stdout, MAX_IGNORED) : []
  await update($, ignored, () => found)
}

// ---- pins and copying ----------------------------------------------------

// Pins are kept per project in the store, so they outlast the session.
const pinsKey = (dir: string) => `pins:${dir}`

async function loadPins($: EngineInterface) {
  const dir = await read($, root)
  const kept = await $.store.get(pinsKey(dir)).catch(() => undefined)
  const list = Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string' && isPlainRelative(one)) : []
  const live: string[] = []
  for (const rel of list) if (await $.fs.exists(join(dir, rel)).catch(() => false)) live.push(rel)
  await update($, pins, () => live)
  if (live.length !== list.length) await $.store.set(pinsKey(dir), live).catch(() => undefined)
}

async function togglePin($: EngineInterface, rel: string) {
  const dir = await read($, root)
  await update($, pins, list => (list.includes(rel) ? list.filter(one => one !== rel) : [...list, rel]))
  await $.store.set(pinsKey(dir), await read($, pins)).catch(() => undefined)
}

async function copyPath($: EngineInterface, rel: string, surface: RenderSurface) {
  const copied = await $.ui.copy({ text: rel, surface })
  $.ui.toast(copied.isCopied ? `Copied ${oneLine(rel)}` : `Could not copy (${copied.reason})`)
}

// The help takes the preview's place; `i` again brings back what was there.
const beforeHelp: { shown?: ExplorerPreview | null } = {}

async function toggleHelp($: EngineInterface) {
  const shown = await read($, preview)
  if (shown?.isHelp === true) {
    const back = beforeHelp.shown ?? null
    beforeHelp.shown = undefined
    if (back === null) await update($, preview, () => null)
    else await showPath($, back.path, { mode: back.mode })
    return
  }
  beforeHelp.shown = shown
  const help: ExplorerPreview = {
    path: layout.language === 'ja' ? 'キーとコマンド' : 'Keys and commands',
    mode: 'rendered',
    text: helpText(layout.language),
    diff: '',
    note: '',
    isChanged: false,
    isOnDisk: false,
    isHelp: true,
  }
  await update($, preview, () => help)
  await update($, previewOffset, () => 0)
  if (!layout.isSplit) await $.ui.open({ id: PREVIEW, title: 'Help' })
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
  await loadIgnored($)
  await loadHistory($)
  // A newly installed mmdc is found, and failed diagrams are tried again.
  await update($, mermaidTool, () => 'unknown')
  await update($, converters, () => null)
  await update($, pictures, all => Object.fromEntries(Object.entries(all).filter(([, one]) => one.status === 'ok')))
  await update($, diagrams, all => Object.fromEntries(Object.entries(all).filter(([, one]) => one.status === 'ok')))
  const narrowed = await read($, historyOf)
  if (narrowed !== '') await loadFileLog($, narrowed)
  await reloadPreview($)
}

const VIEWS = new Set(['files', 'changes', 'history', 'search', 'outline'])

async function openExplorer($: EngineInterface, wanted: string) {
  if (VIEWS.has(wanted)) await update($, view, () => wanted as ExplorerView)
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
async function pickedLines($: EngineInterface, shown: ExplorerPreview): Promise<{ start: number; end: number; text?: string; at?: string }> {
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
  // The JSON node picked in the tree.
  const data = await read($, dataView)
  if (shown.mode === 'data' && data.path === shown.path && data.pick !== '') {
    return { start: 0, end: 0, at: data.pick }
  }
  // The symbol jumped to from the outline, while its first line shows.
  const chosen = await read($, symbol)
  if (chosen !== null && chosen.path === shown.path && chosen.start >= layout.visible.start && chosen.start <= layout.visible.end) {
    return { start: chosen.start, end: chosen.end }
  }
  return { ...layout.visible }
}

const linesLabel = (start: number, end: number) =>
  start <= 0 ? '' : start === end ? `line ${start}` : `lines ${start}-${end}`

// `@path (lines a-b)` into the prompt: the file attached, the lines named.
async function referenceLines($: EngineInterface, shown: ExplorerPreview): Promise<string> {
  const { start, end, at } = await pickedLines($, shown)
  const label = at ?? linesLabel(start, end)
  const { text, cursor } = await $.prompt.read()
  const before = text.slice(0, cursor)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const reference = `@${shown.path}${label === '' ? '' : ` (${label})`}`
  const filled = await $.prompt.fill({ text: `${lead}${reference} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not insert @${oneLine(shown.path)}`)
  return filled.isFilled ? `Inserted ${oneLine(reference)}.` : `Could not insert @${oneLine(shown.path)}.`
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
          onInput={async (value: string) => {
            if (isText) await update($, search, now => ({ ...now, query: value }))
            else await searchFiles($, value)
            // Keep typing in the field however much the results moved around it.
            await $.ui.focus({ requestId: EXPLORER, key: 'search-input' }).catch(() => undefined)
          }}
          onSubmit={async (value: string) => {
            if (isText) {
              await searchText($, value)
              const first = (await read($, search)).hits[0]
              if (first !== undefined) await focusOn($, `hit:${first.path}:${first.line}:${first.column}`)
              return
            }
            await searchFiles($, value)
            const first = (await read($, search)).files[0]
            if (first !== undefined) await openFound($, first)
          }}
        />
      )}
      <Text dimColor>{fit(found.note || (isText ? 'ripgrep, ignore files honoured' : 'fuzzy, as you type'), width)}</Text>
    </Box>
  )
}

// Ages are a nicety: where no clock answers (a bare host), they are left out.
async function clockNow($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return 0
  }
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
  const isHidingIgnored = await read($, hideIgnored)
  // The tabs and the list's scroll Buttons, measured and packed into rows
  // that fit the sidebar: a Button pushed off the edge loses its hotkey.
  const isRoomy = width >= 44
  type Tab = { key: string; cells: number; draw: () => RenderElement }
  const tab = (key: ExplorerView, label: string, hotkey: string): Tab => ({
    key,
    cells: buttonCells(label, true),
    draw: () => (
      <Button key={`tab:${key}`} label={label} plain hotkey={hotkey} dimColor={current === key ? undefined : true}
        onPress={async () => {
          await update($, view, () => key)
          // The search tab is for typing: its field takes the focus, and only then.
          if (key === 'search') await focusOn($, 'search-input')
        }} />
    ),
  })
  const tabItems: Tab[] = [
    tab('files', 'Files', 'f'),
    tab('changes', `${isRoomy ? 'Changes' : 'Chg'} ${list.length}`, 'c'),
    tab('history', isRoomy ? 'History' : 'Log', 'h'),
    tab('search', isRoomy ? 'Search' : 'Find', 's'),
    tab('outline', isRoomy ? 'Outline' : 'Out', 't'),
    {
      key: 'ignored',
      cells: buttonCells('⊘', true),
      draw: () => (
        <Button key="ignored" label="⊘" plain hotkey="g" dimColor={isHidingIgnored ? undefined : true}
          onPress={() => update($, hideIgnored, now => !now)} />
      ),
    },
    {
      key: 'help',
      cells: buttonCells('?', true),
      draw: () => <Button key="help" label="?" plain hotkey="i" onPress={() => toggleHelp($)} />,
    },
  ]
  // Always drawn in the split view, dim when the list fits: these sit
  // before the search field, and a control appearing or vanishing there as
  // results change moved the focus off the field mid-typing.
  if (rows !== undefined) {
    tabItems.push({
      key: 'list:up',
      cells: buttonCells('▲', false),
      draw: () => (
        <Button key="list:up" label="▲" plain dimColor={isOver ? undefined : true}
          onPress={() => scroll(-Math.max(1, room - 2))} />
      ),
    })
    tabItems.push({
      key: 'list:down',
      cells: buttonCells('▼', false),
      draw: () => (
        <Button key="list:down" label="▼" plain dimColor={isOver ? undefined : true}
          onPress={() => scroll(Math.max(1, room - 2))} />
      ),
    })
  }
  const tabRows = packRows(tabItems, Math.max(8, width))
  let fixed = 1 + tabRows.length
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
              <Button key={`found:${path}`} label={label} plain onPress={() => openFound($, path)} />
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
    const narrowed = await read($, historyOf)
    const ofFile = narrowed === '' ? [] : await read($, fileHistory)
    const commits: (ExplorerCommit & { path?: string })[] = narrowed === '' ? await read($, history) : ofFile
    if (narrowed !== '') {
      extra.push(
        <Box key="history:of" flexDirection="row">
          <Text color="blue">{fit(`⌚ ${narrowed}`, Math.max(4, width - 6))}</Text>
          <Box flexGrow={1} />
          <Button key="history:all" label="✕" plain onPress={() => update($, historyOf, () => '')} />
        </Box>,
      )
    }
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
            <Button key={`commit:${commit.sha}`} label={subject} plain
              onPress={() => (commit.path === undefined ? openCommit($, commit) : openFileCommit($, { ...commit, path: commit.path }))} />
            {rest > 6 && <Text dimColor> {fit(`${commit.when}, ${commit.author}`, rest)}</Text>}
          </Box>
        ),
      }
    })
  } else if (current === 'outline') {
    const shown = await read($, preview)
    if (shown === null || shown.isHelp === true || shown.text === '') {
      extra.push(<Text dimColor>Open a file to see its outline.</Text>)
    } else if (!hasOutline(shown.path)) {
      extra.push(<Text dimColor>No outline for this kind of file.</Text>)
    } else {
      const entries = outlineFor(shown)
      if (entries.length === 0) extra.push(<Text dimColor>No symbols or headings found.</Text>)
      // The entry the preview's top line sits in, deepest first.
      const top = (await read($, previewOffset)) + 1
      let here = -1
      entries.forEach((entry, i) => {
        if (entry.line <= top && top <= entry.end) here = i
      })
      lines = entries.map((entry, i) => {
        const indent = '  '.repeat(Math.min(entry.depth, 6))
        const mark = KIND_MARK[entry.kind]
        const number = String(entry.line)
        const room = width - 4 - indent.length - number.length - 1
        return {
          key: `sym:${entry.line}`,
          node: () => (
            <Box key={`symline:${entry.line}`} flexDirection="row">
              <Text color="blue">{i === here ? '▌' : ' '}</Text>
              <Text dimColor>{indent}</Text>
              <Text color={mark.color}>{mark.glyph} </Text>
              <Button key={`sym:${entry.line}`} label={fit(entry.name, room)} plain
                onPress={() => jumpTo($, entry)} />
              <Box flexGrow={1} />
              <Text dimColor> {number}</Text>
            </Box>
          ),
        }
      })
    }
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
    const ignoredSet = new Set(await read($, ignored))
    const isHiding = await read($, hideIgnored)
    const tree = flatten(all, open).filter(row => !isHiding || !isIgnored(row.rel, ignoredSet))
    if (tree.length === 0) extra.push(<Text dimColor>(empty)</Text>)
    // Sizes and ages beside files, when the sidebar has room for them.
    const now = await clockNow($)
    const showDetails = width >= 36
    const pinned = await read($, pins)
    const pinLines = pinned.length === 0 ? [] : [
      { key: 'pins:header', node: () => <Text key="pins:header" dimColor>★ Pinned</Text> },
      ...pinned.map(rel => {
        const icon = iconFor(baseName(rel), false, false, layout.icons)
        const room = width - 3 - iconWidth(icon, layout.icons)
        const label = fit(baseName(rel), room)
        const rest = room - label.length - 1
        return {
          key: `pin:${rel}`,
          node: () => (
            <Box key={`pinline:${rel}`} flexDirection="row">
              <Text color="blue">{rel === chosen ? '▌' : ' '}</Text>
              <Text> </Text>
              {icon.glyph !== '' && <Text color={icon.color}>{icon.glyph}</Text>}
              <Button key={`pinned:${rel}`} label={label} plain onPress={() => showPath($, rel, { mode: fileMode(rel) })} />
              {parentOf(rel) !== '' && rest > 3 && <Text dimColor> {fit(parentOf(rel), rest)}</Text>}
            </Box>
          ),
        }
      }),
    ]
    lines = pinLines
    lines = lines.concat(tree.map(({ rel, depth, entry }) => {
      const letter = entry.isDir ? folders[rel] : status[rel]
      const badge = letter === undefined ? '' : entry.isDir ? '●' : letter
      const mark = edited.has(rel) ? '✎' : ''
      const indent = '  '.repeat(depth)
      // Folders: a blue chevron, their icon and a trailing slash; files: their icon.
      const isOpen = open.has(rel)
      const chevron = entry.isDir ? (isOpen ? '▾ ' : '▸ ') : layout.icons === 'ascii' ? '' : '  '
      const icon = iconFor(entry.name, entry.isDir, isOpen, layout.icons)
      const name = entry.isDir ? `${entry.name}/` : entry.name
      const dim = isIgnored(rel, ignoredSet)
      const detail = showDetails && !entry.isDir ? `${formatSize(entry.size)} ${formatAge(entry.mtimeMs ?? 0, now)}`.trimEnd() : ''
      const used = indent.length + chevron.length + iconWidth(icon, layout.icons) + badge.length + mark.length + (detail === '' ? 0 : detail.length + 1)
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
              dimColor={dim ? true : undefined}
              onPress={() => (entry.isDir ? toggleDir($, rel) : showPath($, rel, { mode: fileMode(rel), size: entry.size }))}
            />
            <Box flexGrow={1} />
            {detail !== '' && <Text dimColor> {detail}</Text>}
            {mark !== '' && <Text color="blue">{mark}</Text>}
            {badge !== '' && <Text color={BADGE_COLOR[letter ?? ''] ?? 'yellow'}> {badge}</Text>}
          </Box>
        ),
      }
    }))
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
      {tabRows.map((row, i) => (
        <Box key={`tabs:${i}`} flexDirection="row" gap={1}>
          {row.map(one => one.draw())}
        </Box>
      ))}
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
  surface: RenderSurface,
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
  // A data file: each table or tree row one terminal row, cut, never wrapped.
  const parsed = shown.mode === 'data' && shown.text !== '' ? dataFor(shown) : undefined
  const tree = parsed?.kind === 'tree' ? await read($, dataView) : undefined
  const nodes = parsed?.kind === 'tree' && tree !== undefined
    ? jsonRows(parsed.root, new Set(tree.path === shown.path ? tree.toggled : []), 2, MAX_DATA_ROWS)
    : []
  const pick = tree !== undefined && tree.path === shown.path ? tree.pick : ''
  const dataTotal = parsed === undefined ? 0 : parsed.kind === 'table' ? parsed.lines.length : parsed.kind === 'tree' ? nodes.length : 1
  const total = shown.mode === 'data' ? dataTotal : isSource ? fileLines.length : hunkRows.reduce((sum, n) => sum + n, 0)
  const blamed = await read($, blame)
  const blameOf = blamed !== null && blamed.path === shown.path && shown.mode === 'file' ? blamed : undefined
  // Blame lines up beside the source one row a line: no wrapping under it.
  const isWrapped = (await read($, wrapLines)) && blameOf === undefined
  const blameCells = blameOf === undefined ? 0 : width >= 70 ? 24 : 8
  const isTable = parsed?.kind === 'table'
  const shift = isWrapped && !isTable ? 0 : await read($, sideways)
  const isMd = isMarkdown(shown.path)
  const isDataFile = isData(shown.path)
  const lineRoomEstimate = Math.max(10, width - String(Math.max(total, 1)).length * (shown.mode === 'diff' ? 2 : 1) - 6)
  const tableWidest = parsed?.kind === 'table' ? widest(parsed.lines.map(one => one.text)) : 0
  const canShiftEstimate =
    (isTable && tableWidest > width - 2) ||
    (!isWrapped &&
      (shown.mode === 'file' || shown.mode === 'diff') &&
      widest(isSource ? fileLines : hunks.map(hunk => hunk.body).join('\n').split('\n')) > lineRoomEstimate)

  // The toolbar, each Button with the cells it draws in, packed into rows
  // that fit: a row that overflowed dropped its last Buttons, hotkeys and all.
  type Tool = { key: string; cells: number; draw: () => RenderElement }
  const tool = (key: string, label: string, hotkey: string | undefined, draw: () => RenderElement): Tool => ({
    key,
    cells: buttonCells(label, hotkey !== undefined),
    draw,
  })
  const tools: Tool[] = []
  // Placeholders for closures defined once the window is known.
  const late: { scroll: (by: number) => unknown; slide: (by: number) => unknown; isOver: boolean; room: number; shift: number } = {
    scroll: () => undefined,
    slide: () => undefined,
    isOver: false,
    room: 1,
    shift,
  }
  if (shown.isOnDisk && isMd) {
    tools.push(tool('mode:rendered', 'Preview', 'm', () => (
      <Button key="mode:rendered" label="Preview" plain hotkey="m" dimColor={shown.mode === 'rendered' ? undefined : true}
        onPress={() => showPath($, shown.path, { mode: 'rendered' })} />
    )))
  }
  if (shown.isOnDisk && isDataFile) {
    const label = isDelimited(shown.path) ? 'Table' : 'Tree'
    tools.push(tool('mode:data', label, 'm', () => (
      <Button key="mode:data" label={label} plain hotkey="m" dimColor={shown.mode === 'data' ? undefined : true}
        onPress={() => showPath($, shown.path, { mode: 'data' })} />
    )))
  }
  if (shown.isOnDisk && (isMd || isDataFile || shown.isChanged)) {
    const label = isMd || isDataFile ? 'Source' : 'File'
    tools.push(tool('mode:file', label, 'o', () => (
      <Button key="mode:file" label={label} plain hotkey="o" dimColor={shown.mode === 'file' ? undefined : true}
        onPress={() => showPath($, shown.path, { mode: 'file' })} />
    )))
  }
  if (shown.isChanged) {
    tools.push(tool('mode:diff', 'Diff', 'd', () => (
      <Button key="mode:diff" label="Diff" plain hotkey="d" dimColor={shown.mode === 'diff' ? undefined : true}
        onPress={() => showPath($, shown.path, { mode: 'diff' })} />
    )))
  }
  // Always drawn, dim when there is nowhere to go, so the toolbar's
  // Buttons never shift under the focus as the content changes.
  tools.push(tool('up', '▲', 'k', () => (
    <Button key="up" label="▲" plain hotkey="k" dimColor={late.isOver ? undefined : true}
      onPress={() => late.scroll(-Math.max(1, Math.floor(late.room / 2)))} />
  )))
  tools.push(tool('down', '▼', 'j', () => (
    <Button key="down" label="▼" plain hotkey="j" dimColor={late.isOver ? undefined : true}
      onPress={() => late.scroll(Math.max(1, Math.floor(late.room / 2)))} />
  )))
  if (list.length > 0) {
    tools.push(tool('prev', '‹', 'p', () => <Button key="prev" label="‹" plain hotkey="p" onPress={() => step(-1)} />))
    tools.push(tool('next', '›', 'n', () => <Button key="next" label="›" plain hotkey="n" onPress={() => step(1)} />))
  }
  tools.push(tool('wrap', '↩', 'w', () => (
    <Button key="wrap" label="↩" plain hotkey="w" dimColor={isWrapped ? undefined : true}
      onPress={() => update($, wrapLines, now => !now)} />
  )))
  if (canShiftEstimate) {
    tools.push(tool('left', '◀', undefined, () => (
      <Button key="left" label="◀" plain dimColor={late.shift === 0 ? true : undefined} onPress={() => late.slide(-1)} />
    )))
    tools.push(tool('right', '▶', undefined, () => <Button key="right" label="▶" plain onPress={() => late.slide(1)} />))
  }
  if (shown.isHelp !== true) {
    tools.push(tool('quote', '❝', 'q', () => <Button key="quote" label="❝" plain hotkey="q" onPress={() => quoteSelection($, shown.path)} />))
    tools.push(tool('ref', '#', 'r', () => <Button key="ref" label="#" plain hotkey="r" onPress={() => referenceLines($, shown)} />))
    tools.push(tool('copy', '⧉', 'y', () => (
      <Button key="copy" label="⧉" plain hotkey="y" onPress={press => copyPath($, shown.path, press.surface)} />
    )))
    const isPinned = (await read($, pins)).includes(shown.path)
    tools.push(tool('pin', '★', 'b', () => (
      <Button key="pin" label={isPinned ? '★' : '☆'} plain hotkey="b" onPress={() => togglePin($, shown.path)} />
    )))
    const isRepo = (await read($, gitError)) !== 'Not a git repository'
    if (isRepo) {
      tools.push(tool('log', 'Log', 'l', () => <Button key="log" label="Log" plain hotkey="l" onPress={() => showFileLog($, shown.path)} />))
    }
    if (isRepo && shown.isOnDisk) {
      tools.push(tool('blame', 'Blame', 'a', () => (
        <Button key="blame" label="Blame" plain hotkey="a" dimColor={blameOf === undefined ? true : undefined}
          onPress={() => toggleBlame($, shown.path)} />
      )))
    }
  }
  if (isOwnPane) {
    tools.push(tool('mention', '@', undefined, () => <Button key="mention" label="@" plain onPress={() => mention($, shown.path)} />))
    tools.push(tool('close', '✕', undefined, () => (
      <Button key="close" label="✕" plain role="dismiss" onPress={() => $.ui.close({ id: PREVIEW })} />
    )))
  }
  const toolRows = packRows(tools, Math.max(8, width - 1))
  const hasStatus = shown.isChanged || total > 0 || shown.size !== undefined
  const nowMs = await clockNow($)
  const ageText = shown.mtimeMs === undefined ? '' : formatAge(shown.mtimeMs, nowMs)
  const fixed = 1 + toolRows.length + (hasStatus ? 1 : 0) + (shown.note !== '' ? 1 : 0) + (pick !== '' ? 1 : 0)
  const room = rows === undefined ? total : Math.max(1, rows - fixed)

  // The rows each unit takes: a line wrapped into the room beside its gutter
  // (line numbers; a diff's two plus its marker), a hunk label one.
  const digits = String(Math.max(total, 1)).length
  const gutter = shown.mode === 'diff' ? digits * 2 + 5 : digits + 3
  const lineRoom = Math.max(10, width - gutter - 1 - blameCells)
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
  const widestLine = isTable ? tableWidest : !isWrapped && isCounted ? widest(isSource ? fileLines : hunks.map(hunk => hunk.body).join('\n').split('\n')) : 0
  const slideRoom = isTable ? width - 1 : lineRoom
  const sidewaysStep = Math.max(8, Math.floor(slideRoom / 2))
  const slide = (by: number) =>
    update($, sideways, now => clamp(now + by * sidewaysStep, 0, Math.max(0, widestLine - slideRoom + 2)))
  late.scroll = scroll
  late.slide = slide
  late.isOver = isOver
  late.room = room

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
    const drawings = await read($, diagrams)
    const tool = await read($, mermaidTool)
    const { Image } = surface === 'terminal' ? (els as ElementTable<'terminal'>) : { Image: undefined }
    const Svg = surface === 'terminal' ? undefined : (els as ElementTable<'desktop'>).Svg
    let hasHinted = false
    splitMarkdown(part.text).forEach((piece, i) => {
      // A mermaid block mmdc drew: the picture in place of its source.
      const drawn = piece.kind === 'code' && isMermaid(piece.language) && layout.mermaid === 'auto' ? drawings[diagramKey(piece.text)] : undefined
      if (drawn?.status === 'ok') {
        if (Image !== undefined && drawn.png !== undefined) {
          const box = imageCells(drawn.width ?? 0, drawn.height ?? 0, width - 1, rows === undefined ? 40 : room)
          body.push(
            <Image key={`diagram:${i}`} source={{ file: drawn.png, format: 'png' }} columns={box.columns} rows={box.rows}
              alt="Mermaid diagram (pictures show in kitty and Ghostty; o for the source)" />,
          )
          return
        }
        if (Svg !== undefined && drawn.svg !== undefined) {
          body.push(<Svg key={`diagram:${i}`} source={drawn.svg} alt="Mermaid diagram" />)
          return
        }
      }
      if (piece.kind === 'code' && isMermaid(piece.language) && layout.mermaid === 'auto') {
        if (drawn?.status === 'drawing') body.push(<Text key={`diagram-note:${i}`} dimColor>Drawing the diagram with mmdc…</Text>)
        else if (drawn?.status === 'error') body.push(<Text key={`diagram-note:${i}`} color="red">{fit(`mmdc: ${drawn.error ?? 'failed'}`, Math.max(8, width - 2))}</Text>)
        else if (tool === 'no' && !hasHinted) {
          hasHinted = true
          body.push(<Text key={`diagram-note:${i}`} dimColor>Install mermaid-cli (npm i -g @mermaid-js/mermaid-cli) to draw diagrams.</Text>)
        }
      }
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
  if (parsed?.kind === 'error') {
    layout.visible = { start: parsed.line, end: parsed.line }
    body.push(<Text color="red">{parsed.text}</Text>)
    body.push(<Text dimColor>Press o for the source.</Text>)
  }
  if (parsed?.kind === 'table') {
    const part = parsed.lines.slice(offset, offset + count)
    layout.visible = { start: part[0]?.line ?? 0, end: part[part.length - 1]?.line ?? 0 }
    part.forEach((one, i) => {
      const text = fitCells(shiftCells(one.text, shift), Math.max(4, width - 1)).trimEnd()
      body.push(
        one.isRule ? (
          <Text key={`row:${offset + i}`} dimColor>{text}</Text>
        ) : (
          <Text key={`row:${offset + i}`} bold={one.isHeader}>{text === '' ? ' ' : text}</Text>
        ),
      )
    })
    if (parsed.isCut && offset + count >= total) body.push(<Text dimColor>(first {MAX_DATA_RECORDS} records)</Text>)
  }
  if (parsed?.kind === 'tree') {
    const part = nodes.slice(offset, offset + count)
    layout.visible = { start: part[0]?.line ?? 0, end: part[part.length - 1]?.line ?? 0 }
    if (nodes.length === 0) body.push(<Text dimColor>(empty)</Text>)
    for (const row of part) {
      const indent = '  '.repeat(Math.min(row.depth, 12))
      const chevron = row.isOpen === undefined ? '  ' : row.isOpen ? '▾ ' : '▸ '
      const label = row.key === '' ? '(value)' : row.key
      const keyRoom = Math.max(4, Math.floor((width - indent.length - 4) / 2))
      const keyText = fitCells(label, Math.min(keyRoom, cellWidth(label))).trimEnd()
      const valueRoom = Math.max(4, width - 3 - indent.length - chevron.length - cellWidth(keyText) - 2)
      body.push(
        <Box key={`node:${row.path}`} flexDirection="row">
          <Text color="blue">{row.path === pick ? '▌' : ' '}</Text>
          <Text dimColor>{indent}</Text>
          <Text color="blue">{chevron}</Text>
          <Button key={`json:${row.path}`} label={keyText} plain onPress={() => pickNode($, shown.path, row)} />
          <Text dimColor>: </Text>
          <Text color={JSON_COLOR[row.kind]} dimColor={row.kind === 'null' || row.isOpen !== undefined || row.text.startsWith('{') || row.text.startsWith('[') ? true : undefined}>
            {fitCells(row.text, valueRoom).trimEnd()}
          </Text>
        </Box>,
      )
    }
    if (nodes.length >= MAX_DATA_ROWS && offset + count >= total) body.push(<Text dimColor>(first {MAX_DATA_ROWS} rows; fold some to see more)</Text>)
  }
  // Pictures: PNG drawn where the surface has Image (the terminal, in
  // kitty or Ghostty; its alt text elsewhere), the rest named with their size.
  const picture = shown.mode === 'file' ? shown.image : undefined
  // A JPEG/GIF/WebP or SVG converted to PNG by the person's own tool.
  const converted = layout.pictures === 'auto' && convertible(shown) !== undefined ? (await read($, pictures))[pictureKey(shown)] : undefined
  const found = layout.pictures === 'auto' ? await read($, converters) : null
  const drawConverted = (Image: ElementTable<'terminal'>['Image'], alt: string) => {
    if (converted?.status !== 'ok' || converted.png === undefined) return false
    const box = imageCells(converted.width ?? 0, converted.height ?? 0, width - 1, rows === undefined ? 40 : room)
    body.push(<Image key="converted" source={{ file: converted.png, format: 'png' }} columns={box.columns} rows={box.rows} alt={alt} />)
    return true
  }
  const convertNote = (missing: string) => {
    if (converted?.status === 'drawing') body.push(<Text key="convert-note" dimColor>Converting to draw it…</Text>)
    else if (converted?.status === 'error') body.push(<Text key="convert-note" color="red">{fit(converted.error ?? 'conversion failed', Math.max(8, width - 2))}</Text>)
    else if (found !== null && converted === undefined && missing !== '') body.push(<Text key="convert-note" dimColor>{missing}</Text>)
  }
  if (picture !== undefined) {
    // Only the terminal's table has Image; another surface's has none to draw.
    const Image = surface === 'terminal' ? (els as ElementTable<'terminal'>).Image : undefined
    const dims = picture.width > 0 ? ` ${picture.width}×${picture.height}` : ''
    const kind = picture.format.toUpperCase()
    if (picture.format !== 'png' && Image !== undefined && drawConverted(Image, `${kind} image${dims} (pictures show in kitty and Ghostty)`)) {
      // Drawn from the converted PNG.
    } else if (picture.format === 'png' && Image !== undefined) {
      const box = imageCells(picture.width, picture.height, width - 1, rows === undefined ? 40 : room)
      body.push(
        <Image
          key="picture"
          source={{ file: picture.file, format: 'png', generation: Math.round(shown.mtimeMs ?? 0) }}
          columns={box.columns}
          rows={box.rows}
          alt={`${kind} image${dims} (pictures show in kitty and Ghostty)`}
        />,
      )
    } else {
      body.push(<Text>{`${kind} image${dims}`}</Text>)
      if (picture.format !== 'png' && Image !== undefined && layout.pictures === 'auto' && (found?.raster !== undefined || converted !== undefined)) {
        convertNote('')
      } else {
        body.push(
          <Text dimColor>
            {picture.format === 'png'
              ? 'Pictures are drawn in the terminal (kitty, Ghostty).'
              : Image !== undefined && layout.pictures === 'auto' && found !== null
                ? 'Install ffmpeg or ImageMagick to draw JPEG, GIF and WebP here.'
                : 'Only PNG is drawn; open it in a viewer to see it.'}
          </Text>,
        )
      }
    }
  }
  // SVG in the terminal: the converted PNG above its source.
  if (surface === 'terminal' && convertible(shown) === 'svg' && offset === 0) {
    const Image = (els as ElementTable<'terminal'>).Image
    if (!drawConverted(Image, `${baseName(shown.path)} (pictures show in kitty and Ghostty)`)) {
      convertNote(found !== null && found.svg === undefined ? 'Install rsvg-convert (librsvg) to draw SVG here.' : '')
    }
  }
  // SVG is source, drawn above it where the surface has Svg.
  if (shown.mode === 'file' && /\.svg$/i.test(shown.path) && shown.text !== '' && shown.note === '' && offset === 0) {
    const Svg = surface === 'terminal' ? undefined : (els as ElementTable<'desktop'>).Svg
    if (Svg !== undefined) body.push(<Svg key="svg" source={shown.text} alt={baseName(shown.path)} />)
  }
  if (shown.mode === 'file' && fileLines.length > 0 && blameOf !== undefined) {
    // A run of lines from one commit is labelled once, at its top.
    const nowMs = await clockNow($)
    const marks: RenderElement[] = []
    for (let i = offset; i < offset + count; i++) {
      const sha = blameOf.shas[i] ?? ''
      const details = blameOf.commits[sha]
      if (details === undefined || (i > offset && blameOf.shas[i - 1] === sha)) {
        marks.push(<Text key={`blame:${i + 1}`}>{' '}</Text>)
        continue
      }
      const isMine = sha === UNCOMMITTED
      const rest = blameCells - 8
      const who = isMine ? 'uncommitted' : details.author
      const age = isMine ? '' : formatAge(details.time * 1000, nowMs)
      marks.push(
        <Box key={`blame:${i + 1}`} flexDirection="row">
          <Button key={`blamed:${i + 1}`} label={isMine ? '·······' : details.short} plain dimColor
            onPress={() => openBlamed($, shown.path, sha, details)} />
          {rest > 4 && <Text dimColor> {fitCells(who, rest - 5)} {fitCells(age, 3)}</Text>}
        </Box>,
      )
    }
    body.push(
      <Box key="blamed" flexDirection="row">
        <Box flexDirection="column" width={blameCells} flexShrink={0}>{marks}</Box>
        <Code
          source={`${fileLines.slice(offset, offset + count).map(line => shiftCells(line, shift)).join('\n')}\n`}
          path={shown.path}
          startLine={offset + 1}
          wrap="truncate-end"
        />
      </Box>,
    )
  }
  if (shown.mode === 'file' && fileLines.length > 0 && blameOf === undefined) {
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
      <Text bold>
        {layout.icons === 'ascii' ? '' : iconFor(baseName(shown.path), false, false, layout.icons).glyph}
        {fit(shown.path, Math.max(4, width - 4))}
      </Text>
      {toolRows.map((row, i) => (
        <Box key={`tools:${i}`} flexDirection="row" gap={1}>
          {row.map(one => one.draw())}
        </Box>
      ))}
      {hasStatus && (
        <Text dimColor>
          {change !== undefined && <Text color={BADGE_COLOR[change.letter] ?? 'yellow'}>{change.letter}</Text>}
          {fit(
            [
              change !== undefined ? ` ${verb} ${against.label} · ${at + 1}/${list.length}` : '',
              total > 0 ? `${change !== undefined ? ' ·' : ''} ${shown.mode === 'diff' || shown.mode === 'data' ? 'rows' : 'lines'} ${offset + 1}-${shownEnd}/${total}` : '',
              shown.size !== undefined ? ` · ${formatSize(shown.size)}${ageText === '' ? '' : ` · ${ageText} ago`}` : '',
            ].join(''),
            Math.max(4, width - 3),
          )}
        </Text>
      )}
      {shown.note !== '' && <Text dimColor>{shown.note}</Text>}
      {pick !== '' && <Text color="blue">{fit(`at ${pick}`, Math.max(4, width - 3))}</Text>}
      {body}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const style = options.icons
  layout.icons = style === 'nerd' || style === 'ascii' ? style : 'emoji'
  layout.language = options.language === 'ja' ? 'ja' : 'en'
  layout.mermaid = options.mermaid === 'off' ? 'off' : 'auto'
  layout.pictures = options.pictures === 'off' ? 'off' : 'auto'
  let pending: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'files',
      description: 'Open the file explorer',
      argumentHint: '[files|changes|history|search|outline|help]',
    })
    // A mouse selection leaves the keys with the prompt, where the pane's
    // q and r never arrive: these do the same from the prompt.
    await $.command.register({
      name: 'quote',
      description: 'Quote the mouse selection into the prompt (from the explorer preview: with its file and lines)',
      immediate: true,
    })
    await $.command.register({
      name: 'ref',
      description: 'Insert @file (lines a-b) for the selection in the explorer preview, or the lines in view',
      immediate: true,
    })
    await $.command.register({
      name: 'search',
      description: 'Search file contents with ripgrep, shown in the explorer',
      argumentHint: '[text]',
    })
    await $.command.register({
      name: 'changes',
      description: 'Browse git changes against a ref or a range (HEAD by default)',
      argumentHint: '[ref | a..b | turn | pr [number] [base]]',
    })
    if ((await read($, root)) !== e.cwd) {
      await update($, root, () => e.cwd)
      await update($, expanded, () => [])
      await update($, listings, () => ({}))
      await update($, base, () => HEAD)
    }
    await loadPins($)
    await refreshAll($)
    void $.ui.open({ id: EXPLORER, title: 'Explorer' })

    return next(e)
  })

  on('command.run', { command: 'files' }, async ($, e) => {
    const opened = await openExplorer($, e.args.trim())
    if (e.args.trim() === 'help' && (await read($, preview))?.isHelp !== true) await toggleHelp($)
    return { text: opened.isPlaced ? 'Explorer opened.' : `Explorer not shown: ${opened.reason}` }
  })

  on('command.run', { command: 'quote' }, async $ => {
    const shown = await read($, preview)
    return { text: await quoteSelection($, shown?.path) }
  })

  on('command.run', { command: 'ref' }, async $ => {
    const shown = await read($, preview)
    if (shown === null) return { text: 'Open a file in the explorer first.' }
    return { text: await referenceLines($, shown) }
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
        {await drawPreview($, els, width - sidebar - 2, rows, false, e.surface)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PREVIEW }, async ($, e) => {
    return drawPreview($, $.ui.resolve(e), Math.max(20, e.props.bodyColumns), undefined, true, e.surface)
  })
}
