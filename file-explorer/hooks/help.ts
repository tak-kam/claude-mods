// The explorer's keys and commands, shown in the preview by `i`, in the
// language the `language` option picks.
export type HelpLanguage = 'en' | 'ja'

export const HELP = `# Keys and commands

Keys work while the explorer has the keyboard: click it, or press \`ctrl+x tab\`. Esc gives the keys back to the prompt.

## Explorer (left)

| Key | Does |
| --- | --- |
| \`f\` \`c\` \`h\` \`s\` \`t\` | Files, Changes, History, Search, Outline tab |
| \`▲\` \`▼\` | Scroll the list (the wheel too) |
| \`↻\` | Refresh |
| \`⊟\` | Collapse every folder |
| \`@\` | Insert \`@file\` for the selected file |
| \`follow\` | Show what Claude reads and edits as it happens |
| \`g\` | Hide what .gitignore leaves out, or show it dimmed |
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
| \`r\` | Insert \`@file (lines a-b)\`: the selection, else the outline symbol jumped to, else the lines in view |
| \`y\` | Copy the file's path |
| \`b\` | Pin or unpin the file (pins list at the top of Files, kept per project) |
| \`❝ quote\` | Quote one diff hunk (click) |

## Search

**Name** filters file names as you type; Enter opens the best match. **Text** runs ripgrep on Enter: \`Aa\` matches case, \`.*\` takes a regex, and a line number opens the file there.

## Outline

The open file's functions, classes and types (TypeScript, JavaScript, Python, Go, Rust) or its markdown headings. Press one to scroll the preview to it; \`r\` then names that symbol's lines.

## Commands

| Command | Does |
| --- | --- |
| \`/files [files\\|changes\\|history\\|search\\|outline\\|help]\` | Open the explorer |
| \`/changes [ref \\| a..b \\| a...b \\| turn]\` | Changes against a base |
| \`/search text\` | Search file contents |
| \`/quote\` | Quote the mouse selection |
| \`/ref\` | Insert \`@file (lines a-b)\` |

## With the mouse

Selecting text leaves the keyboard with the prompt, so \`q\` and \`r\` type into it there: use \`/quote\` and \`/ref\`, or press \`ctrl+x tab\` first. Links in a markdown preview open their file.
`

export const HELP_JA = `# キーとコマンド

キーはエクスプローラーがキーボードを受け取っている間に効きます。クリックするか \`ctrl+x tab\` で移ります。Esc でプロンプトに戻ります。

## エクスプローラー（左）

| キー | 動作 |
| --- | --- |
| \`f\` \`c\` \`h\` \`s\` \`t\` | Files、Changes、History、Search、Outline タブ |
| \`▲\` \`▼\` | 一覧のスクロール（ホイールでも可） |
| \`↻\` | 再読み込み |
| \`⊟\` | フォルダをすべて閉じる |
| \`@\` | 選択中のファイルの \`@file\` を入力欄に入れる |
| \`follow\` | Claude が読んだり編集したりしたファイルを追いかけて表示 |
| \`g\` | .gitignore で除外されたものを隠す・薄く表示する |
| \`i\` | このヘルプを開く・閉じる |

**Changes** では、比較の基準（\`vs HEAD\`）を押すと HEAD、直前の指示、既定ブランチの順に切り替わります。その下の欄に ref や \`a..b\` を入力することもできます。

## プレビュー（右）

| キー | 動作 |
| --- | --- |
| \`j\` \`k\` | 下・上にスクロール（ホイールでも可） |
| \`n\` \`p\` | 次・前の変更ファイル |
| \`o\` \`d\` \`m\` | ソース、diff、Markdown プレビュー |
| \`w\` | 長い行を折り返す・画面端で切る |
| \`◀\` \`▶\` | 横スクロール（折り返しオフのとき、クリック） |
| \`q\` | マウスで選択した範囲をプロンプトに引用 |
| \`r\` | \`@file (lines a-b)\` を入れる（選択範囲、なければアウトラインで飛んだシンボル、なければ表示中の行） |
| \`y\` | ファイルのパスをコピー |
| \`b\` | ファイルをピン留め・解除（Files の一番上に並び、プロジェクトごとに保存） |
| \`❝ quote\` | diff のまとまりを 1 つ引用（クリック） |

## 検索

**Name** は入力に合わせてファイル名を絞り込み、Enter で一番近いものを開きます。**Text** は Enter で ripgrep を実行します。\`Aa\` で大文字小文字を区別、\`.*\` で正規表現、行番号を押すとその行で開きます。

## アウトライン

開いているファイルの関数・クラス・型（TypeScript、JavaScript、Python、Go、Rust）や Markdown の見出しの一覧です。押すとプレビューがそこまでスクロールし、続けて \`r\` を押すとそのシンボルの行範囲を入れます。

## コマンド

| コマンド | 動作 |
| --- | --- |
| \`/files [files\\|changes\\|history\\|search\\|outline\\|help]\` | エクスプローラーを開く |
| \`/changes [ref \\| a..b \\| a...b \\| turn]\` | 基準と比べた変更を表示 |
| \`/search 文字列\` | ファイルの中身を検索 |
| \`/quote\` | マウスで選択した範囲を引用 |
| \`/ref\` | \`@file (lines a-b)\` を入れる |

## マウス操作

テキストを選択しても、キーボードはプロンプトのままです。そのため \`q\` や \`r\` はプロンプトに入力されます。\`/quote\` と \`/ref\` を使うか、先に \`ctrl+x tab\` を押してください。Markdown プレビュー内のリンクを押すと、そのファイルが開きます。
`

export function helpText(language: HelpLanguage): string {
  return language === 'ja' ? HELP_JA : HELP
}
