import { expect, mock, test } from 'claude-code/testing'
import { buttonCells } from '../hooks/wrap'
import { HELP, HELP_JA } from '../hooks/help'

const ROOT = '/work/app'

const TREE: Record<string, { name: string; kind: 'file' | 'dir'; size: number }[]> = {
  [ROOT]: [
    { name: 'README.md', kind: 'file', size: 12 },
    { name: 'src', kind: 'dir', size: 0 },
    { name: '.git', kind: 'dir', size: 0 },
  ],
  [`${ROOT}/src`]: [
    { name: 'main.ts', kind: 'file', size: 20 },
    { name: 'util.ts', kind: 'file', size: 20 },
  ],
}

const FILES: Record<string, string> = {
  [`${ROOT}/src/main.ts`]: 'export const answer = 42\n',
  [`${ROOT}/src/util.ts`]: 'export {}\n',
}

const MAIN_DIFF = [
  'diff --git a/src/main.ts b/src/main.ts',
  'index 1..2 100644',
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1 +1 @@',
  '-export const answer = 41',
  '+export const answer = 42',
  '',
].join('\n')

const ok = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// Drops the `-c key=value` pairs the explorer puts before every git command.
// and the diff safety flags, so the fakes match on what a command asks.
const gitArgs = (argv: readonly string[]) => {
  const args = argv.slice(1)
  while (args[0] === '-c') args.splice(0, 2)
  return args.filter(arg => arg !== '--no-ext-diff' && arg !== '--no-textconv')
}

const STAT = (path: string) => ({
  value: { kind: path.endsWith('/src') ? ('dir' as const) : ('file' as const), size: 30, mtimeMs: 0, isLink: false, realPath: path },
})

function fakeGit(argv: readonly string[], log: string[]) {
  const args = gitArgs(argv)
  log.push(args.join(' '))
  const line = args.join(' ')
  if (line === 'rev-parse --is-inside-work-tree') return ok('true\n')
  if (line === 'rev-parse --verify -q HEAD') return ok('abc\n')
  if (line.startsWith('rev-parse --verify -q main^{commit}')) return ok('def\n')
  if (line === 'rev-parse --verify -q aaaa^') return ok('p0\n')
  if (line.startsWith('log ')) return ok('aaaa\x1faaa\x1fAdd new\x1fAlice\x1f2 days ago\x1e\n')
  if (line.startsWith('rev-parse --verify -q')) return ok('', 1)
  if (line.startsWith('diff --relative --name-status') && args.includes('aaaa')) return ok('A\0src/new.ts\0')
  if (line.startsWith('diff --relative --no-color') && args.includes('aaaa')) {
    return ok('diff --git a/src/new.ts b/src/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n')
  }
  if (line.startsWith('diff --relative --name-status')) {
    return ok(args.includes('def') ? 'M\0src/main.ts\0D\0old.txt\0' : 'M\0src/main.ts\0')
  }
  if (line.startsWith('ls-files --others --ignored')) return ok('build/\0')
  if (line.startsWith('ls-files --others')) return ok('src/util.ts\0')
  if (line.startsWith('diff --relative --no-color')) return ok(MAIN_DIFF, 0)
  if (line.startsWith('diff --no-index')) return ok('@@ -0,0 +1 @@\n+export {}\n', 1)
  return ok('', 1)
}

