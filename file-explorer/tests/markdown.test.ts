import { describe, expect, test } from 'claude-code/testing'
import { cellWidth, fitCells, localLinks, markdownWindow, plainInline, resolveLink, splitMarkdown } from '../hooks/markdown'

describe('splitMarkdown', () => {
  test('splits headings, fenced code and text', () => {
    expect(splitMarkdown('# Title\nintro\n\n```ts\nconst a = 1\n```\n## Next ##\n- item')).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'text', text: 'intro' },
      { kind: 'code', language: 'ts', text: 'const a = 1' },
      { kind: 'heading', level: 2, text: 'Next' },
      { kind: 'text', text: '- item' },
    ])
  })

  test('never reads a heading inside code', () => {
    expect(splitMarkdown('```\n# not a heading\n```')).toEqual([{ kind: 'code', language: '', text: '# not a heading' }])
  })

  test('closes a fence only with the same mark at least as long', () => {
    expect(splitMarkdown('````md\n```\ninner\n```\n````\nafter')).toEqual([
      { kind: 'code', language: 'md', text: '```\ninner\n```' },
      { kind: 'text', text: 'after' },
    ])
    expect(splitMarkdown('~~~\na\n```\n~~~')).toEqual([{ kind: 'code', language: '', text: 'a\n```' }])
  })

  test('runs an unclosed fence to the end', () => {
    expect(splitMarkdown('text\n```sh\nls\n')).toEqual([
      { kind: 'text', text: 'text' },
      { kind: 'code', language: 'sh', text: 'ls\n' },
    ])
  })

  test('needs a space after the hashes and at most three spaces before', () => {
    expect(splitMarkdown('#tag\n    # code')).toEqual([{ kind: 'text', text: '#tag\n    # code' }])
  })
})

describe('plainInline', () => {
  test('reduces inline marks to their text', () => {
    expect(plainInline('A **bold** _it_ `code` [link](x.md) ~~old~~ ![img](a.png)')).toBe('A bold it code link old img')
  })
})

describe('cellWidth and fitCells', () => {
  test('count wide characters and emoji as two cells', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('日本語')).toBe(6)
    expect(cellWidth('📁a')).toBe(3)
    expect(cellWidth('é')).toBe(1)
  })

  test('pad to exactly the cells asked', () => {
    expect(fitCells('日本', 6)).toBe('日本  ')
    expect(cellWidth(fitCells(' 日本語の見出し', 20))).toBe(20)
  })

  test('cut with an ellipsis and never overflow', () => {
    const cut = fitCells('とても長い見出しです', 9)
    expect(cut.includes('…')).toBe(true)
    expect(cellWidth(cut)).toBe(9)
  })
})

describe('localLinks', () => {
  test('keeps relative links and drops schemes and anchors', () => {
    expect(
      localLinks('[a](./a.md) [b](https://x.io) [c](#top) [d](<docs/my file.md>) [e](mailto:x@y) [f](../up.md "title")'),
    ).toEqual(['./a.md', '../up.md'])
  })

  test('lists each link once', () => {
    expect(localLinks('[a](x.md) [b](x.md)')).toEqual(['x.md'])
  })
})

describe('resolveLink', () => {
  test('resolves from the file folder, or from the root with /', () => {
    expect(resolveLink('docs/guide/intro.md', './setup.md')).toBe('docs/guide/setup.md')
    expect(resolveLink('docs/guide/intro.md', '../api.md#top')).toBe('docs/api.md')
    expect(resolveLink('docs/intro.md', '/src/main.ts')).toBe('src/main.ts')
    expect(resolveLink('README.md', 'my%20file.md')).toBe('my file.md')
  })

  test('refuses to climb above the root', () => {
    expect(resolveLink('README.md', '../secret')).toBeUndefined()
    expect(resolveLink('docs/a.md', '../../../../etc/passwd')).toBeUndefined()
  })

  test('refuses an empty target', () => {
    expect(resolveLink('a.md', '#only-anchor')).toBeUndefined()
  })

  test('survives a malformed escape', () => {
    expect(resolveLink('a.md', 'bad%E0%A4%A.md')).toBe('bad%E0%A4%A.md')
  })
})

describe('markdownWindow', () => {
  const lines = ['# T', '', '```ts', 'a', 'b', 'c', 'd', '```', '', 'end']

  test('reopens a fence a window starts inside, and closes one it ends inside', () => {
    expect(markdownWindow(lines, 4, 4, 80)).toEqual({ text: '```ts\nb\nc\n```', start: 4, end: 6 })
  })

  test('counts a heading as two rows', () => {
    expect(markdownWindow(lines, 0, 4, 80)).toEqual({ text: '# T\n', start: 0, end: 2 })
  })

  test('always moves at least one line', () => {
    const long = ['x'.repeat(500)]
    expect(markdownWindow(long, 0, 1, 10).end).toBe(1)
  })

  test('clamps a start past the end', () => {
    expect(markdownWindow(lines, 99, 50, 80).start).toBe(lines.length - 1)
  })
})
