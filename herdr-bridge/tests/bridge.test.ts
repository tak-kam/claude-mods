import { expect, mock, test } from 'claude-code/testing'

type TestOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2', HERDR_BIN_PATH: '/opt/herdr' } as Record<string, string>

// The engine beneath the plugin: each event answered, herdr's CLI recorded.
function engine(on: TestOn, runs: string[][], env: Record<string, string> = HERDR, isHerdrGone = false) {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('env.get', async (_$, e) => ({ value: env[e.name] }))
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    if (isHerdrGone) throw new Error('herdr gone')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ result: {} as never }))
  on('classic.PermissionRequest', async () => ({}) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
}

// The flags after `--seq N`, and the seq itself, of each report.
const tail = (argv: string[]) => argv.slice(argv.indexOf('--seq') + 2)
const seqOf = (argv: string[]) => Number(argv[argv.indexOf('--seq') + 1])
const verb = (argv: string[]) => argv[2]

test('tells herdr the prompt, the question waited on, and how the turn ended', async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  engine(on, runs)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs).toEqual([])

  // A slash command is not work: the pane is left as it is.
  await $.prompt.submit({ text: '/files changes', wait: false, origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(runs).toEqual([])

  await $.prompt.submit({ text: 'fix the login bug\nwith tests', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'fix the login bug', turnId: 't1' } as never)
  await clock.settle()
  expect(runs.at(-1)?.slice(0, 4)).toEqual(['/opt/herdr', 'pane', 'report-metadata', 'w1:p2'])
  expect(tail(runs.at(-1) ?? [])).toEqual(['--title', 'fix the login bug', '--clear-state-labels', '--state-label', 'working=working'])

  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which approach?', header: 'Approach', options: [], multiSelect: false }] } as never)
  await clock.settle()
  const [asked, back] = runs.slice(-2).map(tail)
  expect(asked).toEqual(['--clear-state-labels', '--state-label', 'blocked=Q: Which approach?'])
  expect(back).toEqual(['--clear-state-labels', '--state-label', 'working=working'])

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } } as never)
  await clock.settle()
  expect(tail(runs.at(-1) ?? [])).toEqual(['--clear-state-labels', '--state-label', 'blocked=Permission: Bash npm test'])
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await clock.settle()
  expect(tail(runs.at(-1) ?? [])).toEqual(['--clear-state-labels', '--state-label', 'working=working'])

  await clock.advance(130_000)
  await $.turn.complete({ answer: 'done', durationMs: 130_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(tail(runs.at(-1) ?? [])).toEqual(['--clear-state-labels', '--state-label', 'idle=done', '--token', 'summary=3 tools · 2m 10s'])

  // A subagent's turn leaves the pane alone.
  const before = runs.length
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'a1' } as never)
  await clock.settle()
  expect(runs.length).toBe(before)

  // Metadata only by default: never the state herdr's own integration owns.
  expect(runs.every(argv => verb(argv) === 'report-metadata')).toBe(true)
  // Every report numbered after the last.
  const seqs = runs.map(seqOf)
  expect(seqs.every((seq, i) => i === 0 || seq > (seqs[i - 1] ?? 0))).toBe(true)

  await $.session.end({ reason: 'exit', sessionId: 's', resume: {} } as never)
  await clock.settle()
  expect(tail(runs.at(-1) ?? [])).toEqual(['--clear-title', '--clear-state-labels', '--clear-token', 'summary'])
})

test('outside herdr, nothing is sent', async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  engine(on, runs, {})
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Q?' }] } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await $.session.end({ reason: 'exit', sessionId: 's', resume: {} } as never)
  await clock.settle()
  expect(runs).toEqual([])
})

test('a herdr that fails or hangs never stops Claude', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  engine(on, runs, HERDR, true)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const submitted = await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  expect((submitted as { text?: string }).text).toBe('go')
  const ran = await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Q?' }] } as never)
  expect(ran).toBeDefined()
  await clock.settle()
  // It was asked, failed, and nothing came of it.
  expect(runs.length).toBeGreaterThan(0)
})

test('state mode also reports working, blocked and idle, and releases at the end', { options: { mode: 'state' } }, async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  engine(on, runs)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which?' }] } as never)
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: true, turnId: 't', reason: 'aborted' } as never)
  await $.session.end({ reason: 'exit', sessionId: 's', resume: {} } as never)
  await clock.settle()
  const states = runs.filter(argv => verb(argv) === 'report-agent').map(argv => {
    const message = argv.indexOf('--message')
    return `${argv[argv.indexOf('--state') + 1]}${message < 0 ? '' : ` ${argv[message + 1]}`}`
  })
  expect(states).toEqual(['idle', 'working', 'blocked Q: Which?', 'working', 'idle'])
  expect(runs.filter(argv => verb(argv) === 'report-metadata').at(-2)?.join(' ')).toContain('idle=interrupted')
  expect(verb(runs.at(-1) ?? [])).toBe('release-agent')
})

test('with text off, herdr gets labels but none of the session’s words', { options: { text: 'labels' } }, async ($, on) => {
  const runs: string[][] = []
  const clock = mock.clock(on)
  engine(on, runs)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'secret plan', wait: false, origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Secret?' }] } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'cat .env' } } as never)
  await clock.settle()
  const sent = runs.map(argv => argv.join(' ')).join('\n')
  expect(sent).not.toContain('secret')
  expect(sent).not.toContain('Secret')
  expect(sent).not.toContain('.env')
  expect(sent).toContain('blocked=waiting on a question')
  expect(sent).toContain('blocked=waiting on a permission')
})
