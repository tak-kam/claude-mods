// The explorer's keys and commands, shown in the preview by `i`.
export const HELP = `# Keys and commands

Keys work while the explorer has the keyboard: click it, or press \`ctrl+x tab\`. Esc gives the keys back to the prompt.

## Explorer (left)

| Key | Does |
| --- | --- |
| \`f\` \`c\` \`h\` \`s\` | Files, Changes, History, Search tab |
| \`▲\` \`▼\` | Scroll the list (the wheel too) |
| \`↻\` | Refresh |
| \`⊟\` | Collapse every folder |
| \`@\` | Insert \`@file\` for the selected file |
| \`follow\` | Show what Claude reads and edits as it happens |
| \`i\` | Open or close this help |

In **Changes**, press the base (\`vs HEAD\`) to cycle HEAD, the last prompt and the default branch, or type a ref or \`a..b\` in the field below it.

## Preview (right)

| Key | Does |
| --- | --- |
| \`j\` \`k\` | Scroll down, up (the wheel too) |
| \`n\` \`p\` | Next, previous changed file |
| \`o\` \`d\` \`m\` | Source, diff, markdown preview |
| \`w\` | Wrap long lines, or cut them at the edge |
| \`◀\` \`▶\` | Scroll sideways, with wrapping off (click) |
| \`q\` | Quote the mouse selection into the prompt |
| \`r\` | Insert \`@file (lines a-b)\`: the selection, else the lines in view |
| \`❝ quote\` | Quote one diff hunk (click) |

## Search

**Name** filters file names as you type; Enter opens the best match. **Text** runs ripgrep on Enter: \`Aa\` matches case, \`.*\` takes a regex, and a line number opens the file there.

## Commands

| Command | Does |
| --- | --- |
| \`/files [files\\|changes\\|history\\|search\\|help]\` | Open the explorer |
| \`/changes [ref \\| a..b \\| a...b \\| turn]\` | Changes against a base |
| \`/search text\` | Search file contents |
| \`/quote\` | Quote the mouse selection |
| \`/ref\` | Insert \`@file (lines a-b)\` |

## With the mouse

Selecting text leaves the keyboard with the prompt, so \`q\` and \`r\` type into it there: use \`/quote\` and \`/ref\`, or press \`ctrl+x tab\` first. Links in a markdown preview open their file.
`
