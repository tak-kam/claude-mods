export type ExplorerEntry = { name: string; isDir: boolean; size: number }

export type ExplorerView = 'files' | 'changes' | 'history' | 'search'

export type ExplorerHit = { path: string; line: number; column: number; text: string }

// File-name search filters as you type; text search runs rg on Enter.
export type ExplorerSearch = {
  mode: 'files' | 'text'
  query: string
  isRegex: boolean
  isCaseSensitive: boolean
  files: string[]
  hits: ExplorerHit[]
  note: string
}

export type ExplorerChange = {
  path: string
  letter: string
  from?: string
}

// Changes are `ref` against the working tree, or against `head` when set.
// A `turn` base is a snapshot of the working tree taken as a prompt was
// sent: changes are that tree against a fresh snapshot of the tree now.
export type ExplorerBase = {
  ref: string
  label: string
  head?: string
  kind?: 'turn'
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
  // The keys and commands, not a file: never reloaded from disk.
  isHelp?: boolean
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
      follow: boolean
      lastPrompt: ExplorerBase | null
      search: ExplorerSearch
      previewOffset: number
      wrapLines: boolean
      sideways: number
    }
  }
}
