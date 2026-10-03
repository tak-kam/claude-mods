export type ExplorerEntry = { name: string; isDir: boolean; size: number }

export type ExplorerView = 'files' | 'changes' | 'history'

export type ExplorerChange = {
  path: string
  letter: string
  from?: string
}

// Changes are `ref` against the working tree, or against `head` when set.
export type ExplorerBase = {
  ref: string
  label: string
  head?: string
}

export type ExplorerCommit = {
  sha: string
  short: string
  subject: string
  author: string
  when: string
}

// `rendered` draws a markdown file as markdown.
export type ExplorerMode = 'file' | 'diff' | 'rendered'

export type ExplorerPreview = {
  path: string
  mode: ExplorerMode
  text: string
  diff: string
  note: string
  isChanged: boolean
  isOnDisk: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'file-explorer': {
      root: string
      view: ExplorerView
      base: ExplorerBase
      expanded: string[]
      listings: Record<string, ExplorerEntry[]>
      changes: ExplorerChange[]
      history: ExplorerCommit[]
      gitError: string
      touched: string[]
      selected: string
      preview: ExplorerPreview | null
      listOffset: number
      previewOffset: number
    }
  }
}
