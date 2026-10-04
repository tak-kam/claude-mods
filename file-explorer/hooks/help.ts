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
| \`o\` \`d\` \`m\` | Source, diff, and the readable view: markdown preview, CSV/TSV table, JSON tree |
| \`w\` | Wrap long lines, or cut them at the edge |
| \`◀\` \`▶\` | Scroll sideways, with wrapping off (click) |
| \`q\` | Quote the mouse selection into the prompt |
| \`r\` | Insert \`@file (lines a-b)\`: the selection, else the outline symbol jumped to or the JSON node picked, else the lines in view |
| \`y\` | Copy the file's path |
| \`b\` | Pin or unpin the file (pins list at the top of Files, kept per project) |
| \`l\` | The file's history in the History tab (renames followed); a commit opens its diff of the file |
| \`a\` | Blame: who last changed each line, and when, beside the source; a commit id opens it |
| \`❝ quote\` | Quote one diff hunk (click) |

## Search

**Name** filters file names as you type; Enter opens the best match. **Text** runs ripgrep on Enter: \`Aa\` matches case, \`.*\` takes a regex, and a line number opens the file there.

## Outline

The open file's functions, classes and types (TypeScript, JavaScript, Python, Go, Rust) or its markdown headings. Press one to scroll the preview to it; \`r\` then names that symbol's lines.

## Data files

CSV and TSV open as a table (\`◀\` \`▶\` scroll wide ones sideways); JSON and JSON Lines as a tree. Press a key in the tree to fold or unfold it and pick it: its path (\`a.b[3].c\`) shows above the tree, and \`r\` inserts \`@file (a.b[3].c)\`. Invalid JSON says where it breaks.

## Pictures

PNG files are drawn in the preview where the terminal can show pictures (kitty, Ghostty). JPEG, GIF and WebP are drawn there too when a converter you have turns them into PNG (macOS's \`sips\`, \`ffmpeg\` or ImageMagick), and SVG above its source with \`rsvg-convert\`; none is ever installed for you. Without one, the preview names the format and size. The desktop and VS Code apps draw SVG themselves. The \`pictures\` option in \`/config\` turns conversion off; \`↻\` looks for converters again.

## Diagrams

\`\`\`mermaid blocks in the markdown preview are drawn by your own mermaid-cli (\`mmdc\`) when it is installed (\`npm i -g @mermaid-js/mermaid-cli\`); the explorer never installs it. \`o\` shows the source; \`↻\` looks for a newly installed \`mmdc\` and retries failed diagrams. The \`mermaid\` option in \`/config\` turns it off.

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
| \`o\` \`d\` \`m\` | ソース、diff、読みやすい表示（Markdown プレビュー、CSV/TSV の表、JSON のツリー） |
| \`w\` | 長い行を折り返す・画面端で切る |
| \`◀\` \`▶\` | 横スクロール（折り返しオフのとき、クリック） |
| \`q\` | マウスで選択した範囲をプロンプトに引用 |
| \`r\` | \`@file (lines a-b)\` を入れる（選択範囲、なければアウトラインで飛んだシンボルか選んだ JSON の要素、なければ表示中の行） |
| \`y\` | ファイルのパスをコピー |
| \`b\` | ファイルをピン留め・解除（Files の一番上に並び、プロジェクトごとに保存） |
| \`l\` | このファイルの履歴を History タブに出す（名前の変更も追う）。コミットを押すとそのファイルの差分を開く |
| \`a\` | Blame：各行を最後に変えた人と時期をソースの横に出す。コミット ID を押すとそのコミットを開く |
| \`❝ quote\` | diff のまとまりを 1 つ引用（クリック） |

## 検索

**Name** は入力に合わせてファイル名を絞り込み、Enter で一番近いものを開きます。**Text** は Enter で ripgrep を実行します。\`Aa\` で大文字小文字を区別、\`.*\` で正規表現、行番号を押すとその行で開きます。

## アウトライン

開いているファイルの関数・クラス・型（TypeScript、JavaScript、Python、Go、Rust）や Markdown の見出しの一覧です。押すとプレビューがそこまでスクロールし、続けて \`r\` を押すとそのシンボルの行範囲を入れます。

## データファイル

CSV と TSV は表で開きます（幅が広いときは \`◀\` \`▶\` で横スクロール）。JSON と JSON Lines はツリーで開きます。ツリーのキーを押すと折りたたみ・展開してその要素を選び、パス（\`a.b[3].c\`）がツリーの上に出ます。続けて \`r\` で \`@file (a.b[3].c)\` を入れます。壊れた JSON はどこで壊れているかを表示します。

## 画像

PNG は画像を表示できるターミナル（kitty、Ghostty）ならプレビューに描画します。JPEG・GIF・WebP も、手元の変換ツール（macOS の \`sips\`、\`ffmpeg\`、ImageMagick）で PNG にして描画します。SVG は \`rsvg-convert\` があればソースの上に描画します。ツールを自動でインストールすることはなく、無ければ形式とサイズを表示します。デスクトップと VS Code は SVG をそのまま描画します。\`/config\` の \`pictures\` で変換をオフにでき、\`↻\` で変換ツールを探し直します。

## 図（Mermaid）

Markdown プレビューの \`\`\`mermaid ブロックは、mermaid-cli（\`mmdc\`）がインストールされていれば図として描きます（\`npm i -g @mermaid-js/mermaid-cli\`）。エクスプローラーが自動でインストールすることはありません。\`o\` でソース表示、\`↻\` で新しく入れた \`mmdc\` を探し直し、失敗した図を描き直します。\`/config\` の \`mermaid\` オプションでオフにできます。

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
