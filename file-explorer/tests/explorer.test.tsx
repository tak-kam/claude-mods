import { expect, test } from 'claude-code/testing'

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

function fakeGit(argv: readonly string[], log: string[]) {
  const args = argv.slice(1)
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
  on('fs.stat', async (_$, e) => ({
    value: { kind: e.path.endsWith('/src') ? ('dir' as const) : ('file' as const), size: 30, mtimeMs: 0, isLink: false },
  }))
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
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 30, mtimeMs: 0, isLink: false } }))
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
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 30, mtimeMs: 0, isLink: false } }))
  on('process.run', async (_$, e) => {
    const args = e.argv.slice(1).join(' ')
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
  on('clock.now', async () => ({ value: new Date(2026, 9, 3, 12, 34).getTime() }))
  on('ui.toast', async () => ({ value: undefined }))

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('file-explorer', 120))

  // A prompt snapshots the working tree through the explorer's own index.
  await $.prompt.submit({ text: 'fix the needle', wait: false, origin: { kind: 'composer' } } as never)
  const added = runs.find(one => one.args === 'add -A')
  expect(added?.index).toBe(`${ROOT}/.git/file-explorer-index`)

  // Claude reading a file shows it at the lines it read.
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/util.ts`, offset: 40 } as never)
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
  code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(String(code?.props.source)).toContain('+const needle = 1')

  // # names the lines in view: here the hunk's new side.
  await ui.press({ key: 'ref' })
  expect(filled).toBe('@src/main.ts (lines 58-62) ')

  // Follow off: a read no longer moves the preview.
  await ui.press({ key: 'follow' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/util.ts` } as never)
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
})
