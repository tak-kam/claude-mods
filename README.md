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

To update to the latest version:

```sh
claude plugin marketplace update claude-mods
claude plugin update file-explorer@claude-mods
```

Then restart Claude Code. Inside a session, `/plugin` → Marketplaces → `claude-mods` → Update does the same.

Updates are picked up by the `version` in each mod's `.claude-plugin/plugin.json`: a change merged without a version bump is not offered as an update. Bump it with every change to a mod.

To try a checkout without installing:

```sh
claude --plugin-dir ./file-explorer
```

> APM (`apm install`) is not supported: it splits Claude plugins into settings-style
> hooks, skills and agents, and does not carry a function hooks module (`hooks/hooks.json`
> with `modules`).

## file-explorer

- `/quote` quotes the mouse selection into the prompt (from the preview, with its file and lines); `/ref` inserts `@file (lines a-b)`. A mouse selection leaves the keyboard with the prompt, so these are the keyboard way; `q`/`r` work once the pane has the keys (`ctrl+x tab`)
- `/files [files|changes|history|search|help]` opens the explorer; `/changes [ref | a..b | a...b]` opens the changes view; `/search [text]` searches file contents
- From 80 columns wide the pane splits: the tree on the left, the open file or diff on the right, each scrolled on its own (the wheel scrolls the column under the pointer). Narrower, the file opens in a pane of its own. `/files` asks the dock for 110 columns; drag it wider or narrower as you like.
- **Follow** (split view, on by default; `follow` in the sidebar header): when Claude reads a file the preview shows it at the lines read; when Claude edits one it shows the diff at the hunk it changed
- **Last prompt** base: each prompt you send snapshots the working tree (through an index of the explorer's own under `.git/`, leaving your index and stash alone), and the Changes base cycles HEAD → last prompt → default branch, so you can review just what the latest turn changed; `/changes turn` selects it
- `#` (`r`) in the preview inserts `@path (lines a-b)`: the lines you selected with the mouse, else the lines in view; `❝` quotes now name the lines too
- Files and folders carry icons by name and extension (📁 📂 📘 📝 🐍 …); folders also get a blue `▸`/`▾` and a trailing `/`
- The help's language is the `language` option in `/config`: `en` (default) or `ja`
- Mermaid blocks in the markdown preview are drawn by your own [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) (`mmdc`) when it is on your `PATH`: a picture in kitty/Ghostty, SVG in the desktop and VS Code apps. The explorer never installs it (`npm i -g @mermaid-js/mermaid-cli` does); without it the block stays code. Drawings are kept in `~/.cache/claude-file-explorer/mermaid`, and the `mermaid` option in `/config` set to `off` never runs `mmdc`
- Icon style is the `icons` option in `/config`: `emoji` (default, any terminal), `nerd` (needs a Nerd Font; coloured like VS Code), or `ascii`
- `i` (`?` in the sidebar) or `/files help` shows every key and command in the preview; `i` again goes back
- Explorer: `f` Files, `c` Changes, `h` History, `s` Search
- Search: **Name** filters file names as you type (fuzzy, like quick open; Enter opens the best match); **Text** runs ripgrep on Enter (`git grep` without it), grouped by file with the hit highlighted, `Aa` for case and `.*` for regex; a hit opens its file at that line
- Markdown files open rendered (`m` Preview, `o` Source): H1 as a full-width band, H2 over a rule, H3 marked, since a terminal has one type size; fenced code in a rounded frame with its language on the top edge; a relative link opens its file in the explorer
- Long lines wrap under the gutter by default; `w` (`↩`) turns wrapping off to cut lines at the edge and scroll sideways with `◀` `▶`
- `y` copies the open file's path; `b` pins it to the top of the Files tab (pins are kept per project across sessions)
- **Outline** (`t`) lists the open file's functions, classes and types (TypeScript, JavaScript, Python, Go, Rust) or its markdown headings; press one to scroll the preview there, and `r` then inserts `@file (lines a-b)` for that symbol
- CSV/TSV open as an aligned table and JSON / JSON Lines as a foldable tree (`m`; `o` for the source). Pick a JSON node to see its path (`a.b[3].c`), which `r` inserts; invalid JSON says where it breaks
- `l` lists the open file's own history in the History tab (renames followed; a commit opens its diff of the file), and `a` shows blame beside the source: who last changed each run of lines and when, the commit id a press away. Blame runs only when asked
- PNG files are drawn in the preview in terminals that show pictures (kitty, Ghostty); elsewhere, and for JPEG/GIF/WebP, the preview names the format and pixel size. SVG opens as source, drawn above it in the desktop and VS Code apps
- A wide tree shows each file's size and age; files git ignores are drawn dim, and `g` (`⊘`) hides or shows them. The preview's status line names the open file's size and age too
- Preview: `o` / `d` file or diff, `j` / `k` scroll, `n` / `p` next or previous change, `q` quotes the mouse selection, `❝ quote` quotes a hunk, `@` inserts `@path`

Opened at start, the pane docks beside the transcript in fullscreen mode at 144 columns or wider; `/files` opens it at any width.

### Tests

`claude plugin test file-explorer` runs the suite (no account needed): unit tests for the pure helpers in `hooks/` and integration tests that drive the explorer through the engine's test kit on every surface. CI runs it on every push and pull request against the pinned Claude Code version, and against the latest one as an early warning.

### Safety

The explorer reads repositories you may not trust, so:

- Nothing from a repository reaches the terminal as written: control characters in file names, commit messages and search hits are shown as `?`, dropped from file contents, and bidi override characters (Trojan Source) are shown as `�`
- Every git call runs with `core.fsmonitor=false`, diffs with `--no-ext-diff --no-textconv`, and the prompt snapshot is skipped when the repository's own config defines a clean filter other than git-lfs, so a planted `.git/config` cannot make the explorer run a program
- Commands run by argument vector, never through a shell; refs starting with `-` are refused
- A symlink that leads out of the project is named, not read; tool paths with `..` are not followed
- Mermaid blocks are only handed to an `mmdc` you installed yourself, on its standard input, under Mermaid's default `strict` security level (no scripts or click handlers in diagrams); its pictures go to your own cache folder, made private, never a shared temp directory. Set `mermaid` to `off` to never run it
- File contents only reach Claude when you press `@`, `❝` or `#`
