import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ExplorerEntry, ExplorerPreview } from '../types'

const EXPLORER = 'file-explorer'
const PREVIEW = 'file-preview'

const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db'])
const EDITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAX_ROWS = 1500
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_PREVIEW_CHARS = 10000

const root = atom({ plugin: 'file-explorer', key: 'root' } as const, '')
const expanded = atom({ plugin: 'file-explorer', key: 'expanded' } as const, [])
const listings = atom({ plugin: 'file-explorer', key: 'listings' } as const, {})
const git = atom({ plugin: 'file-explorer', key: 'git' } as const, {})
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
  '!': 'magenta',
}
const SEVERITY = ['!', 'D', 'M', 'R', 'A', 'U']

const join = (base: string, rel: string) => (rel === '' ? base : `${base}/${rel}`)
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

async function loadDir($: EngineInterface, rel: string): Promise<boolean> {
  const base = await read($, root)
  const listed = await $.fs.list(join(base, rel)).catch(() => undefined)
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
      const target = await $.fs.stat(join(base, rel === '' ? one.name : `${rel}/${one.name}`)).catch(() => undefined)
      isDir = target?.kind === 'dir'
    }
    entries.push({ name: one.name, isDir, size: one.size })
  }
  await update($, listings, all => ({ ...all, [rel]: sortEntries(entries) }))
  return true
}

// `git status` letters per path relative to the session's root.
function parseGitStatus(raw: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = raw.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i] ?? ''
    if (item.length < 4) continue
    const xy = item.slice(0, 2)
    const path = item.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++ // the old name follows
    if (!path.startsWith(prefix)) continue
    const conflict = xy === 'DD' || xy === 'AA' || xy.includes('U')
    const letter = conflict
      ? '!'
      : xy === '??'
        ? 'U'
        : (xy[1] !== ' ' ? xy.charAt(1) : xy.charAt(0)).replace('T', 'M')
    out[path.slice(prefix.length).replace(/\/$/, '')] = letter
  }
  return out
}

async function loadGit($: EngineInterface) {
  const cwd = await read($, root)
  const run = (argv: string[]) => $.process.run(argv, { cwd, timeoutMs: 10000 }).catch(() => undefined)
  const prefix = await run(['git', 'rev-parse', '--show-prefix'])
  if (prefix === undefined || prefix.exitCode !== 0) {
    await update($, git, () => ({}))
    return
  }
  const status = await run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status === undefined || status.exitCode !== 0) return
  const found = parseGitStatus(status.stdout, prefix.stdout.trim())
  await update($, git, () => found)
}

async function refreshAll($: EngineInterface) {
  const open = await read($, expanded)
  const kept: string[] = []
  await loadDir($, '')
  for (const rel of open) {
    if (await loadDir($, rel)) kept.push(rel)
  }
  await update($, expanded, () => kept)
  await loadGit($)
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

async function showFile($: EngineInterface, rel: string, size: number) {
  await update($, selected, () => rel)
  const base = await read($, root)
  let shown: ExplorerPreview
  if (size > MAX_PREVIEW_BYTES) {
    shown = { path: rel, text: '', note: `${Math.round(size / 1024)} KiB: too large to preview` }
  } else {
    const text = await $.fs.read(join(base, rel)).catch(() => undefined)
    if (text === undefined) {
      shown = { path: rel, text: '', note: 'could not be read' }
    } else if (text.includes('\0')) {
      shown = { path: rel, text: '', note: 'binary file' }
    } else {
      // Code takes tab and newline as its only control characters.
      const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      const isCut = clean.length > MAX_PREVIEW_CHARS
      const cut = isCut ? clean.slice(0, clean.lastIndexOf('\n', MAX_PREVIEW_CHARS) + 1 || MAX_PREVIEW_CHARS) : clean
      shown = { path: rel, text: cut, note: isCut ? 'preview cut at 10000 characters' : '' }
    }
  }
  await update($, preview, () => shown)
  await $.ui.open({ id: PREVIEW, title: baseName(rel) })
}

async function mention($: EngineInterface, rel: string) {
  const { text, cursor } = await $.prompt.read()
  const before = text.slice(0, cursor)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const filled = await $.prompt.fill({ text: `${lead}@${rel} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not insert @${rel}`)
}

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
function folderBadges(status: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, letter] of Object.entries(status)) {
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
      description: 'Open the file explorer pane',
    })
    const cwd = e.cwd
    if ((await read($, root)) !== cwd) {
      await update($, root, () => cwd)
      await update($, expanded, () => [])
      await update($, listings, () => ({}))
    }
    await refreshAll($)
    void $.ui.open({ id: EXPLORER, title: 'Explorer' })

    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    await refreshAll($)
    const opened = await $.ui.open({ id: EXPLORER, title: 'Explorer', focus: true })

    return { text: opened.isPlaced ? 'Explorer opened.' : `Explorer not shown: ${opened.reason}` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!EDITING_TOOLS.has(tool) && tool !== 'Bash') return ran

    const filePath = (e as { file_path?: unknown; notebook_path?: unknown }).file_path ??
      (e as { notebook_path?: unknown }).notebook_path
    if (EDITING_TOOLS.has(tool) && typeof filePath === 'string') {
      const base = await read($, root)
      const normal = filePath.replace(/\\/g, '/')
      const rel = normal.startsWith(`${base}/`) ? normal.slice(base.length + 1) : normal
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
    const base = await read($, root)
    const all = await read($, listings)
    const open = new Set(await read($, expanded))
    const status = await read($, git)
    const edited = new Set(await read($, touched))
    const current = await read($, selected)
    const folders = folderBadges(status)
    const width = Math.max(16, e.props.bodyColumns)
    const rows = flatten(all, open)
    const changes = Object.keys(status).length

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{fit(baseName(base).toUpperCase() || base, width - 12)}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" label="↻" plain onPress={() => refreshAll($)} />
            <Button key="collapse" label="⊟" plain onPress={() => update($, expanded, () => [])} />
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
        {changes > 0 && <Text dimColor>{changes} changed</Text>}
        {rows.length === 0 && <Text dimColor>(empty)</Text>}
        {rows.map(({ rel, depth, entry }) => {
          const letter = entry.isDir ? folders[rel] : status[rel]
          const badge = letter === undefined ? '' : entry.isDir ? '●' : letter
          const mark = edited.has(rel) ? '✎' : ''
          const chevron = entry.isDir ? (open.has(rel) ? '▾ ' : '▸ ') : '  '
          const indent = '  '.repeat(depth)
          const room = width - 1 - indent.length - chevron.length - badge.length - mark.length - 2
          const isSelected = rel === current

          return (
            <Box key={`line:${rel}`} flexDirection="row">
              <Text color="blue">{isSelected ? '▌' : ' '}</Text>
              <Text dimColor>{indent}</Text>
              <Button
                key={`row:${rel}`}
                label={chevron + fit(entry.name, room)}
                plain
                onPress={() =>
                  entry.isDir ? toggleDir($, rel) : showFile($, rel, entry.size)
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
    const width = Math.max(16, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{fit(shown.path, width - 18)}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="mention" label="@ Mention" onPress={() => mention($, shown.path)} />
            <Button key="close" label="✕" plain role="dismiss" onPress={() => $.ui.close({ id: PREVIEW })} />
          </Box>
        </Box>
        {shown.note !== '' && <Text dimColor>{shown.note}</Text>}
        {shown.text !== '' && <Code source={shown.text} path={shown.path} startLine={1} wrap="truncate-end" />}
      </Box>
    )
  })
}
