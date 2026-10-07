# claude-mods

Claude Code mods: plugins of function hooks that add panes and commands to Claude Code.

| Mod | What it does |
| --- | --- |
| [file-explorer](./file-explorer) | VS Code-style explorer pane: file tree with git decorations, changes against any ref or range, commit history, diffs per hunk, and quoting into the prompt |
| [herdr-bridge](./herdr-bridge) | For Claude Code run inside [herdr](https://github.com/herdrdev/herdr): tells herdr the prompt, the question or permission Claude waits on, and how each turn ended |

## Install

This repository is a Claude Code plugin marketplace.

```sh
claude plugin marketplace add tak-kam/claude-mods
claude plugin install file-explorer@claude-mods
claude plugin install herdr-bridge@claude-mods   # if you use herdr
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

## herdr-bridge

For Claude Code running inside [herdr](https://github.com/herdrdev/herdr), the terminal agent multiplexer. herdr's own Claude integration (`herdr integration install claude`) reports the session, and herdr reads the screen to tell working from blocked; this mod sees Claude's events themselves and tells herdr what they are:

| Claude Code | herdr's sidebar |
| --- | --- |
| a prompt is sent | title: the prompt's first line; label: working |
| `AskUserQuestion` | blocked: `Q: Which approach?` |
| a permission prompt | blocked: `Permission: Bash npm test` |
| a turn ends | idle: done / interrupted / error, and `$summary`: `4 tools · 2m 10s` |
| the session ends | the above cleared |

- It does nothing outside herdr (it needs `HERDR_ENV=1`, `HERDR_PANE_ID` and `HERDR_BIN_PATH`, which herdr sets in its panes)
- By default it changes only what herdr shows (`herdr pane report-metadata`, as agent `claude`, source `claude-mods:herdr-bridge`), so herdr's own integration keeps the state and session resume. Set the `mode` option in `/config` to `state` to also report working / blocked / idle from the exact events (`herdr pane report-agent`), so herdr's waits and notifications follow them; the source is released when the session ends
- Set the `text` option to `labels` to send no words from the session: "waiting on a question" instead of the question, no prompt as the title
- Reports go after Claude's own work, with a 3 second timeout, failures ignored, and numbered (`--seq`) so a late one never overwrites a newer one; slash commands leave the pane as it is
- Show the summary in herdr's sidebar with `$summary` in its agent row format (see herdr's configuration reference)

## file-explorer

- `/quote` quotes the mouse selection into the prompt (from the preview, with its file and lines); `/ref` inserts `@file (lines a-b)`. A mouse selection leaves the keyboard with the prompt, so these are the keyboard way; `q`/`r` work once the pane has the keys (`ctrl+x tab`)
- `/files [files|changes|history|search|help]` opens the explorer; `/changes [ref | a..b | a...b | turn | pr [number] [base]]` opens the changes view; `/search [text]` searches file contents
- From 80 columns wide the pane splits: the tree on the left, the open file or diff on the right, each scrolled on its own (the wheel scrolls the column under the pointer). Narrower, the file opens in a pane of its own. `/files` asks the dock for 110 columns; drag it wider or narrower as you like.
- **Follow** (split view, on by default; `follow` in the sidebar header): when Claude reads a file the preview shows it at the lines read; when Claude edits one it shows the diff at the hunk it changed
- **Last prompt** base: each prompt you send snapshots the working tree (through an index of the explorer's own under `.git/`, leaving your index and stash alone), and the Changes base cycles HEAD → last prompt → this branch's pull request → default branch, so you can review just what the latest turn changed; `/changes turn` selects it
- **Pull requests**: the base cycle includes this branch's pull request, shown as GitHub shows it (from where the branch left the PR's base, uncommitted work included) and named `#41 title`; `/changes pr` selects it. `/changes pr 123` (or `#123`) fetches pull request 123 and its base branch from `origin` (GitHub's `pull/123/head`, into `refs/file-explorer/…`, never your branches) and shows its changes from today's fork point. A pull request's base and title come from [`gh`](https://cli.github.com), else GitHub's public REST API (a github.com `origin`, public repositories); name the base yourself after the command when neither knows it: `/changes pr 123 develop`, `/changes pr develop`. These are the only network requests the explorer makes, and only when you ask or press the base
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
- PNG files are drawn in the preview in terminals that show pictures (kitty, Ghostty). JPEG/GIF/WebP are converted to PNG and drawn too when you have a converter (macOS's built-in `sips`, `ffmpeg`, or ImageMagick, in that order), and SVG is drawn above its source with `rsvg-convert`; the explorer never installs one, and without one the preview names the format and pixel size. SVG is drawn as-is in the desktop and VS Code apps. The `pictures` option in `/config` set to `off` never runs a converter
- A wide tree shows each file's size and age; files git ignores are drawn dim, and `g` (`⊘`) hides or shows them. The preview's status line names the open file's size and age too
- Preview: `o` / `d` file or diff, `j` / `k` scroll, `n` / `p` next or previous change, `q` quotes the mouse selection, `❝ quote` quotes a hunk, `@` inserts `@path`

Opened at start, the pane docks beside the transcript in fullscreen mode at 144 columns or wider; `/files` opens it at any width.

### Optional tools

The explorer needs nothing beyond Claude Code. Each tool below, when it is on your `PATH`, turns on more; without it that part falls back and the rest works as before. The explorer never installs any of them.

| Feature | Uses | Without it |
| --- | --- | --- |
| Changes, History, blame, ignored files, last-prompt diffs | `git` | Files, preview and search still work; the git views say "Not a git repository" |
| Pull request base branches and titles | `gh` (GitHub CLI, logged in) | GitHub's public API answers for public github.com repositories; otherwise name the base (`/changes pr 123 develop`) or the default branch is used |
| Search (file names and text) | `rg` (ripgrep) | `git ls-files` and `git grep` (in a git repository) |
| PNG pictures | a terminal that shows pictures (kitty, Ghostty) | the picture's alt text |
| JPEG, GIF, WebP | `sips` (built into macOS), else `ffmpeg`, else ImageMagick | the format and pixel size |
| SVG in the terminal | `rsvg-convert` (librsvg) | the source (the desktop and VS Code apps draw SVG themselves) |
| Mermaid diagrams | `mmdc` ([mermaid-cli](https://github.com/mermaid-js/mermaid-cli); brings Node.js packages and a headless Chromium) | the block as code |

**macOS** (`sips` is already there for JPEG, GIF and WebP):

```sh
brew install ripgrep librsvg
npm i -g @mermaid-js/mermaid-cli
```

**Linux**, by distribution (`ffmpeg` for JPEG, GIF and WebP; `rsvg-convert` for SVG):

```sh
# Debian, Ubuntu
sudo apt install ripgrep ffmpeg librsvg2-bin
# Fedora (ffmpeg-free from Fedora itself, or ffmpeg from RPM Fusion)
sudo dnf install ripgrep ffmpeg-free librsvg2-tools
# Arch
sudo pacman -S ripgrep ffmpeg librsvg
# openSUSE
sudo zypper install ripgrep ffmpeg rsvg-convert

# Mermaid, on any of them (needs Node.js)
npm i -g @mermaid-js/mermaid-cli
```

On Linux, the Chromium that mermaid-cli downloads needs the usual desktop libraries (NSS, ATK, GBM and so on); a desktop install has them, a minimal server or container may not, and then `mmdc` fails and the diagram stays code with its error shown. kitty and Ghostty both run on Linux; in other terminals pictures show as their alt text.

The `pictures` and `mermaid` options in `/config` set to `off` never run a converter or `mmdc`, installed or not.

### Tests

`claude plugin test file-explorer` runs the suite (no account needed): unit tests for the pure helpers in `hooks/` and integration tests that drive the explorer through the engine's test kit on every surface. CI runs it on every push and pull request against the pinned Claude Code version, and against the latest one as an early warning.

### Safety

The explorer reads repositories you may not trust, so:

- Nothing from a repository reaches the terminal as written: control characters in file names, commit messages and search hits are shown as `?`, dropped from file contents, and bidi override characters (Trojan Source) are shown as `�`
- Every git call runs with `core.fsmonitor=false`, diffs with `--no-ext-diff --no-textconv`, and the prompt snapshot is skipped when the repository's own config defines a clean filter other than git-lfs, so a planted `.git/config` cannot make the explorer run a program
- Commands run by argument vector, never through a shell; refs starting with `-` are refused
- Network access is only for pull requests, and only when you ask: `/changes pr N` runs `git fetch` with the `ext` and `file` transports refused, no prompts (`GIT_TERMINAL_PROMPT=0`), a minute's timeout, into refs of the explorer's own; `gh` runs with prompts off; without `gh`, GitHub's public API is read for a github.com `origin` (no token is sent). Base branch names from either are checked before git sees them
- A symlink that leads out of the project is named, not read; tool paths with `..` are not followed
- Mermaid blocks are only handed to an `mmdc` you installed yourself, on its standard input, under Mermaid's default `strict` security level (no scripts or click handlers in diagrams); its pictures go to your own cache folder, made private, never a shared temp directory. Set `mermaid` to `off` to never run it
- Pictures from the repository are only converted by a tool you installed, by argument vector with absolute paths (`file:` for ffmpeg, the coder named outright and resources capped for ImageMagick, which is used last and never for SVG); SVG goes only to `rsvg-convert`, which does not fetch over the network. Output goes to your private cache folder, never a shared temp directory
- File contents only reach Claude when you press `@`, `❝` or `#`
