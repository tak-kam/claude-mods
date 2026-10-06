// The herdr pane a session runs in: herdr's CLI and the pane's id.
export type HerdrTarget = { bin: string; pane: string }

declare module 'claude-code' {
  interface PluginState {
    'herdr-bridge': {
      // The herdr pane this session runs in; null outside herdr.
      target: HerdrTarget | null
      // The turn under way: when it began and how many tools it called.
      turn: { startedAt: number; tools: number }
      // What the session waits on now, so the wait ends when it is answered.
      waiting: 'question' | 'permission' | null
    }
  }
}
