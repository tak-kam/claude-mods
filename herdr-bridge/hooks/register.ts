import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import {
  herdrTarget,
  isCommand,
  metadataArgs,
  permissionText,
  promptTitle,
  questionText,
  releaseArgs,
  stateArgs,
  turnSummary,
} from './herdr'
import type { Display, HerdrStatus, TurnEnd } from './herdr'

const target = atom({ plugin: 'herdr-bridge', key: 'target' } as const, null)
const turn = atom({ plugin: 'herdr-bridge', key: 'turn' } as const, { startedAt: 0, tools: 0 })
const waiting = atom({ plugin: 'herdr-bridge', key: 'waiting' } as const, null)

const settings = { mode: 'metadata' as 'metadata' | 'state', isTextShared: true }

// herdr keeps the report with the highest seq from a source, so each one is
// numbered after the last: the time in microseconds, never going back.
let lastSeq = 0
async function nextSeq($: EngineInterface): Promise<number> {
  const now = Math.floor((await $.clock.now()) * 1000)
  lastSeq = Math.max(now, lastSeq + 1)
  return lastSeq
}

// Sends after the hook has returned, with a short timeout, failures dropped:
// herdr being slow or gone never slows Claude down.
function send($: EngineInterface, argv: string[]) {
  $.clock.after(0, () => void $.process.run(argv, { timeoutMs: 3000 }).catch(() => undefined))
}

// One change of what the pane shows (and, in state mode, of its state).
async function report($: EngineInterface, status: HerdrStatus, display: Omit<Display, 'status'>, message?: string) {
  const where = await read($, target)
  if (where === null) return
  send($, metadataArgs(where, await nextSeq($), { ...display, status }))
  if (settings.mode === 'state') send($, stateArgs(where, await nextSeq($), status, message))
}

// The session's own words go to herdr only when the person allows it.
const shared = (text: string, label: string) => (settings.isTextShared && text !== '' ? `${label}${text}` : label.replace(/: $/, ''))

export const register: Register = (on, options) => {
  settings.mode = options.mode === 'state' ? 'state' : 'metadata'
  settings.isTextShared = options.text !== 'labels'

  on('session.start', async ($, e, next) => {
    const found = herdrTarget({
      HERDR_ENV: await $.env.get('HERDR_ENV'),
      HERDR_PANE_ID: await $.env.get('HERDR_PANE_ID'),
      HERDR_BIN_PATH: await $.env.get('HERDR_BIN_PATH'),
    })
    await update($, target, () => found ?? null)
    if (found !== undefined && settings.mode === 'state') await report($, 'idle', {})
    return next(e)
  })

  // Every hook below lets the event through whatever herdr does: a report
  // that fails is dropped, never in Claude's way.
  on('prompt.submit', async ($, e, next) => {
    await (async () => {
      // A slash command may start no turn at all: leave the pane as it is.
      if (isCommand(e.text)) return
      await update($, turn, () => ({ startedAt: 0, tools: 0 }))
      await update($, waiting, () => null)
      const title = settings.isTextShared ? promptTitle(e.text) : ''
      await report($, 'working', { title: title === '' ? undefined : title, label: 'working' })
    })().catch(() => undefined)
    return next(e)
  })
    // A failed or slow hook still lets the event through.
    .catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turn, was => (was.startedAt === 0 ? { ...was, startedAt: now } : was))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await (async () => {
      await update($, turn, was => ({ ...was, tools: was.tools + 1 }))
      if (e.tool !== 'AskUserQuestion') return
      const asked = questionText((e as unknown as { questions?: unknown }).questions)
      await update($, waiting, () => 'question' as const)
      const label = shared(asked, 'Q: ')
      await report($, 'blocked', { label: label === 'Q' ? 'waiting on a question' : label }, label)
    })().catch(() => undefined)
    const result = await next(e)
    // Answered, or allowed and run: back to work.
    await (async () => {
      if ((await read($, waiting)) === null) return
      await update($, waiting, () => null)
      await report($, 'working', { label: 'working' })
    })().catch(() => undefined)
    return result
  })
    // A failed or slow hook still lets the event through.
    .catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await (async () => {
      const asked = permissionText(String(e.tool_name), e.tool_input)
      await update($, waiting, () => 'permission' as const)
      const label = shared(asked, 'Permission: ')
      await report($, 'blocked', { label: label === 'Permission' ? 'waiting on a permission' : label }, label)
    })().catch(() => undefined)
    return next(e)
  })
    // A failed or slow hook still lets the event through.
    .catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn is not the session's.
    if (e.agentId !== undefined) return result
    const now = await $.clock.now()
    const ran = await read($, turn)
    const end = (['answer', 'aborted', 'refusal', 'error'].includes(String(e.reason)) ? e.reason : 'answer') as TurnEnd
    const summary = turnSummary(end, ran.tools, ran.startedAt === 0 ? e.durationMs ?? 0 : now - ran.startedAt)
    await update($, waiting, () => null)
    await report($, 'idle', { label: end === 'answer' ? 'done' : end === 'aborted' ? 'interrupted' : end, summary })
    return result
  })

  on('session.end', async ($, e, next) => {
    const where = await read($, target)
    if (where !== null) {
      send($, metadataArgs(where, await nextSeq($), { clear: true }))
      if (settings.mode === 'state') send($, releaseArgs(where, await nextSeq($)))
    }
    return next(e)
  })
}
