export type ExplorerEntry = { name: string; isDir: boolean; size: number }

export type ExplorerView = 'files' | 'changes'

export type ExplorerChange = {
  path: string
  letter: string
  from?: string
}

export type ExplorerBase = {
  ref: string
  label: string
}

export type ExplorerPreview = {
  path: string
  mode: 'file' | 'diff'
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
      gitError: string
      touched: string[]
      selected: string
      preview: ExplorerPreview | null
    }
  }
}
