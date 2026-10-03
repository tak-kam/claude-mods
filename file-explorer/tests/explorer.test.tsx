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
  const readme = '# App\n\nSee [main](./src/main.ts) and [site](https://example.com).\n'
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

  const md = await ui.find({ type: 'Markdown' })
  expect(md?.props.text).toBe(readme.replace(/\n$/, ''))
  expect(md?.props.pressableLinks).toEqual(['./src/main.ts'])

  await ui.press({ key: 'mode:file' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('README.md')
  await ui.press({ key: 'mode:rendered' })

  // A relative link opens the file and unfolds the tree down to it.
  await ui.press({ key: 'md', link: { href: './src/main.ts' } })
  expect((await ui.find({ type: 'Code' }))?.props.path).toBe('src/main.ts')
  expect(await ui.find({ key: 'row:src/main.ts' })).toBeDefined()
})
