export type ExplorerEntry = { name: string; isDir: boolean; size: number }

export type ExplorerPreview = {
  path: string
  text: string
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'file-explorer': {
      root: string
      expanded: string[]
      listings: Record<string, ExplorerEntry[]>
      git: Record<string, string>
      touched: string[]
      selected: string
      preview: ExplorerPreview | null
    }
  }
}
