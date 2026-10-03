# claude-mods

Claude Code mods: plugins of function hooks that add panes and commands to Claude Code.

| Mod | What it does |
| --- | --- |
| [file-explorer](./file-explorer) | VS Code-style explorer pane: file tree with git decorations, changes against any ref or range, commit history, diffs per hunk, and quoting into the prompt |

## Install

This repository is a Claude Code plugin marketplace.

```sh
claude plugin marketplace add tak-kam/claude-mods
claude plugin install file-explorer@claude-mods
```

Or inside a session: `/plugin marketplace add tak-kam/claude-mods`, then `/plugin install file-explorer@claude-mods`.

To try a checkout without installing:

```sh
claude --plugin-dir ./file-explorer
```

> APM (`apm install`) is not supported: it splits Claude plugins into settings-style
> hooks, skills and agents, and does not carry a function hooks module (`hooks/hooks.json`
> with `modules`).

## file-explorer

- `/files [files|changes|history]` opens the explorer; `/changes [ref | a..b | a...b]` opens the changes view
- From 80 columns wide the pane splits: the tree on the left, the open file or diff on the right, each scrolled on its own (the wheel scrolls the column under the pointer). Narrower, the file opens in a pane of its own. `/files` asks the dock for 110 columns; drag it wider or narrower as you like.
- Folders are drawn with a blue `▸`/`▾` and a trailing `/`, files with a dim `·`
- Explorer: `f` Files, `c` Changes, `h` History
- Preview: `o` / `d` file or diff, `j` / `k` scroll, `n` / `p` next or previous change, `q` quotes the mouse selection, `❝ quote` quotes a hunk, `@` inserts `@path`

Opened at start, the pane docks beside the transcript in fullscreen mode at 144 columns or wider; `/files` opens it at any width.
