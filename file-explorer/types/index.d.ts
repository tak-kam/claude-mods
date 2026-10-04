export type ExplorerEntry = { name: string; isDir: boolean; size: number; mtimeMs?: number }

export type ExplorerView = 'files' | 'changes' | 'history' | 'search' | 'outline'

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

// `rendered` draws a markdown file as markdown; `data` a CSV/TSV file as a
// table and a JSON file as a tree.
export type ExplorerMode = 'file' | 'diff' | 'rendered' | 'data'

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
  // The file's size and modification time, when it is on disk.
  size?: number
  mtimeMs?: number
  // A picture: its format and size in pixels (0 when the header did not
  // say), and the real path inside the project the terminal reads it from.
  image?: { format: 'png' | 'jpeg' | 'gif' | 'webp'; width: number; height: number; file: string }
}

export type ExplorerDiagram = {
  status: 'drawing' | 'ok' | 'error'
  png?: string
  width?: number
  height?: number
  svg?: string
  error?: string
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
      // The History tab narrowed to one file ('' for every commit), and
      // that file's commits with the path it had in each.
      historyOf: string
      fileHistory: (ExplorerCommit & { path: string })[]
      // `git blame` of the shown file, asked for by the toolbar: a sha per
      // line, and each commit's details once.
      blame: { path: string; shas: string[]; commits: Record<string, { short: string; author: string; time: number; summary: string }> } | null
      gitError: string
      touched: string[]
      selected: string
      preview: ExplorerPreview | null
      listOffset: number
      follow: boolean
      lastPrompt: ExplorerBase | null
      search: ExplorerSearch
      pins: string[]
      // The outline entry last jumped to: `r` names its lines while it is in view.
      symbol: { path: string; start: number; end: number } | null
      // The JSON tree of `path`: the containers folded or unfolded against
      // the default, and the node last picked (`a.b[3].c`), which `r` names.
      // Mermaid blocks drawn by the person's mmdc, by diagramKey; whether
      // mmdc answered at all.
      diagrams: Record<string, ExplorerDiagram>
      mermaidTool: 'unknown' | 'yes' | 'no'
      dataView: { path: string; toggled: string[]; pick: string }
      ignored: string[]
      hideIgnored: boolean
      previewOffset: number
      wrapLines: boolean
      sideways: number
    }
  }
}