const PANE = (id: string, bodyColumns = 50) => ({
  plugin: 'file-explorer',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: id,
  props: {
    title: id,
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
})

test('browses files and git changes with diffs', async ($, on) => {
  let filled = ''
  const gitLog: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', async (_$, e) => fakeGit(e.argv, gitLog))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('prompt.read', async () => ({ value: { text: 'look at', cursor: 7 } }))
  on('ui.selection', async () => ({ value: { text: '+export const answer = 42' } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  // Files view: folders first, decorations from git.
  const ui = await $.ui.mount(PANE('file-explorer'))
  expect((await ui.find({ key: 'row:src' }))?.text).toBe('src/')
  expect(await ui.find({ type: 'Text', text: '▸ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '📁 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '📖 ' })).toBeDefined()
  expect((await ui.find({ key: 'tab:changes' }))?.text).toBe('Changes 2')
  await ui.press({ key: 'row:src' })
  expect(await ui.find({ key: 'row:src/main.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' U' })).toBeDefined()

  // A changed file opened from the tree shows the file; Diff switches.
  await ui.press({ key: 'row:src/main.ts' })
  const shown = await $.ui.mount(PANE('file-preview'))
  expect((await shown.find({ type: 'Code' }))?.props.source).toBe('export const answer = 42\n')
  await shown.press({ key: 'mode:diff' })
  const diff = await shown.find({ type: 'Code' })
  expect(diff?.props.format).toBe('diff')
  expect(String(diff?.props.source).startsWith('@@ -1,1 +1,1 @@')).toBe(true)

  // Next walks to the untracked file's diff.
  await shown.press({ key: 'next' })
  expect(String((await shown.find({ type: 'Code' }))?.props.source)).toContain('+export {}')

  await shown.press({ key: 'mention' })
  expect(filled).toBe(' @src/util.ts ')

  // Changes view against another ref lists a deleted file too.
  await ui.press({ key: 'tab:changes' })
  expect(await ui.find({ key: 'change:src/main.ts' })).toBeDefined()
  await ui.input({ key: 'base-ref', text: 'main' })
  expect(await ui.find({ key: 'change:old.txt' })).toBeDefined()
  expect((await ui.find({ key: 'base' }))?.text).toBe('main')
  await ui.press({ key: 'change:old.txt' })
  expect(await shown.find({ key: 'mode:file' })).toBeUndefined()
  expect(gitLog.some(line => line.includes('def -- old.txt'))).toBe(true)

  // History: a commit opens as its own changes, diff only.
  await ui.press({ key: 'tab:history' })
  expect((await ui.find({ key: 'commit:aaaa' }))?.text).toBe('Add new')
  await ui.press({ key: 'commit:aaaa' })
  expect((await ui.find({ key: 'tab:changes' }))?.text).toBe('Changes 1')
  expect((await ui.find({ key: 'base' }))?.text).toBe('aaa Add new')
  await ui.press({ key: 'change:src/new.ts' })
  expect(await shown.find({ key: 'mode:file' })).toBeUndefined()
  expect(gitLog).toContain('diff --relative --no-color -M p0 aaaa -- src/new.ts')

  // Quoting a hunk, then the mouse selection.
  await shown.press({ key: 'quote:0' })
  expect(filled).toBe('\n`src/new.ts` lines 1-2 (diff in aaa Add new):\n```diff\n@@ -0,0 +1,2 @@\n+a\n+b\n```\n')
  await shown.press({ key: 'quote' })
  expect(filled).toBe('\n`src/new.ts` (selected):\n```\n+export const answer = 42\n```\n')

  // A range typed into the base field.
  await ui.input({ key: 'base-ref', text: 'main..main' })
  expect((await ui.find({ key: 'base' }))?.text).toBe('main..main')
})

test('splits into a tree and a preview when wide', async ($, on) => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: long }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [{ id: 'file-explorer', title: 'Explorer', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/util.ts' })

  // The file shows beside the tree, windowed to the pane's rows.
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.startLine).toBe(1)
  expect(String(code?.props.source).split('\n').length - 1).toBeLessThan(30)
  expect(await ui.find({ key: 'row:src' })).toBeDefined()

  await ui.press({ key: 'down' })
  expect((await ui.find({ type: 'Code' }))?.props.startLine).toBeGreaterThan(1)

  // Wheeling far past the end, then one tick up, leaves the end at once.
  const wheel = (by: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId: 'file-explorer',
      offset: 0,
      by,
      bodyRows: 30,
      contentRows: 30,
      origin: { kind: 'person' },
      pointer: { column: 100, row: 5 },
    })
  for (let i = 0; i < 100; i++) await wheel(1)
  const atEnd = Number((await ui.find({ type: 'Code' }))?.props.startLine)
  expect(atEnd).toBeGreaterThan(150)
  await wheel(-1)
  expect(Number((await ui.find({ type: 'Code' }))?.props.startLine)).toBeLessThan(atEnd)
})

test('draws Nerd Font icons in colour when configured', { options: { icons: 'nerd' } }, async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer'))
  await ui.press({ key: 'row:src' })
  const ts = await ui.find({ type: 'Text', text: '\ue628 ' })
  expect(ts?.props.color).toBe('blue')
})

test('previews markdown rendered and follows its relative links', async ($, on) => {
  const readme = '# App\n\nSee [main](./src/main.ts) and [site](https://example.com).\n\n```ts\n# not a heading\nconst a = 1\n```\n'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async (_$, e) => ({ value: e.path.endsWith('README.md') ? readme : 'export const answer = 42\n' }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:README.md' })

  // The heading is a band of its own; the paragraph stays markdown.
  const band = await ui.find({ type: 'Text', text: /^ App\s+$/ })
  expect(band?.props.backgroundColor).toBe('cyan')
  const md = await ui.find({ type: 'Markdown' })
  expect(md?.props.text).toBe('See [main](./src/main.ts) and [site](https://example.com).')
  expect(md?.props.pressableLinks).toEqual(['./src/main.ts'])

  // Fenced code is framed, its language on the top edge, its body as code.
  const frame = await ui.find({ key: 'code:2' })
  expect(frame?.props.borderStyle).toBe('round')
  expect(await ui.find({ type: 'Text', text: ' ts ' })).toBeDefined()
  const block = (await ui.findAll({ type: 'Code' })).find(one => one.props.language === 'ts')
  expect(block?.props.source).toBe('# not a heading\nconst a = 1\n')

  await ui.press({ key: 'mode:file' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('README.md')
  await ui.press({ key: 'mode:rendered' })

  // A relative link opens the file and unfolds the tree down to it.
  await ui.press({ key: 'md:1', link: { href: './src/main.ts' } })
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('src/main.ts')
  expect(await ui.find({ key: 'row:src/main.ts' })).toBeDefined()
})

test('finds files by name and text with ripgrep', async ($, on) => {
  const long = Array.from({ length: 80 }, (_, i) => (i === 59 ? 'const needle = 1' : `line ${i + 1}`)).join('\n') + '\n'
  const ran: string[][] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: long }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('process.run', async (_$, e) => {
    if (e.argv[0] !== 'rg') return fakeGit(e.argv, [])
    ran.push([...e.argv])
    if (e.argv[1] === '--files') return ok('README.md\0src/main.ts\0src/util.ts\0docs/main-notes.md\0')
    return ok('src/main.ts\x0060:7:const needle = 1\nsrc/util.ts\x003:1:needle()\n')
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'tab:search' })

  // The controls before the field stay put as results come and go, so the
  // focus does not slide off the field mid-typing.
  const before = async () =>
    (await ui.findAll({ type: 'Button' })).map(one => one.key).slice(0, (await ui.findAll({ type: 'Button' })).findIndex(one => one.key === 'search:text') + 1)
  await ui.input({ key: 'search-input', text: 'zzzz', kind: 'change' })
  const withNone = await before()
  await ui.input({ key: 'search-input', text: 'm', kind: 'change' })
  expect(await before()).toEqual(withNone)
  expect(withNone).toContain('list:up')

  // Name search filters as you type, best match first.
  await ui.input({ key: 'search-input', text: 'mt', kind: 'change' })
  const found = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('found:'))
  expect(found[0]?.key).toBe('found:src/main.ts')
  expect(found.some(one => one.key === 'found:README.md')).toBe(false)

  // Text search runs rg on Enter, groups by file and highlights the hit.
  await ui.press({ key: 'search:text' })
  await ui.input({ key: 'search-input', text: 'needle' })
  const args = ran.find(argv => argv.includes('needle')) ?? []
  expect(args).toContain('--fixed-strings')
  expect(args).toContain('--ignore-case')
  expect(await ui.find({ key: 'hitfile:src/main.ts' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'needle' }))?.props.backgroundColor).toBe('yellow')
  expect(await ui.find({ type: 'Text', text: '2 matches in 2 files' })).toBeDefined()

  // A hit opens its file scrolled to the line.
  await ui.press({ key: 'hit:src/main.ts:60:7' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.path).toBe('src/main.ts')
  expect(Number(code?.props.startLine)).toBeGreaterThan(50)

  // Regex and case toggles re-run the search with their flags.
  await ui.press({ key: 'search:regex' })
  await ui.press({ key: 'search:case' })
  const last = ran[ran.length - 1] ?? []
  expect(last).not.toContain('--fixed-strings')
  expect(last).toContain('--case-sensitive')
})

test('follows Claude, diffs the last prompt, and names lines', async ($, on) => {
  const long = Array.from({ length: 80 }, (_, i) => (i === 59 ? 'const needle = 1' : `line ${i + 1}`)).join('\n') + '\n'
  const runs: { args: string; index?: string }[] = []
  let trees = 0
  let filled = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: long }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('process.run', async (_$, e) => {
    const args = gitArgs(e.argv).join(' ')
    runs.push({ args, index: e.init?.env?.GIT_INDEX_FILE })
    if (args === 'rev-parse --git-path file-explorer-index') return ok('.git/file-explorer-index\n')
    if (args === 'write-tree') return ok(`tree${++trees}\n`)
    if (args === 'add -A' || args === 'read-tree HEAD') return ok('')
    if (args.startsWith('diff --relative --name-status') && args.includes('tree1')) return ok('M\0src/main.ts\0')
    if (args.startsWith('diff --relative --no-color') && args.includes('tree1')) {
      return ok('@@ -58,5 +58,5 @@\n line 58\n line 59\n-const needle = 0\n+const needle = 1\n line 61\n line 62\n')
    }
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({
    value: [{ id: 'file-explorer', title: 'Explorer', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('ui.selection', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })
  on('tool.call', async () => ({ result: {} as never }))
  const clock = mock.clock(on)
  on('ui.toast', async () => ({ value: undefined }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // A prompt snapshots the working tree through the explorer's own index.
  await $.prompt.submit({ text: 'fix the needle', wait: false, origin: { kind: 'composer' } } as never)
  await clock.settle()
  const added = runs.find(one => one.args === 'add -A')
  expect(added?.index).toBe(`${ROOT}/.git/file-explorer-index`)

  // Claude reading a file shows it at the lines it read.
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/util.ts`, offset: 40 } as never)
  await clock.settle()
  let code = await ui.find({ type: 'Code' })
  expect(code?.props.path).toBe('src/util.ts')
  expect(code?.props.startLine).toBe(40)

  // The last-prompt base diffs the snapshot against the tree now.
  await ui.press({ key: 'tab:changes' })
  await ui.press({ key: 'base' })
  expect(String((await ui.find({ key: 'base' }))?.text)).toMatch(/^last prompt \(\d\d:\d\d\)$/)
  expect(await ui.find({ key: 'change:src/main.ts' })).toBeDefined()

  // Claude editing a file shows the diff at the hunk it touched.
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/main.ts`, old_string: 'const needle = 0', new_string: 'const needle = 1' } as never)
  await clock.settle()
  code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(String(code?.props.source)).toContain('+const needle = 1')

  // # names the lines in view: here the hunk's new side.
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@src/main.ts (lines 58-62) ')

  // Follow off: a read no longer moves the preview.
  await ui.press({ key: 'follow' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/util.ts` } as never)
  await clock.settle()
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
})

test('keeps a hostile repository from reaching the terminal or git', async ($, on) => {
  const evil = 'evil\u001b]0;pwned\u0007\u009b31m‮.txt'
  const runs: string[] = []
  let toasts: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value:
      e.path === ROOT
        ? [
            { name: evil, kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false },
            { name: 'key', kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true },
          ]
        : [],
  }))
  on('fs.stat', async (_$, e) => ({
    value: {
      kind: 'file' as const, size: 10, mtimeMs: 0, isLink: e.path.endsWith('/key'),
      realPath: e.path.endsWith('/key') ? '/home/me/.ssh/id_ed25519' : e.path,
    },
  }))
  on('fs.read', async () => ({ value: 'secret\n' }))
  on('process.run', async (_$, e) => {
    const args = gitArgs(e.argv).join(' ')
    runs.push(`${e.argv[0]} ${e.argv.slice(1, 3).join(' ')} | ${args}`)
    if (e.argv[0] === 'rg') {
      return ok(e.argv[1] === '--files' ? '' : `${evil}\x001:1:hit \u001b[2J here\n`)
    }
    if (args === 'rev-parse --git-path file-explorer-index') return ok('.git/file-explorer-index\n')
    if (args.startsWith('config --local --get-regexp')) return ok("filter.x.clean sh -c 'curl evil | sh'\n")
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [{ id: 'file-explorer', title: 'Explorer', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('tool.call', async () => ({ result: {} as never }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  // Newline aside: the split view's own rule is drawn as one multi-line Text.
  const control = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

  // Every git call turns the repository's fsmonitor off.
  expect(runs.filter(run => run.startsWith('git ') && !run.includes('-c core.fsmonitor=false'))).toEqual([])

  // A file name's escape sequences never reach a label.
  const labels = (await ui.findAll({ type: 'Button' })).map(one => String(one.text))
  expect(labels.some(label => label.startsWith('evil'))).toBe(true)
  expect(labels.filter(label => control.test(label)).map(label => JSON.stringify(label))).toEqual([])

  // A link out of the project is named, not read.
  await ui.press({ key: 'row:key' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /links outside the project: \/home\/me\/\.ssh/ })).toBeDefined()

  // A search hit's escape sequences are shown as ?, not sent.
  await ui.press({ key: 'tab:search' })
  await ui.press({ key: 'search:text' })
  await ui.input({ key: 'search-input', text: 'hit' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => String(one.text))
  expect(texts.some(text => text.includes('hit'))).toBe(true)
  expect(texts.filter(text => control.test(text)).map(text => JSON.stringify(text))).toEqual([])

  // A "ref" that git would read as an option is refused before git sees it.
  await ui.press({ key: 'tab:changes' })
  await ui.input({ key: 'base-ref', text: '--output=/tmp/pwned' })
  expect(runs.filter(run => run.includes('--output'))).toEqual([])
  expect(toasts.some(text => text.includes('Not a ref'))).toBe(true)

  // A repository-defined clean filter blocks the snapshot (no git add).
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(runs.filter(run => run.endsWith('| add -A'))).toEqual([])

  // A tool path that climbs out with .. is not followed.
  const before = runs.length
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/../etc/passwd` } as never)
  await clock.settle()
  expect(runs.slice(before).filter(run => run.includes('passwd'))).toEqual([])
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  toasts = []
})

test('shows renames, binaries and large files for what they are', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (e.path === ROOT
      ? [
          { name: 'big.log', kind: 'file' as const, size: 2 * 1024 * 1024 },
          { name: 'blob.bin', kind: 'file' as const, size: 300 },
          { name: 'logo.png', kind: 'file' as const, size: 300 },
          { name: 'new.ts', kind: 'file' as const, size: 20 },
        ]
      : []
    ).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'file' as const, size: e.path.endsWith('big.log') ? 2 * 1024 * 1024 : 20, mtimeMs: 0, isLink: false, realPath: e.path },
  }))
  on('fs.read', async (_$, e) => ({ value: /\.(png|bin)$/.test(e.path) ? '\u0089PNG\u0000\u0000' : 'export {}\n' }))
  on('process.run', async (_$, e) => {
    const line = gitArgs(e.argv).join(' ')
    if (line.startsWith('diff --relative --name-status')) return ok('R092\0old.ts\0new.ts\0M\0logo.png\0')
    if (line.includes('-- old.ts new.ts')) return ok('diff --git a/old.ts b/new.ts\n@@ -1 +1 @@\n-export {}\n+export { a }\n')
    if (line.includes('-- logo.png')) return ok('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n')
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  await ui.press({ key: 'tab:changes' })
  expect(await ui.find({ type: 'Text', text: ' R' })).toBeDefined()
  await ui.press({ key: 'change:new.ts' })
  expect(await ui.find({ type: 'Text', text: 'renamed from old.ts' })).toBeDefined()
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('+export { a }')

  await ui.press({ key: 'change:logo.png' })
  expect(await ui.find({ type: 'Text', text: 'binary file changed' })).toBeDefined()
  // A changed picture's File view draws the picture.
  await ui.press({ key: 'mode:file' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()

  await ui.press({ key: 'tab:files' })
  await ui.press({ key: 'row:blob.bin' })
  expect(await ui.find({ type: 'Text', text: 'binary file' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.press({ key: 'row:big.log' })
  expect(await ui.find({ type: 'Text', text: '2048 KiB: too large to preview' })).toBeDefined()
})

test('says so outside a git repository', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async () => ({ value: [{ name: 'notes.txt', kind: 'file' as const, size: 5, mtimeMs: 0, isLink: false }] }))
  on('process.run', async () => ({
    value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  expect(await ui.find({ key: 'row:notes.txt' })).toBeDefined()
  expect((await ui.find({ key: 'tab:changes' }))?.text).toMatch(/ 0$/)
  await ui.press({ key: 'tab:changes' })
  expect(await ui.find({ type: 'Text', text: 'Not a git repository' })).toBeDefined()
  await ui.press({ key: 'tab:history' })
  expect(await ui.find({ type: 'Text', text: 'No commits.' })).toBeDefined()
})

test('draws on every surface, and searches only where one can type', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'export {}\n' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const columns of [50, 120]) {
      const ui = await $.ui.mount({ ...PANE('file-explorer', columns), surface })
      expect(await ui.find({ key: 'row:src' })).toBeDefined()
      await ui.press({ key: 'tab:search' })
      const field = await ui.find({ key: 'search-input' })
      if (surface === 'mobile') {
        expect(field).toBeUndefined()
        expect(await ui.find({ type: 'Text', text: 'Search needs a surface with text input.' })).toBeDefined()
      } else {
        expect(field).toBeDefined()
      }
      await ui.press({ key: 'tab:files' })
      await ui.unmount()
    }
    const shown = await $.ui.mount({ ...PANE('file-preview', 60), surface })
    expect(await shown.find({ type: 'Text' })).toBeDefined()
    await shown.unmount()
  }
})

test('opens the preview as its own pane when narrow', async ($, on) => {
  const opened: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'export {}\n' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const narrow = await $.ui.mount(PANE('file-explorer', 60))
  await narrow.press({ key: 'row:README.md' })
  expect(opened).toContain('file-preview')
  expect(await narrow.find({ type: 'Markdown' })).toBeUndefined()

  opened.length = 0
  await narrow.unmount()
  const wide = await $.ui.mount(PANE('file-explorer', 120))
  await wide.press({ key: 'row:README.md' })
  expect(opened).not.toContain('file-preview')
})

test('marks what Claude edited, collapses, scrolls and draws ascii icons', { options: { icons: 'ascii' } }, async ($, on) => {
  const dirs = Array.from({ length: 12 }, (_, i) => `d${String(i).padStart(2, '0')}`)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value:
      e.path === ROOT
        ? dirs.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }))
        : Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.ts`, kind: 'file' as const, size: 9, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'x\n' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: {} as never }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE('file-explorer', 120), props: { ...PANE('file-explorer', 120).props, scroll: { offset: 0, bodyRows: 12 } } })

  // ascii: a chevron and no icon for folders, a dim dot for files.
  expect(await ui.find({ type: 'Text', text: '▸ ' })).toBeDefined()
  await ui.press({ key: 'row:d00' })
  const dot = await ui.find({ type: 'Text', text: '· ' })
  expect(dot?.props.dimColor).toBe(true)

  // An edit by Claude marks the file.
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/d00/f1.ts`, old_string: 'x', new_string: 'y' } as never)
  await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: '✎' })).toBeDefined()

  // The list scrolls by its own buttons, and collapses whole.
  expect(await ui.find({ key: 'row:d11' })).toBeUndefined()
  await ui.press({ key: 'list:down' })
  await ui.press({ key: 'list:down' })
  expect(await ui.find({ key: 'row:d11' })).toBeDefined()
  await ui.press({ key: 'collapse' })
  await ui.press({ key: 'list:up' })
  await ui.press({ key: 'list:up' })
  expect(await ui.find({ key: 'row:d00/f1.ts' })).toBeUndefined()
  expect(await ui.find({ key: 'row:d00' })).toBeDefined()
})

test('compares commit ranges and refuses unknown refs', async ($, on) => {
  const toasts: string[] = []
  const runs: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async (_$, e) => {
    const line = gitArgs(e.argv).join(' ')
    runs.push(line)
    if (line === 'rev-parse --verify -q main^{commit}') return ok('m1\n')
    if (line === 'rev-parse --verify -q topic^{commit}') return ok('t1\n')
    if (line === 'merge-base m1 t1') return ok('b1\n')
    if (line.startsWith('diff --relative --name-status')) return ok('M\0x.ts\0')
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'tab:changes' })

  await ui.input({ key: 'base-ref', text: 'main..topic' })
  expect(runs).toContain('diff --relative --name-status -z -M m1 t1')
  expect((await ui.find({ key: 'base' }))?.text).toBe('main..topic')

  await ui.input({ key: 'base-ref', text: 'main...topic' })
  expect(runs).toContain('diff --relative --name-status -z -M b1 t1')

  await ui.input({ key: 'base-ref', text: 'nope' })
  expect(toasts).toContain('Unknown ref: nope')
  expect((await ui.find({ key: 'base' }))?.text).toBe('main...topic')

  await ui.input({ key: 'base-ref', text: '' })
  expect((await ui.find({ key: 'base' }))?.text).toBe('HEAD')
})

test('wraps long lines by default, or cuts them and scrolls sideways', async ($, on) => {
  const long = `const value = ${'x'.repeat(200)}\n`
  const text = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? long : `short ${i}\n`)).join('')
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: text }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/util.ts' })

  // Wrapped: each long line takes several rows, so fewer lines fit the 30-row pane.
  let code = await ui.find({ type: 'Code' })
  expect(code?.props.wrap).toBe('wrap')
  const wrappedLines = String(code?.props.source).trimEnd().split('\n').length
  expect(wrappedLines).toBeLessThan(20)

  // Scrolling to the end still shows the last line.
  for (let i = 0; i < 20; i++) await ui.press({ key: 'down' })
  code = await ui.find({ type: 'Code' })
  expect(String(code?.props.source).trimEnd().endsWith('short 39')).toBe(true)

  // Unwrapped: one row a line, cut at the edge, and scrollable sideways.
  await ui.press({ key: 'wrap' })
  await ui.press({ key: 'up' })
  for (let i = 0; i < 5; i++) await ui.press({ key: 'up' })
  code = await ui.find({ type: 'Code' })
  expect(code?.props.wrap).toBe('truncate-end')
  expect(code?.props.startLine).toBe(1)
  expect(String(code?.props.source).startsWith('const value = ')).toBe(true)
  await ui.press({ key: 'right' })
  code = await ui.find({ type: 'Code' })
  expect(String(code?.props.source).startsWith('const value = ')).toBe(false)
  expect(String(code?.props.source).startsWith('x')).toBe(true)
  await ui.press({ key: 'left' })
  expect(String((await ui.find({ type: 'Code' }))?.props.source).startsWith('const value = ')).toBe(true)
})

