import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ExplorerBase,
  ExplorerChange,
  ExplorerCommit,
  ExplorerEntry,
  ExplorerPreview,
  ExplorerView,
} from '../types'

const EXPLORER = 'file-explorer'
const PREVIEW = 'file-preview'

const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const EDITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAX_ROWS = 1500
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_CODE_CHARS = 10000
const MAX_COMMITS = 100
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

const fit = (text: string, room: number) =>
  room <= 1 ? text.slice(0, Math.max(0, room)) : text.length <= room ? text : `${text.slice(0, room - 1)}…`

const sortEntries = (entries: ExplorerEntry[]) =>
  [...entries].sort((a, b) =>
    a.isDir !== b.isDir
      ? a.isDir
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  )

// Code takes tab and newline as its only control characters.
const cleanText = (text: string) =>
  text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

async function git($: EngineInterface, args: string[]) {
  const cwd = await read($, root)
  return $.process
    .run(['git', ...args], { cwd, timeoutMs: 15000 })
    .catch(() => ({ exitCode: -1, stdout: '', stderr: 'git could not run' }))
}

// ---- files ---------------------------------------------------------------

async function loadDir($: EngineInterface, rel: string): Promise<boolean> {
  const dir = await read($, root)
  const listed = await $.fs.list(join(dir, rel)).catch(() => undefined)
  if (listed === undefined) {
    await update($, listings, all => {
      const { [rel]: _gone, ...rest } = all
      return rest
    })
    return false
  }
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
  await update($, listings, all => ({ ...all, [rel]: sortEntries(entries) }))
  return true
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

const letterOf = (status: string) => {
  const head = status.charAt(0)
  if (head === 'T') return 'M'
  if (head === 'U') return '!'
  return head === '' ? '?' : head
}

// `git diff --name-status -z`: a status, then one path, or two for R and C.
function parseNameStatus(raw: string): ExplorerChange[] {
  const parts = raw.split('\0').filter(part => part !== '')
  const out: ExplorerChange[] = []
  for (let i = 0; i < parts.length; ) {
    const letter = letterOf(parts[i++] ?? '')
    if (letter === 'R' || letter === 'C') {
      const from = parts[i++] ?? ''
      out.push({ path: parts[i++] ?? '', letter, from })
    } else {
      out.push({ path: parts[i++] ?? '', letter })
    }
  }
  return out
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
  const { head } = await read($, base)
  const range = [await baseRef($), ...(head === undefined ? [] : [head])]
  const diff = await git($, ['diff', '--relative', '--name-status', '-z', '-M', ...range])
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

// Keeps whole hunks while they fit; a first hunk that alone is too long is
// cut by lines and its header recounted, so it still parses as a diff.
function clipDiff(diff: string, limit: number): { text: string; isCut: boolean } {
  if (diff.length <= limit) return { text: diff, isCut: false }
  const hunks = diff.split(/\n(?=@@ )/)
  let text = ''
  for (const hunk of hunks) {
    const joined = text === '' ? hunk : `${text}\n${hunk}`
    if (joined.length > limit - 1) break
    text = joined
  }
  if (text !== '') return { text: `${text}\n`, isCut: true }

  const lines = (hunks[0] ?? '').split('\n')
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[0] ?? '')
  if (header === null) return { text: diff.slice(0, limit), isCut: true }
  const kept: string[] = []
  let size = (lines[0] ?? '').length + 1
  let oldCount = 0
  let newCount = 0
  for (const line of lines.slice(1)) {
    if (size + line.length + 1 > limit - 40) break
    kept.push(line)
    size += line.length + 1
    if (line.startsWith('-')) oldCount++
    else if (line.startsWith('+')) newCount++
    else if (line.startsWith(' ')) {
      oldCount++
      newCount++
    }
  }
  const head = `@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3]}`
  return { text: `${[head, ...kept].join('\n')}\n`, isCut: true }
}

async function diffOf($: EngineInterface, change: ExplorerChange): Promise<{ diff: string; note: string }> {
  const { head } = await read($, base)
  const result =
    change.letter === 'U'
      ? await git($, ['diff', '--no-index', '--no-color', '--', '/dev/null', change.path])
      : await git($, [
          'diff', '--relative', '--no-color', '-M', await baseRef($),
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

async function cycleBase($: EngineInterface) {
  if ((await read($, base)).ref !== 'HEAD') return setBase($, HEAD)
  const branch = await defaultBranchBase($)
  if (branch === undefined) $.ui.toast('No main or master branch to compare with')
  else await setBase($, branch)
}

async function resolveCommit($: EngineInterface, name: string): Promise<string | undefined> {
  const found = await git($, ['rev-parse', '--verify', '-q', `${name}^{commit}`])
  return found.exitCode === 0 ? found.stdout.trim() : undefined
}

async function chooseBase($: EngineInterface, typed: string) {
  const name = typed.trim()
  if (name === '' || name === 'HEAD') return setBase($, HEAD)
  const range = /^(.+?)\.\.(\.?)(.+)$/.exec(name)
  if (range !== null) {
    const [, from = '', isThreeDot, to = ''] = range
    const head = await resolveCommit($, to)
    let ref = await resolveCommit($, from)
    if (ref !== undefined && head !== undefined && isThreeDot === '.') {
      const merge = await git($, ['merge-base', ref, head])
      ref = merge.exitCode === 0 ? merge.stdout.trim() : undefined
    }
    if (ref === undefined || head === undefined) $.ui.toast(`Unknown range: ${name}`)
    else await setBase($, { ref, head, label: name })
    return
  }
  const found = await git($, ['rev-parse', '--verify', '-q', `${name}^{commit}`])
  if (found.exitCode !== 0) $.ui.toast(`Unknown ref: ${name}`)
  else await setBase($, { ref: found.stdout.trim(), label: name })
}

// `git log` records, fields split by \x1f and records by \x1e.
function parseLog(raw: string): ExplorerCommit[] {
  return raw
    .split('\x1e')
    .map(record => record.replace(/^\n/, '').split('\x1f'))
    .filter(fields => fields.length >= 5)
    .map(([sha = '', short = '', subject = '', author = '', when = '']) => ({ sha, short, subject, author, when }))
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

// ---- preview -------------------------------------------------------------

async function fileText($: EngineInterface, rel: string, size: number | undefined) {
  const dir = await read($, root)
  const bytes = size ?? (await $.fs.stat(join(dir, rel)).catch(() => undefined))?.size
  if (bytes === undefined) return { text: '', note: 'not on disk', isOnDisk: false }
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

async function showPath($: EngineInterface, rel: string, options: { mode?: 'file' | 'diff'; size?: number } = {}) {
  await update($, selected, () => rel)
  const change = (await read($, changes)).find(one => one.path === rel)
  const isInRange = change !== undefined && (await read($, base)).head !== undefined
  const file =
    change?.letter === 'D'
      ? { text: '', note: 'deleted', isOnDisk: false }
      : isInRange
        ? { text: '', note: '', isOnDisk: false }
        : await fileText($, rel, options.size)
  const diff = change === undefined ? { diff: '', note: '' } : await diffOf($, change)
  const wanted = options.mode ?? (change === undefined ? 'file' : 'diff')
  const mode = change === undefined ? 'file' : file.isOnDisk ? wanted : 'diff'
  const shown: ExplorerPreview = {
    path: rel,
    mode,
    text: file.text,
    diff: diff.diff,
    note: mode === 'diff' ? diff.note : file.note,
    isChanged: change !== undefined,
    isOnDisk: file.isOnDisk,
  }
  await update($, preview, () => shown)
  await $.ui.open({ id: PREVIEW, title: baseName(rel) })
}

async function reloadPreview($: EngineInterface) {
  const shown = await read($, preview)
  if (shown === null) return
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PREVIEW)
  if (isOpen) await showPath($, shown.path, { mode: shown.mode })
}

async function mention($: EngineInterface, rel: string) {
  const { text, cursor } = await $.prompt.read()
  const before = text.slice(0, cursor)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const filled = await $.prompt.fill({ text: `${lead}@${rel} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not insert @${rel}`)
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
  const picked = await $.ui.selection()
  if (picked === undefined || picked.text.trim() === '') {
    $.ui.toast('Select lines with the mouse first, or quote a hunk')
    return
  }
  await quote($, picked.text, `\`${path}\` (selected)`, '')
}

// One `@@` block per hunk, so each can be drawn and quoted on its own.
function splitHunks(diff: string): { header: string; body: string; lines: string }[] {
  return diff
    .split(/\n(?=@@ )/)
    .filter(hunk => hunk.startsWith('@@ '))
    .map(hunk => {
      const header = hunk.slice(0, hunk.indexOf('\n') < 0 ? hunk.length : hunk.indexOf('\n'))
      const at = /\+(\d+)(?:,(\d+))?/.exec(header)
      const start = Number(at?.[1] ?? 0)
      const count = Number(at?.[2] ?? 1)
      const lines = count <= 1 ? `line ${start}` : `lines ${start}-${start + count - 1}`
      return { header, body: hunk.endsWith('\n') ? hunk : `${hunk}\n`, lines }
    })
}

async function refreshAll($: EngineInterface) {
  const open = await read($, expanded)
  const kept: string[] = []
  await loadDir($, '')
  for (const rel of open) {
    if (await loadDir($, rel)) kept.push(rel)
  }
  await update($, expanded, () => kept)
  await loadChanges($)
  await loadHistory($)
  await reloadPreview($)
}

async function openExplorer($: EngineInterface, wanted: string) {
  if (wanted === 'files' || wanted === 'changes' || wanted === 'history') await update($, view, () => wanted as ExplorerView)
  await refreshAll($)
  return $.ui.open({ id: EXPLORER, title: 'Explorer', focus: true })
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

export const register: Register = on => {
  let pending: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'files',
      description: 'Open the file explorer',
      argumentHint: '[files|changes|history]',
    })
    await $.command.register({
      name: 'changes',
      description: 'Browse git changes against a ref or a range (HEAD by default)',
      argumentHint: '[ref | a..b]',
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

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!EDITING_TOOLS.has(tool) && tool !== 'Bash') return ran

    const args = e as { file_path?: unknown; notebook_path?: unknown }
    const filePath = args.file_path ?? args.notebook_path
    if (EDITING_TOOLS.has(tool) && typeof filePath === 'string') {
      const dir = await read($, root)
      const normal = filePath.replace(/\\/g, '/')
      const rel = normal.startsWith(`${dir}/`) ? normal.slice(dir.length + 1) : normal
      if (!rel.startsWith('/')) {
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

  on('ui.render', { component: 'Pane', requestId: EXPLORER }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const dir = await read($, root)
    const current = await read($, view)
    const list = await read($, changes)
    const edited = new Set(await read($, touched))
    const chosen = await read($, selected)
    const width = Math.max(20, e.props.bodyColumns)

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{fit(baseName(dir).toUpperCase() || dir, width - 12)}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" label="↻" plain onPress={() => refreshAll($)} />
            {current === 'files' && (
              <Button key="collapse" label="⊟" plain onPress={() => update($, expanded, () => [])} />
            )}
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
        <Box flexDirection="row" gap={1}>
          <Button
            key="tab:files"
            label="Files"
            hotkey="f"
            variant={current === 'files' ? 'primary' : 'secondary'}
            onPress={() => update($, view, () => 'files' as const)}
          />
          <Button
            key="tab:changes"
            label={`Changes ${list.length}`}
            hotkey="c"
            variant={current === 'changes' ? 'primary' : 'secondary'}
            onPress={() => update($, view, () => 'changes' as const)}
          />
          <Button
            key="tab:history"
            label="History"
            hotkey="h"
            variant={current === 'history' ? 'primary' : 'secondary'}
            onPress={() => update($, view, () => 'history' as const)}
          />
        </Box>
      </Box>
    )

    if (current === 'history') {
      const commits = await read($, history)
      const against = await read($, base)
      return (
        <Box flexDirection="column">
          {header}
          {commits.length === 0 && <Text dimColor>No commits.</Text>}
          {commits.map(commit => {
            const isOpen = against.head === commit.sha
            const room = width - commit.short.length - 3
            return (
              <Box key={`line:${commit.sha}`} flexDirection="column">
                <Box flexDirection="row">
                  <Text color="blue">{isOpen ? '▌' : ' '}</Text>
                  <Text color="yellow">{commit.short} </Text>
                  <Button
                    key={`commit:${commit.sha}`}
                    label={fit(commit.subject, room)}
                    plain
                    onPress={() => openCommit($, commit)}
                  />
                </Box>
                <Text dimColor>{fit(`  ${commit.author} · ${commit.when}`, width)}</Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    if (current === 'changes') {
      const against = await read($, base)
      const failed = await read($, gitError)
      return (
        <Box flexDirection="column">
          {header}
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{against.head === undefined ? 'vs' : 'in'}</Text>
            <Button key="base" label={fit(against.label, width - 6)} plain onPress={() => cycleBase($)} />
          </Box>
          {Input !== undefined && (
            <Input
              key="base-ref"
              placeholder="ref or a..b (empty = HEAD)"
              onSubmit={(value: string) => chooseBase($, value)}
            />
          )}
          {failed !== '' && <Text color="red">{failed}</Text>}
          {failed === '' && list.length === 0 && <Text dimColor>No changes.</Text>}
          {list.slice(0, MAX_ROWS).map(change => {
            const where = parentOf(change.path)
            const mark = edited.has(change.path) ? '✎' : ''
            const room = width - 4 - mark.length
            const label = fit(baseName(change.path), room)
            const rest = room - label.length - 1
            return (
              <Box key={`line:${change.path}`} flexDirection="row">
                <Text color="blue">{change.path === chosen ? '▌' : ' '}</Text>
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
            )
          })}
        </Box>
      )
    }

    const all = await read($, listings)
    const open = new Set(await read($, expanded))
    const status: Record<string, string> = {}
    for (const change of list) status[change.path] = change.letter
    const folders = folderBadges(list)
    const rows = flatten(all, open)

    return (
      <Box flexDirection="column">
        {header}
        {rows.length === 0 && <Text dimColor>(empty)</Text>}
        {rows.map(({ rel, depth, entry }) => {
          const letter = entry.isDir ? folders[rel] : status[rel]
          const badge = letter === undefined ? '' : entry.isDir ? '●' : letter
          const mark = edited.has(rel) ? '✎' : ''
          const chevron = entry.isDir ? (open.has(rel) ? '▾ ' : '▸ ') : '  '
          const indent = '  '.repeat(depth)
          const room = width - 1 - indent.length - chevron.length - badge.length - mark.length - 2

          return (
            <Box key={`line:${rel}`} flexDirection="row">
              <Text color="blue">{rel === chosen ? '▌' : ' '}</Text>
              <Text dimColor>{indent}</Text>
              <Button
                key={`row:${rel}`}
                label={chevron + fit(entry.name, room)}
                plain
                onPress={() =>
                  entry.isDir ? toggleDir($, rel) : showPath($, rel, { mode: 'file', size: entry.size })
                }
              />
              <Box flexGrow={1} />
              {mark !== '' && <Text color="blue">{mark}</Text>}
              {badge !== '' && <Text color={BADGE_COLOR[letter ?? ''] ?? 'yellow'}> {badge}</Text>}
            </Box>
          )
        })}
        {rows.length >= MAX_ROWS && <Text dimColor>… more rows not shown; collapse folders</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PREVIEW }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const shown = await read($, preview)
    if (shown === null) return <Text dimColor>Select a file in the explorer.</Text>
    const width = Math.max(20, e.props.bodyColumns)
    const list = await read($, changes)
    const against = await read($, base)
    const at = list.findIndex(one => one.path === shown.path)
    const change = list[at]
    const step = (by: number) => {
      const target = at < 0 ? list[0] : list[(at + by + list.length) % list.length]
      if (target !== undefined) void showPath($, target.path, { mode: 'diff' })
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{fit(shown.path, width - 10)}</Text>
          <Box flexDirection="row" gap={1}>
            {list.length > 0 && <Button key="prev" label="‹" plain hotkey="p" onPress={() => step(-1)} />}
            {list.length > 0 && <Button key="next" label="›" plain hotkey="n" onPress={() => step(1)} />}
            <Button key="quote" label="❝" plain hotkey="q" onPress={() => quoteSelection($, shown.path)} />
            <Button key="mention" label="@" plain onPress={() => mention($, shown.path)} />
            <Button key="close" label="✕" plain role="dismiss" onPress={() => $.ui.close({ id: PREVIEW })} />
          </Box>
        </Box>
        {shown.isChanged && (
          <Box flexDirection="row" gap={1}>
            {shown.isOnDisk && (
              <Button
                key="mode:file"
                label="File"
                hotkey="f"
                variant={shown.mode === 'file' ? 'primary' : 'secondary'}
                onPress={() => showPath($, shown.path, { mode: 'file' })}
              />
            )}
            <Button
              key="mode:diff"
              label="Diff"
              hotkey="d"
              variant={shown.mode === 'diff' ? 'primary' : 'secondary'}
              onPress={() => showPath($, shown.path, { mode: 'diff' })}
            />
            {change !== undefined && (
              <Text dimColor>
                <Text color={BADGE_COLOR[change.letter] ?? 'yellow'}>{change.letter}</Text>
                {` ${against.head === undefined ? 'vs' : 'in'} ${fit(against.label, width - 28)} · ${at + 1}/${list.length}`}
              </Text>
            )}
          </Box>
        )}
        {shown.note !== '' && <Text dimColor>{shown.note}</Text>}
        {shown.mode === 'diff' &&
          splitHunks(shown.diff).map((hunk, i) => (
            <Box key={`hunk:${i}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor>{fit(hunk.lines, width - 10)}</Text>
                <Button
                  key={`quote:${i}`}
                  label="❝ quote"
                  plain
                  dimColor
                  onPress={() => quote($, hunk.body, `\`${shown.path}\` ${hunk.lines} (diff ${against.head === undefined ? 'vs' : 'in'} ${against.label})`, 'diff')}
                />
              </Box>
              <Code source={hunk.body} format="diff" path={shown.path} wrap="truncate-end" />
            </Box>
          ))}
        {shown.mode === 'file' && shown.text !== '' && (
          <Code source={shown.text} path={shown.path} startLine={1} wrap="truncate-end" />
        )}
      </Box>
    )
  })
}
