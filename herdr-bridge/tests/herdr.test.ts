import { describe, expect, test } from 'claude-code/testing'
import {
  duration,
  herdrTarget,
  isCommand,
  metadataArgs,
  oneLine,
  permissionText,
  promptTitle,
  questionText,
  releaseArgs,
  stateArgs,
  turnSummary,
} from '../hooks/herdr'

const T = { bin: '/opt/herdr', pane: 'w1:p2' }

describe('herdrTarget', () => {
  test('only inside herdr, with all three variables', () => {
    expect(herdrTarget({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2', HERDR_BIN_PATH: '/opt/herdr' })).toEqual(T)
    expect(herdrTarget({ HERDR_PANE_ID: 'w1:p2', HERDR_BIN_PATH: '/opt/herdr' })).toBeUndefined()
    expect(herdrTarget({ HERDR_ENV: '1', HERDR_BIN_PATH: '/opt/herdr' })).toBeUndefined()
    expect(herdrTarget({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2' })).toBeUndefined()
    expect(herdrTarget({ HERDR_ENV: '1', HERDR_PANE_ID: '--help', HERDR_BIN_PATH: '/opt/herdr' })).toBeUndefined()
  })
})

describe('text', () => {
  test('one line, no controls or bidi, at most 80 characters', () => {
    expect(oneLine('a\nb\t\u001b[31mc‮d')).toBe('a b [31mc d')
    expect(oneLine('x'.repeat(100))).toHaveLength(80)
    expect(oneLine('x'.repeat(100)).endsWith('…')).toBe(true)
  })

  test('the prompt title is its first non-empty line', () => {
    expect(promptTitle('\n\n  fix the login bug  \nmore detail')).toBe('fix the login bug')
    expect(promptTitle('   ')).toBe('')
  })

  test('slash commands are not work', () => {
    expect(isCommand('/files changes')).toBe(true)
    expect(isCommand('  /clear')).toBe(true)
    expect(isCommand('/ is the root')).toBe(false)
    expect(isCommand('fix /etc/hosts')).toBe(false)
  })

  test('the first question, with a count of the rest', () => {
    expect(questionText([{ question: 'Which approach?' }, { question: 'Name?' }])).toBe('Which approach? (+1)')
    expect(questionText([{ header: 'Auth' }])).toBe('Auth')
    expect(questionText('nonsense')).toBe('')
  })

  test('a permission names the tool and what it acts on', () => {
    expect(permissionText('Bash', { command: 'npm test' })).toBe('Bash npm test')
    expect(permissionText('Edit', { file_path: '/p/a.ts' })).toBe('Edit /p/a.ts')
    expect(permissionText('mcp__x__y', null)).toBe('mcp__x__y')
  })

  test('turn summaries', () => {
    expect(duration(9_400)).toBe('9s')
    expect(duration(130_000)).toBe('2m 10s')
    expect(duration(3_900_000)).toBe('1h 5m')
    expect(turnSummary('answer', 4, 130_000)).toBe('4 tools · 2m 10s')
    expect(turnSummary('aborted', 1, 5_000)).toBe('interrupted · 1 tool · 5s')
    expect(turnSummary('error', 0, 1_000)).toBe('error · 0 tools · 1s')
  })
})

describe('argument vectors', () => {
  test('metadata names this source and the claude agent, labels replace the old ones', () => {
    expect(metadataArgs(T, 7, { title: 'fix\nit', status: 'blocked', label: 'Q: Which?' })).toEqual([
      '/opt/herdr', 'pane', 'report-metadata', 'w1:p2', '--source', 'claude-mods:herdr-bridge', '--agent', 'claude', '--seq', '7',
      '--title', 'fix it', '--clear-state-labels', '--state-label', 'blocked=Q: Which?',
    ])
    expect(metadataArgs(T, 8, { status: 'idle', label: 'done', summary: '4 tools · 2m' }).slice(10)).toEqual([
      '--clear-state-labels', '--state-label', 'idle=done', '--token', 'summary=4 tools · 2m',
    ])
    expect(metadataArgs(T, 9, { title: '' }).slice(10)).toEqual(['--clear-title'])
    expect(metadataArgs(T, 10, { clear: true }).slice(10)).toEqual(['--clear-title', '--clear-state-labels', '--clear-token', 'summary'])
  })

  test('state and release, under the same source', () => {
    expect(stateArgs(T, 3, 'blocked', 'Q: Which?\n')).toEqual([
      '/opt/herdr', 'pane', 'report-agent', 'w1:p2', '--source', 'claude-mods:herdr-bridge', '--agent', 'claude', '--state', 'blocked', '--seq', '3', '--message', 'Q: Which?',
    ])
    expect(stateArgs(T, 4, 'idle')).not.toContain('--message')
    expect(releaseArgs(T, 5)).toEqual(['/opt/herdr', 'pane', 'release-agent', 'w1:p2', '--source', 'claude-mods:herdr-bridge', '--agent', 'claude', '--seq', '5'])
  })
})