test('keeps every toolbar Button inside the pane, so every hotkey is live', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: `${'x'.repeat(300)}\n`.repeat(60) }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  type Node = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }
  const rowCells = (row: Node) =>
    (row.children ?? [])
      .map(child => child as Node)
      .filter(child => child.type === 'Button')
      .reduce((sum, child, i) => sum + (i > 0 ? 1 : 0) + buttonCells(String(child.props?.label ?? ''), child.props?.hotkey !== undefined), 0)

  for (const columns of [80, 100, 120, 200]) {
    const ui = await $.ui.mount(PANE('file-explorer', columns))
    if ((await ui.find({ key: 'row:src/main.ts' })) === undefined) await ui.press({ key: 'row:src' })
    await ui.press({ key: 'row:src/main.ts' })
    await ui.press({ key: 'wrap' })
    const sidebar = Math.min(44, Math.max(26, Math.floor(columns * 0.32)))
    const previewWidth = columns - sidebar - 2

    // Every hotkey Button is drawn, and each toolbar row fits the preview.
    for (const key of ['up', 'down', 'wrap', 'quote', 'ref', 'tab:files', 'tab:changes', 'tab:history', 'tab:search']) {
      expect(await ui.find({ key })).toBeDefined()
    }
    expect(await ui.find({ key: 'tools:0' })).toBeDefined()
    expect(await ui.find({ key: 'tabs:0' })).toBeDefined()
    for (let i = 0; i < 4; i++) {
      const row = (await ui.find({ key: `tools:${i}` })) as Node | undefined
      if (row !== undefined) expect(rowCells(row)).toBeLessThanOrEqual(previewWidth)
      const tabs = (await ui.find({ key: `tabs:${i}` })) as Node | undefined
      if (tabs !== undefined) expect(rowCells(tabs)).toBeLessThanOrEqual(sidebar)
    }
    await ui.press({ key: 'wrap' })
    await ui.unmount()
  }
})

