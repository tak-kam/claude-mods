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
}

const PANE = (id: string) => ({
  plugin: 'file-explorer',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: id,
  props: {
    title: id,
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
})

test('lists folders first, expands, decorates and previews', async ($, on) => {
  let filled = ''
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
  on('process.run', async (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[2] === '--show-prefix' ? '\n' : ' M src/main.ts\0?? src/util.ts\0',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('prompt.read', async () => ({ value: { text: 'look at', cursor: 7 } }))
  on('prompt.fill', async (_$, e) => {
    filled = e.text
    return { isFilled: true as const, text: e.text }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE('file-explorer'))
  const rows = await ui.findAll({ type: 'Button' })
  const labels = rows.map(one => one.text).filter(text => text.length > 1)
  expect(labels).toEqual(['▸ src', '  README.md'])
  expect((await ui.find({ type: 'Text', text: '2 changed' }))).toBeDefined()

  await ui.press({ key: 'row:src' })
  expect(await ui.find({ key: 'row:src/main.ts' })).toBeDefined()
  expect((await ui.find({ key: 'row:src' }))?.text).toBe('▾ src')
  expect(await ui.find({ type: 'Text', text: ' M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' U' })).toBeDefined()

  await ui.press({ key: 'row:src/main.ts' })
  const shown = await $.ui.mount(PANE('file-preview'))
  expect((await shown.find({ type: 'Code' }))?.props.source).toBe('export const answer = 42\n')

  await shown.press({ key: 'mention' })
  expect(filled).toBe(' @src/main.ts ')

  await ui.press({ key: 'collapse' })
  expect(await ui.find({ key: 'row:src/main.ts' })).toBeUndefined()
})
