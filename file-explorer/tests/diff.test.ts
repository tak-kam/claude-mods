import { describe, expect, test } from 'claude-code/testing'
import { clipDiff, hunkOffset, letterOf, parseLog, parseNameStatus, sliceHunk, splitHunks } from '../hooks/diff'

describe('letterOf', () => {
  test('maps git status codes to the letters drawn', () => {
    expect(letterOf('M')).toBe('M')
    expect(letterOf('A')).toBe('A')
    expect(letterOf('D')).toBe('D')
    expect(letterOf('R100')).toBe('R')
    expect(letterOf('C075')).toBe('C')
    expect(letterOf('T')).toBe('M')
    expect(letterOf('U')).toBe('!')
    expect(letterOf('')).toBe('?')
  })
})

describe('parseNameStatus', () => {
  test('reads one path per status, two for renames and copies', () => {
    expect(parseNameStatus('M\0a.ts\0R087\0old.ts\0new.ts\0D\0gone.md\0C100\0src.ts\0copy.ts\0')).toEqual([
      { path: 'a.ts', letter: 'M' },
      { path: 'new.ts', letter: 'R', from: 'old.ts' },
      { path: 'gone.md', letter: 'D' },
      { path: 'copy.ts', letter: 'C', from: 'src.ts' },
    ])
  })

  test('keeps paths with spaces, colons and newlines whole', () => {
    expect(parseNameStatus('M\0dir with space/a:b.ts\0A\0line\nbreak.txt\0')).toEqual([
      { path: 'dir with space/a:b.ts', letter: 'M' },
      { path: 'line\nbreak.txt', letter: 'A' },
    ])
  })

  test('reads nothing from nothing', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('parseLog', () => {
  test('splits records and fields', () => {
    const raw = 'aaa\x1fa1\x1fFirst\x1fAlice\x1f2 days ago\x1e\nbbb\x1fb2\x1fSecond: with colon\x1fBob\x1fnow\x1e\n'
    expect(parseLog(raw)).toEqual([
      { sha: 'aaa', short: 'a1', subject: 'First', author: 'Alice', when: '2 days ago' },
      { sha: 'bbb', short: 'b2', subject: 'Second: with colon', author: 'Bob', when: 'now' },
    ])
  })

  test('shows control characters in commit text as ?', () => {
    const [commit] = parseLog('aaa\x1fa1\x1fhi\u001b]0;x\u0007\x1fEve\u009b\x1fnow\x1e')
    expect(commit?.subject).toBe('hi?]0;x?')
    expect(commit?.author).toBe('Eve?')
  })

  test('drops records missing fields', () => {
    expect(parseLog('aaa\x1fa1\x1e')).toEqual([])
  })
})

const HUNKS = [
  '@@ -1,3 +1,3 @@ first',
  ' a',
  '-b',
  '+B',
  ' c',
  '@@ -20,2 +20,3 @@ second',
  ' x',
  '+y',
  ' z',
  '',
].join('\n')

describe('splitHunks', () => {
  test('splits at each @@ and names the new-side lines', () => {
    const hunks = splitHunks(HUNKS)
    expect(hunks.map(hunk => hunk.lines)).toEqual(['lines 1-3', 'lines 20-22'])
    expect(hunks[1]?.body).toBe('@@ -20,2 +20,3 @@ second\n x\n+y\n z\n')
  })

  test('names a one-line hunk as a line', () => {
    expect(splitHunks('@@ -5 +5 @@\n-a\n+b\n')[0]?.lines).toBe('line 5')
  })

  test('ignores text before the first hunk', () => {
    expect(splitHunks('diff --git a b\n@@ -1 +1 @@\n-a\n+b\n')).toHaveLength(1)
  })
})

describe('sliceHunk', () => {
  const hunk = '@@ -10,4 +10,5 @@ fn\n a\n-b\n+B\n+C\n c\n d\n'

  test('recounts the header for a slice from the middle', () => {
    expect(sliceHunk(hunk, 2, 3)).toBe('@@ -12,1 +11,3 @@ fn\n+B\n+C\n c\n')
  })

  test('keeps the start for a slice from the top', () => {
    expect(sliceHunk(hunk, 0, 2)).toBe('@@ -10,2 +10,1 @@ fn\n a\n-b\n')
  })

  test('takes no more than there is', () => {
    expect(sliceHunk(hunk, 4, 99)).toBe('@@ -12,2 +13,2 @@ fn\n c\n d\n')
  })

  test('leaves a body without a header as it is', () => {
    expect(sliceHunk('no header\n', 0, 1)).toBe('no header\n')
  })
})

describe('clipDiff', () => {
  test('leaves a diff that fits alone', () => {
    expect(clipDiff(HUNKS, 10000)).toEqual({ text: HUNKS, isCut: false })
  })

  test('keeps whole hunks while they fit', () => {
    const { text, isCut } = clipDiff(HUNKS, 60)
    expect(isCut).toBe(true)
    expect(text).toBe('@@ -1,3 +1,3 @@ first\n a\n-b\n+B\n c\n')
  })

  test('cuts a first hunk too long alone and recounts it', () => {
    const big = `@@ -1,300 +1,300 @@\n${Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? '+x' : ' y')).join('\n')}\n`
    const { text, isCut } = clipDiff(big, 500)
    expect(isCut).toBe(true)
    expect(text.length).toBeLessThanOrEqual(500)
    const lines = text.trimEnd().split('\n')
    const added = lines.filter(line => line.startsWith('+')).length
    const context = lines.filter(line => line.startsWith(' ')).length
    expect(lines[0]).toBe(`@@ -1,${context} +1,${added + context} @@`)
  })
})

describe('hunkOffset', () => {
  test('counts the rows before the hunk holding a new-side line', () => {
    expect(hunkOffset(HUNKS, 2)).toBe(0)
    expect(hunkOffset(HUNKS, 21)).toBe(5)
  })

  test('falls back to the top for a line in no hunk', () => {
    expect(hunkOffset(HUNKS, 999)).toBe(0)
    expect(hunkOffset('', 3)).toBe(0)
  })
})