test('never lets the search field grab the focus by itself', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'export const answer = 42\n' }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'rg') {
      return e.argv[1] === '--files' ? ok('src/main.ts\0src/util.ts\0') : ok('src/main.ts\x001:14:export const answer = 42\n')
    }
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // No autoFocus: a pane taking the keys starts on nothing, where the
  // toolbar's hotkeys work; the field takes the ring only from the search tab.
  // (The test kit does not model the ring, so where it moves is not asserted.)
  await ui.press({ key: 'tab:search' })
  expect((await ui.find({ key: 'search-input' }))?.props.autoFocus).toBeUndefined()

  // Enter opens the best match; a text search's Enter lists hits and a hit opens at its line.
  await ui.input({ key: 'search-input', text: 'main' })
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('src/main.ts')
  await ui.press({ key: 'search:text' })
  await ui.input({ key: 'search-input', text: 'answer' })
  await ui.press({ key: 'hit:src/main.ts:1:14' })
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('src/main.ts')
})

test('quotes and references the selection from the prompt with /quote and /ref', async ($, on) => {
  const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  let selection: { text: string; requestId?: string } | undefined = { text: 'line 12\nline 13\nline 14' }
  let filled = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: text }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.selection', async () => ({ value: selection }))
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/util.ts' })

  // From the preview: the file and the lines found for the selection.
  let ran = await $.command.run({ command: 'quote' } as never)
  expect(filled).toBe('`src/util.ts` lines 12-14:\n```\nline 12\nline 13\nline 14\n```\n')
  expect((ran as { text?: string }).text).toBe('Quoted 3 lines of src/util.ts into the prompt.')

  ran = await $.command.run({ command: 'ref' } as never)
  expect(filled).toBe('@src/util.ts (lines 12-14) ')
  expect((ran as { text?: string }).text).toBe('Inserted @src/util.ts (lines 12-14).')

  // From the transcript: quoted as a plain selection.
  selection = { text: 'some reply text', requestId: 'msg-1' }
  await $.command.run({ command: 'quote' } as never)
  expect(filled).toBe('Selected:\n```\nsome reply text\n```\n')

  // Nothing selected: said so.
  selection = undefined
  ran = await $.command.run({ command: 'quote' } as never)
  expect((ran as { text?: string }).text).toContain('Select lines with the mouse first')
})

test('shows the keys and commands as help, and every hotkey drawn is in it', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: `${'x'.repeat(200)}\n`.repeat(50) }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [{ id: 'file-explorer', title: 'Explorer', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 140))
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/main.ts' })
  await ui.press({ key: 'wrap' })

  // Every hotkey on screen, sidebar and preview, is explained in the help.
  const hotkeys = (await ui.findAll({ type: 'Button' }))
    .map(one => one.props.hotkey)
    .filter((key): key is string => typeof key === 'string')
  expect(hotkeys.length).toBeGreaterThan(10)
  for (const key of new Set(hotkeys)) {
    expect(HELP).toContain(`\`${key}\``)
    expect(HELP_JA).toContain(`\`${key}\``)
  }

  // i shows the help in the preview; refresh leaves it; i again goes back.
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Text', text: /Keys and commands/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ key: 'quote' })).toBeUndefined()
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /Keys and commands/ })).toBeDefined()
  await ui.press({ key: 'help' })
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('src/main.ts')

  // /files help opens it too.
  await $.command.run({ command: 'files', args: 'help' } as never)
  expect(await ui.find({ type: 'Text', text: /Keys and commands/ })).toBeDefined()
})

test('shows the help in Japanese when the language option says so', { options: { language: 'ja' } }, async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'help' })
  expect(await ui.find({ type: 'Text', text: /キーとコマンド/ })).toBeDefined()
  const tables = (await ui.findAll({ type: 'Markdown' })).map(one => String(one.props.text))
  expect(tables.some(text => text.includes('一覧のスクロール'))).toBe(true)
})

test('copies the path and pins files, the pins kept per project', async ($, on) => {
  const copies: string[] = []
  let canCopy = true
  const store = new Map<string, unknown>([[`pins:${ROOT}`, ['README.md', 'gone.txt']]])
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.exists', async (_$, e) => ({ value: !e.path.endsWith('gone.txt') }))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'export {}\n' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.copy', async (_$, e) => {
    copies.push(e.text)
    return { value: canCopy ? { isCopied: true as const } : { isCopied: false as const, reason: 'no-clipboard' as const } }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // Kept pins load; one whose file is gone is dropped (and the store pruned).
  expect(await ui.find({ key: 'pinned:README.md' })).toBeDefined()
  expect(await ui.find({ key: 'pinned:gone.txt' })).toBeUndefined()
  expect(store.get(`pins:${ROOT}`)).toEqual(['README.md'])

  // Pin a file from the preview: it joins the list and the store.
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/main.ts' })
  expect((await ui.find({ key: 'pin' }))?.props.label).toBe('☆')
  await ui.press({ key: 'pin' })
  expect((await ui.find({ key: 'pin' }))?.props.label).toBe('★')
  expect(store.get(`pins:${ROOT}`)).toEqual(['README.md', 'src/main.ts'])
  await ui.press({ key: 'pinned:README.md' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()

  // Copy the path; a failed copy is reported, not silent.
  await ui.press({ key: 'copy' })
  expect(copies).toEqual(['README.md'])
  canCopy = false
  await ui.press({ key: 'copy' })
  expect(copies).toHaveLength(2)

  // Unpin.
  await ui.press({ key: 'pinned:src/main.ts' })
  await ui.press({ key: 'pin' })
  expect(store.get(`pins:${ROOT}`)).toEqual(['README.md'])
  expect(await ui.find({ key: 'pinned:src/main.ts' })).toBeUndefined()
})

test('shows sizes and ages, and dims or hides what git ignores', async ($, on) => {
  const DAY = 86_400_000
  const now = 400 * DAY
  const tree: Record<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }[]> = {
    [ROOT]: [
      { name: 'build', kind: 'dir', size: 0, mtimeMs: 0 },
      { name: 'big.bin', kind: 'file', size: 4300, mtimeMs: now - 3 * DAY },
      { name: 'README.md', kind: 'file', size: 812, mtimeMs: now - 5 * 60_000 },
    ],
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('clock.now', async () => ({ value: now }))
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'file' as const, size: 812, mtimeMs: now - 5 * 60_000, isLink: false, realPath: e.path },
  }))
  on('fs.list', async (_$, e) => ({ value: (tree[e.path] ?? []).map(one => ({ ...one, isLink: false })) }))
  on('fs.read', async () => ({ value: '# Hi\n' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // Ignored entries are drawn dim; files carry their size and age.
  expect((await ui.find({ key: 'row:build' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ key: 'row:README.md' }))?.props.dimColor).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 4.2K 3d' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 812 5m' })).toBeDefined()

  // g hides them, and again shows them.
  await ui.press({ key: 'ignored' })
  expect(await ui.find({ key: 'row:build' })).toBeUndefined()
  expect(await ui.find({ key: 'row:README.md' })).toBeDefined()
  await ui.press({ key: 'ignored' })
  expect(await ui.find({ key: 'row:build' })).toBeDefined()

  // The preview's status line names the size and age too.
  await ui.press({ key: 'row:README.md' })
  expect(await ui.find({ text: /812 · 5m ago/ })).toBeDefined()

  // A narrow tree leaves the details out.
  await ui.unmount()
  const narrow = await $.ui.mount(PANE('file-explorer', 30))
  expect(await narrow.find({ type: 'Text', text: ' 812 5m' })).toBeUndefined()
})

test('outlines the open file and jumps to a symbol, which r then names', async ($, on) => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `  // step ${i + 1}`)
  const code = [
    'import { x } from "y"',
    'export function first() {',
    ...filler(40),
    '}',
    '',
    'export class Store {',
    '  load(key: string) {',
    ...filler(40),
    '  }',
    '}',
    '',
  ].join('\n')
  const readme = ['# Title', 'intro', '## Usage', ...Array.from({ length: 60 }, () => 'text'), '## Notes', 'end', ''].join('\n')
  let filled = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async (_$, e) => ({ value: e.path.endsWith('.md') ? readme : code }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.selection', async () => ({ value: undefined }))
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // Nothing open yet: the tab says what it needs.
  await ui.press({ key: 'tab:outline' })
  expect(await ui.find({ text: 'Open a file to see its outline.' })).toBeDefined()

  // A changed file opens as its diff; the outline jumps into the file itself.
  await ui.press({ key: 'tab:files' })
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/main.ts' })
  await ui.press({ key: 'mode:diff' })
  await ui.press({ key: 'tab:outline' })
  expect((await ui.find({ key: 'sym:2' }))?.props.label).toBe('first')
  expect((await ui.find({ key: 'sym:45' }))?.props.label).toBe('Store')
  expect((await ui.find({ key: 'sym:46' }))?.props.label).toBe('load')

  await ui.press({ key: 'sym:46' })
  const shown = await ui.find({ type: 'Code' })
  expect(shown?.props.format).not.toBe('diff')
  expect(shown?.props.startLine).toBe(46)

  // r names the symbol's lines while it is in view, else the lines shown.
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@src/main.ts (lines 46-87) ')
  await ui.press({ key: 'sym:2' })
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@src/main.ts (lines 2-43) ')

  // Markdown: the headings, nested under the top one.
  await ui.press({ key: 'tab:files' })
  await ui.press({ key: 'row:README.md' })
  await ui.press({ key: 'tab:outline' })
  expect((await ui.find({ key: 'sym:3' }))?.props.label).toBe('Usage')
  await ui.press({ key: 'sym:64' })
  expect(await ui.find({ key: 'sym:64' })).toBeDefined()

  // A file with no outline says so; /files outline opens the tab.
  await ui.press({ key: 'tab:files' })
  await ui.press({ key: 'row:src/util.ts' })
  await $.command.run({ command: 'files', args: 'outline' } as never)
  expect(await ui.find({ key: 'sym:2' })).toBeDefined()
})

test('opens CSV as a table and JSON as a tree, with the source a key away', async ($, on) => {
  const wide = 'x'.repeat(39)
  const wider = 'y'.repeat(39)
  const csv = ['id,name,note,more', `1,"Smith, J",${wide},${wider}`, `2,Ann,"two\nlines"`, `3,Bo,${wide}`].join('\n') + '\n'
  const json = '{\n  "name": "app",\n  "deps": {\n    "a": "^1",\n    "b": "^2"\n  },\n  "list": [1, 2]\n}\n'
  const files: Record<string, string> = { 'data.csv': csv, 'pkg.json': json, 'bad.json': '{\n  "a": 1,\n  "b" 2\n}\n' }
  const tree = Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false }))
  let filled = ''
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({ value: e.path === ROOT ? tree : [] }))
  on('fs.read', async (_$, e) => ({ value: files[e.path.slice(ROOT.length + 1)] ?? '' }))
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.selection', async () => ({ value: undefined }))
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 100))

  // CSV: a header, a rule, aligned rows; a quoted newline stays in its cell.
  await ui.press({ key: 'row:data.csv' })
  expect((await ui.find({ key: 'mode:data' }))?.props.label).toBe('Table')
  expect(await ui.find({ type: 'Text', text: /^id │ name\s+│ note\s+│/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\s+│ Smith, J │ x+/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2\s+│ Ann\s+│ two\?lines\s/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  // Wide tables scroll sideways.
  await ui.press({ key: 'right' })
  expect(await ui.find({ type: 'Text', text: /^id │/ })).toBeUndefined()
  await ui.press({ key: 'left' })
  // r with nothing picked names the records in view by their lines.
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@data.csv (lines 1-5) ')
  // Source is a key away.
  await ui.press({ key: 'mode:file' })
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('id,name,note,more')

  // JSON: a tree two levels open; a key folds, unfolds and picks.
  await ui.press({ key: 'row:pkg.json' })
  expect((await ui.find({ key: 'mode:data' }))?.props.label).toBe('Tree')
  expect((await ui.find({ key: 'json:deps.b' }))?.props.label).toBe('b')
  expect(await ui.find({ type: 'Text', text: '"^2"' })).toBeDefined()
  await ui.press({ key: 'json:deps' })
  expect(await ui.find({ key: 'json:deps.b' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'at deps' })).toBeDefined()
  await ui.press({ key: 'json:deps' })
  await ui.press({ key: 'json:list[1]' })
  expect(await ui.find({ type: 'Text', text: 'at list[1]' })).toBeDefined()
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@pkg.json (list[1]) ')

  // Invalid JSON says where it breaks.
  await ui.press({ key: 'row:bad.json' })
  expect(await ui.find({ type: 'Text', text: "Not valid JSON: expected ':' at line 3, column 7." })).toBeDefined()
})

test("shows a file's own history and its blame, each commit a press away", async ($, on) => {
  const A = 'a'.repeat(40)
  const B = 'b'.repeat(40)
  const Z = '0'.repeat(40)
  const blameOut = [
    `${A} 1 1 2`, 'author Alice', 'author-time 1000', 'summary Start', 'filename src/main.ts', '\tone',
    `${A} 2 2`, '\ttwo',
    `${B} 3 3 1`, 'author Bob \u001b[31m', 'author-time 2000', 'summary Fix', 'filename src/main.ts', '\tthree',
    `${Z} 4 4 1`, 'author Not Committed Yet', 'author-time 3000', 'summary Version', 'filename src/main.ts', '\tfour',
    '',
  ].join('\n')
  const fileLog = `\x1e${B}\x1fbbbbbbb\x1fFix it\x1fBob\x1f1 day ago\x1f\n\nsrc/main.ts\n\x1e${A}\x1faaaaaaa\x1fStart\x1fAlice\x1f2 days ago\x1f\n\nsrc/main.ts\n`
  const argvs: string[][] = []
  let blames = 0
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('clock.now', async () => ({ value: 1_000_000_000 }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async () => ({ value: 'one\ntwo\nthree\nfour\n' }))
  on('process.run', async (_$, e) => {
    argvs.push([...e.argv])
    const line = gitArgs(e.argv).join(' ')
    if (line.startsWith('log --follow')) return ok(fileLog)
    if (line.startsWith('blame ')) {
      blames++
      return ok(blameOut)
    }
    return fakeGit(e.argv, [])
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [{ id: 'file-explorer', title: 'Explorer', isShown: true, isFocused: true, isPlaced: true }] }))
  on('ui.toast', async () => ({ value: undefined }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 140))
  await ui.press({ key: 'row:src' })
  await ui.press({ key: 'row:src/main.ts' })

  // Blame from the diff: the source, cut not wrapped, a label per run.
  await ui.press({ key: 'blame' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).not.toBe('diff')
  expect(code?.props.wrap).toBe('truncate-end')
  expect((await ui.find({ key: 'blamed:1' }))?.props.label).toBe('aaaaaaa')
  expect(await ui.find({ key: 'blamed:2' })).toBeUndefined()
  expect((await ui.find({ key: 'blamed:3' }))?.props.label).toBe('bbbbbbb')
  expect((await ui.find({ key: 'blamed:4' }))?.props.label).toBe('·······')
  expect(await ui.find({ text: /Alice/ })).toBeDefined()
  expect(await ui.find({ text: /Bob \?\[31m/ })).toBeDefined()
  expect(await ui.find({ text: /uncommitted/ })).toBeDefined()
  const run = argvs.find(argv => argv.includes('blame'))
  expect(run).toContain('--no-textconv')
  expect(run).toContain('core.fsmonitor=false')
  expect(run?.slice(-2)).toEqual(['--', 'src/main.ts'])

  // Off and on again: the run is kept while file and HEAD stay the same.
  await ui.press({ key: 'blame' })
  expect(await ui.find({ key: 'blamed:1' })).toBeUndefined()
  await ui.press({ key: 'blame' })
  expect(await ui.find({ key: 'blamed:1' })).toBeDefined()
  expect(blames).toBe(1)

  // A blamed commit opens with this file's diff in it.
  await ui.press({ key: 'blamed:3' })
  expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBeUndefined()
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')

  // The file's history narrows the History tab; ✕ widens it again.
  await ui.press({ key: 'log' })
  expect(await ui.find({ key: 'history:all' })).toBeDefined()
  expect((await ui.find({ key: `commit:${B}` }))?.props.label).toBe('Fix it')
  expect(argvs.some(argv => argv.includes('--follow') && argv[argv.length - 1] === 'src/main.ts')).toBe(true)
  await ui.press({ key: `commit:${A}` })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  await ui.press({ key: 'tab:history' })
  await ui.press({ key: 'history:all' })
  expect(await ui.find({ key: 'history:all' })).toBeUndefined()
  expect(await ui.find({ key: 'commit:aaaa' })).toBeDefined()
})

test('previews pictures on every surface: drawn where it can be, named elsewhere', async ($, on) => {
  const BYTES: Record<string, string> = {
    'photo.png': 'iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA=',
    'photo.jpg': '/9j/4AAEAAD/wAARCAB4AKADAAAAAA==',
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n'
  const names = ['icon.svg', 'away.png', 'photo.jpg', 'photo.png']
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.list', async (_$, e) => ({
    value: (e.path === ROOT ? names : []).map(name => ({ name, kind: 'file' as const, size: 2000, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', async (_$, e) => ({
    value: {
      kind: 'file' as const,
      size: 2000,
      mtimeMs: 5,
      isLink: e.path.endsWith('away.png'),
      realPath: e.path.endsWith('away.png') ? '/home/me/secret.png' : e.path,
    },
  }))
  const reads: string[] = []
  on('fs.read', async (_$, e) => {
    reads.push(e.path)
    const name = e.path.slice(ROOT.length + 1)
    if (e.as === 'bytes') return { value: { base64: BYTES[name] ?? '' } }
    return { value: name === 'icon.svg' ? svg : '' }
  })
  on('process.run', async (_$, e) => fakeGit(e.argv, []))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE('file-explorer', 120), surface })
    // The preview sits beside the tree where the view splits, else in its own pane.
    const look = async (query: Parameters<typeof ui.find>[0]) => {
      const here = await ui.find(query)
      if (here !== undefined) return here
      const pane = await $.ui.mount({ ...PANE('file-preview', 80), surface })
      const found = await pane.find(query)
      await pane.unmount()
      return found
    }

    await ui.press({ key: 'row:photo.png' })
    const image = await look({ type: 'Image' })
    if (surface === 'terminal') {
      // Read by the terminal from its real path; 640×480 kept 4:3 in 2:1 cells.
      expect(image?.props.source).toEqual({ file: `${ROOT}/photo.png`, format: 'png', generation: 5 })
      expect(image?.props.alt).toContain('PNG image 640×480')
      const { columns, rows } = image?.props as { columns: number; rows: number }
      expect(Math.abs(columns / rows / 2 - 640 / 480)).toBeLessThan(0.15)
    } else {
      expect(image).toBeUndefined()
      expect(await look({ type: 'Text', text: 'PNG image 640×480' })).toBeDefined()
      expect(await look({ type: 'Text', text: 'Pictures are drawn in the terminal (kitty, Ghostty).' })).toBeDefined()
    }

    // No clock here: the status line names the size and leaves the age out.
    expect(await look({ type: 'Text', text: /2\.0K/ })).toBeDefined()
    expect(await look({ type: 'Text', text: /ago/ })).toBeUndefined()

    await ui.press({ key: 'row:photo.jpg' })
    expect(await look({ type: 'Text', text: 'JPEG image 160×120' })).toBeDefined()
    expect(await look({ type: 'Text', text: 'Only PNG is drawn; open it in a viewer to see it.' })).toBeDefined()
    expect(await look({ type: 'Image' })).toBeUndefined()

    // A picture linked from outside the project is named, never read or drawn.
    await ui.press({ key: 'row:away.png' })
    expect(await look({ type: 'Text', text: 'links outside the project: /home/me/secret.png' })).toBeDefined()
    expect(await look({ type: 'Image' })).toBeUndefined()

    // SVG: its source everywhere, drawn above it where the surface has Svg.
    await ui.press({ key: 'row:icon.svg' })
    expect(String((await look({ type: 'Code' }))?.props.source)).toContain('<rect')
    const drawn = await look({ type: 'Svg' })
    if (surface === 'terminal') expect(drawn).toBeUndefined()
    else expect(drawn?.props.source).toBe(svg)
    await ui.unmount()
  }
  expect(reads.some(path => path.endsWith('away.png'))).toBe(false)
})

const MERMAID_DOC = ['# Flow', '', '```mermaid', 'graph TD', '  A --> B', '```', '', '```mermaid', 'graph TD', '  A -->', '```', ''].join('\n')

type TestOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

function mermaidHooks(on: TestOn, runs: { argv: string[]; stdin?: string }[], hasMmdc: boolean) {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({
    value: (e.path === ROOT ? [{ name: 'README.md', kind: 'file' as const, size: 100 }] : []).map(one => ({ ...one, mtimeMs: 0, isLink: false })),
  }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.read', async (_$, e) => {
    if (e.path.endsWith('.png')) return { value: { base64: 'iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA=' } }
    if (e.path.endsWith('.svg')) return { value: '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>' }
    return { value: MERMAID_DOC }
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return fakeGit(e.argv, [])
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    if (e.argv[0] === 'mmdc' && !hasMmdc) throw new Error('spawn mmdc ENOENT')
    if (e.argv[1] === '--version') return ok('12.0.0\n')
    if (e.argv[0] === 'mmdc' && (e.init?.stdin ?? '').includes('A -->\n') === false && (e.init?.stdin ?? '').endsWith('A -->')) {
      return { value: { exitCode: 1, stdout: '', stderr: "Error: Parse error on line 2:\nExpecting 'NODE_STRING', got 'EOF'\n    at x (y)", isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return ok('')
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
}

test("draws mermaid blocks with the person's own mmdc, a picture in the terminal and SVG in the apps", async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  const clock = mock.clock(on)
  mermaidHooks(on, runs, true)

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:README.md' })
  await clock.settle()

  // Asked once whether mmdc is there; the cache made private under HOME.
  expect(runs.filter(run => run.argv.join(' ') === 'mmdc --version')).toHaveLength(1)
  const mkdir = runs.find(run => run.argv[0] === 'node')
  expect(mkdir?.argv.at(-1)).toBe('/home/me/.cache/claude-file-explorer/mermaid')
  expect(mkdir?.argv[2]).toContain('0o700')
  // Each diagram goes in on stdin, never as a file in the project.
  const draws = runs.filter(run => run.argv[0] === 'mmdc' && run.argv.includes('--input'))
  expect(draws[0]?.stdin).toBe('graph TD\n  A --> B')
  expect(draws[0]?.argv).toContain('-')
  expect(draws.every(run => String(run.argv[run.argv.indexOf('--output') + 1]).startsWith('/home/me/.cache/'))).toBe(true)

  // The good one is a picture; the broken one says why, its source kept.
  const image = await ui.find({ type: 'Image' })
  expect(String((image?.props.source as { file: string }).file)).toMatch(/^\/home\/me\/\.cache\/claude-file-explorer\/mermaid\/[0-9a-f]+\.png$/)
  expect(await ui.find({ type: 'Text', text: "mmdc: Parse error on line 2: Expecting 'NODE_STRING', got 'EOF'" })).toBeDefined()
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('A -->')

  // The desktop app draws the SVG.
  await ui.unmount()
  const app = await $.ui.mount({ ...PANE('file-explorer', 120), surface: 'desktop' })
  expect(String((await app.find({ type: 'Svg' }))?.props.source)).toContain('<svg')
  expect(await app.find({ type: 'Image' })).toBeUndefined()

  // Opening it again draws nothing new.
  const before = runs.length
  await app.press({ key: 'row:README.md' })
  await clock.settle()
  expect(runs.length).toBe(before)
})

test('without mmdc, says how to get it and runs nothing more', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  const clock = mock.clock(on)
  mermaidHooks(on, runs, false)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:README.md' })
  await clock.settle()
  expect(runs.map(run => run.argv.join(' '))).toEqual(['mmdc --version'])
  expect(await ui.find({ type: 'Text', text: 'Install mermaid-cli (npm i -g @mermaid-js/mermaid-cli) to draw diagrams.' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('with mermaid off, never runs mmdc', { options: { mermaid: 'off' } }, async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  const clock = mock.clock(on)
  mermaidHooks(on, runs, true)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:README.md' })
  await clock.settle()
  expect(runs).toEqual([])
  expect(await ui.find({ text: /mermaid-cli/ })).toBeUndefined()
})

function pictureHooks(on: TestOn, runs: string[][], tools: { ffmpeg?: boolean; rsvg?: boolean; fail?: boolean }) {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA='
  const JPG = '/9j/4AAEAAD/wAARCAB4AKADAAAAAA=='
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.list', async (_$, e) => ({
    value: (e.path === ROOT ? ['photo.jpg', 'icon.svg'] : []).map(name => ({ name, kind: 'file' as const, size: 2000, mtimeMs: 7, isLink: false })),
  }))
  on('fs.stat', async (_$, e) => ({ value: { kind: e.path === ROOT ? ('dir' as const) : ('file' as const), size: 2000, mtimeMs: 7, isLink: false, realPath: e.path } }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.read', async (_$, e) => {
    if (e.path.startsWith('/home/me/.cache/')) return { value: { base64: PNG } }
    if (e.as === 'bytes') return { value: { base64: JPG } }
    return { value: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n' }
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return fakeGit(e.argv, [])
    runs.push([...e.argv])
    const [tool, first] = e.argv
    if (tool === 'node') return ok('')
    if (tool === 'ffmpeg' && first === '-version') return tools.ffmpeg ? ok('ffmpeg version 6') : Promise.reject(new Error('ENOENT'))
    if (tool === 'rsvg-convert' && first === '--version') return tools.rsvg ? ok('rsvg-convert version 2.58') : Promise.reject(new Error('ENOENT'))
    if (tool === 'magick' || tool === 'convert') return Promise.reject(new Error('ENOENT'))
    if (tools.fail) return { value: { exitCode: 1, stdout: '', stderr: 'Invalid data found when processing input\n', isStdoutTruncated: false, isStderrTruncated: false } }
    return ok('')
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
}

test('converts JPEG and SVG to PNG with tools the person has, and draws that', async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  pictureHooks(on, runs, { ffmpeg: true, rsvg: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  await ui.press({ key: 'row:photo.jpg' })
  await clock.settle()
  const ffmpeg = runs.find(argv => argv[0] === 'ffmpeg' && argv.includes('-i'))
  expect(ffmpeg).toContain(`file:${ROOT}/photo.jpg`)
  expect(String(ffmpeg?.at(-1))).toMatch(/^file:\/home\/me\/\.cache\/claude-file-explorer\/pictures\/[0-9a-f]+\.png$/)
  const image = await ui.find({ type: 'Image' })
  expect(String((image?.props.source as { file: string }).file)).toBe(String(ffmpeg?.at(-1)).slice('file:'.length))
  expect(image?.props.alt).toContain('JPEG image 160×120')

  await ui.press({ key: 'row:icon.svg' })
  await clock.settle()
  const rsvg = runs.find(argv => argv[0] === 'rsvg-convert' && argv.includes('--output'))
  expect(rsvg?.at(-1)).toBe(`${ROOT}/icon.svg`)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('<svg')

  // Converters are looked for once; opening again converts nothing.
  const before = runs.length
  await ui.press({ key: 'row:photo.jpg' })
  await clock.settle()
  expect(runs.length).toBe(before)
  expect(runs.filter(argv => argv.join(' ') === 'ffmpeg -version')).toHaveLength(1)
})

test('without converters, says what to install; a failed one says why', async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  pictureHooks(on, runs, {})
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:photo.jpg' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Install ffmpeg or ImageMagick to draw JPEG, GIF and WebP here.' })).toBeDefined()
  await ui.press({ key: 'row:icon.svg' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Install rsvg-convert (librsvg) to draw SVG here.' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('a converter that fails is named with its error', async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  pictureHooks(on, runs, { ffmpeg: true, fail: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:photo.jpg' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Invalid data found when processing input' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('with pictures off, never runs a converter', { options: { pictures: 'off' } }, async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  pictureHooks(on, runs, { ffmpeg: true, rsvg: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'row:photo.jpg' })
  await ui.press({ key: 'row:icon.svg' })
  await clock.settle()
  expect(runs).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test("shows this branch's pull request and fetches another by number", async ($, on) => {
  const runs: { argv: string[]; env?: Record<string, string> }[] = []
  const toasts: string[] = []
  let hasGh = true
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', async (_$, e) => STAT(e.path))
  on('fs.list', async (_$, e) => ({ value: (TREE[e.path] ?? []).map(one => ({ ...one, mtimeMs: 0, isLink: false })) }))
  on('fs.read', async () => ({ value: 'export {}\n' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    if (e.argv[0] === 'gh') {
      if (!hasGh) throw new Error('ENOENT')
      const which = e.argv[3] === '--json' ? '' : e.argv[3]
      if (which === '') return ok(JSON.stringify({ number: 41, title: 'herdr-bridge\u001b[2J', baseRefName: 'main', headRefOid: 'a'.repeat(40) }))
      if (which === '7') return ok(JSON.stringify({ number: 7, title: 'Fix login', baseRefName: 'develop', headRefOid: 'b'.repeat(40) }))
      return ok('', 1)
    }
    const line = gitArgs(e.argv).join(' ')
    if (line.startsWith('fetch ')) return ok('')
    if (line === 'rev-parse --verify -q refs/file-explorer/pull/7^{commit}') return ok('pr7head\n')
    if (line === 'merge-base origin/main HEAD' || line === 'merge-base HEAD origin/main') return ok('forkpoint\n')
    if (line === 'merge-base origin/develop pr7head') return ok('base7\n')
    if (line.startsWith('diff --relative --name-status') && e.argv.includes('pr7head')) return ok('A\0src/login.ts\0')
    return fakeGit(e.argv, [])
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))
  await ui.press({ key: 'tab:changes' })

  // The base cycles HEAD → this branch's PR (from its fork point) → the default branch → HEAD.
  await ui.press({ key: 'base' })
  expect((await ui.find({ key: 'base' }))?.props.label).toBe('#41 herdr-bridge?[2J (vs main)')
  const diffs = runs.filter(run => run.argv.includes('--name-status'))
  expect(diffs.at(-1)?.argv).toContain('forkpoint')
  const view = runs.find(run => run.argv[0] === 'gh')
  expect(view?.argv).toEqual(['gh', 'pr', 'view', '--json', 'number,title,baseRefName,headRefOid'])
  expect(view?.env?.GH_PROMPT_DISABLED).toBe('1')
  await ui.press({ key: 'base' })
  expect(String((await ui.find({ key: 'base' }))?.props.label)).toContain('(merge-base)')
  await ui.press({ key: 'base' })
  expect((await ui.find({ key: 'base' }))?.props.label).toBe('HEAD')

  // Another PR by number: fetched into the explorer's own ref, safely, and shown from its fork point.
  await $.command.run({ command: 'changes', args: 'pr 7' } as never)
  const fetch = runs.find(run => run.argv.includes('fetch'))
  expect(fetch?.argv).toContain('protocol.ext.allow=never')
  expect(fetch?.argv).toContain('+refs/pull/7/head:refs/file-explorer/pull/7')
  expect(fetch?.env?.GIT_TERMINAL_PROMPT).toBe('0')
  expect((await ui.find({ key: 'base' }))?.props.label).toBe('#7 Fix login (vs develop)')
  expect(await ui.find({ key: 'change:src/login.ts' })).toBeDefined()
  expect(runs.filter(run => run.argv.includes('--name-status')).at(-1)?.argv.slice(-2)).toEqual(['base7', 'pr7head'])

  // `#7` is the same; a number that is not one is a ref, and never fetched.
  const fetches = runs.filter(run => run.argv.includes('fetch')).length
  await $.command.run({ command: 'changes', args: 'pr -1' } as never)
  expect(runs.filter(run => run.argv.includes('fetch')).length).toBe(fetches)

  // Without gh: no PR to find, so the default branch, and said so.
  hasGh = false
  await $.command.run({ command: 'changes', args: 'pr' } as never)
  expect(String((await ui.find({ key: 'base' }))?.props.label)).toContain('(merge-base)')
  expect(toasts.some(text => text.includes('needs gh'))).toBe(true)
})
