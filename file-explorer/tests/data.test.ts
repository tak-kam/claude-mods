import { describe, expect, test } from 'claude-code/testing'
import { childPath, isDelimited, isJson, jsonRows, parseDelimited, parseJson, parseJsonLines, tableLines } from '../hooks/data'

describe('parseDelimited', () => {
  test('quoted fields keep commas, doubled quotes and newlines; records keep their lines', () => {
    const text = 'name,note\r\n"Smith, J","said ""hi"""\n"multi\nline",x\n\nlast,1'
    const { records, isCut } = parseDelimited(text, ',', 100)
    expect(isCut).toBe(false)
    expect(records).toEqual([
      { line: 1, cells: ['name', 'note'] },
      { line: 2, cells: ['Smith, J', 'said "hi"'] },
      { line: 3, cells: ['multi\nline', 'x'] },
      { line: 6, cells: ['last', '1'] },
    ])
  })

  test('tabs, ragged rows, a BOM and a limit', () => {
    const { records, isCut } = parseDelimited('﻿a\tb\tc\n1\n2\t3\n', '\t', 2)
    expect(records.map(one => one.cells)).toEqual([['a', 'b', 'c'], ['1']])
    expect(isCut).toBe(true)
  })

  test('a stray quote inside a bare field is text', () => {
    expect(parseDelimited('5" disk,ok', ',', 10).records[0]?.cells).toEqual(['5" disk', 'ok'])
  })
})

describe('tableLines', () => {
  test('aligns columns in cells, pads ragged rows, caps width and cleans text', () => {
    const lines = tableLines(
      [
        { line: 1, cells: ['id', 'name'] },
        { line: 2, cells: ['1', '日本語'] },
        { line: 3, cells: ['22'] },
        { line: 4, cells: ['3', 'a\u001b[2Jvery long value here'] },
      ],
      8,
    )
    expect(lines.map(one => one.text)).toEqual([
      'id │ name',
      '───┼─────────',
      '1  │ 日本語',
      '22 │',
      '3  │ a?[2Jve…',
    ])
    expect(lines[0]?.isHeader).toBe(true)
    expect(lines[1]?.isRule).toBe(true)
    expect(lines.map(one => one.line)).toEqual([1, 1, 2, 3, 4])
  })
})

describe('parseJson', () => {
  test('values with the lines they start on', () => {
    const parsed = parseJson('{\n  "a": [1, true, null],\n  "b": {"c": "x\\ny"}\n}')
    expect('root' in parsed).toBe(true)
    if (!('root' in parsed)) return
    expect(jsonRows(parsed.root, new Set(), 9, 100).map(row => `${row.line} ${'  '.repeat(row.depth)}${row.path} ${row.text}`)).toEqual([
      '2 a [3]',
      '2   a[0] 1',
      '2   a[1] true',
      '2   a[2] null',
      '3 b {1}',
      '3   b.c "x\\ny"',
    ])
  })

  test('says what is wrong and where', () => {
    expect(parseJson('{\n  "a": 1,\n  "b" 2\n}')).toEqual({ error: "expected ':'", line: 3, column: 7 })
    expect(parseJson('[1, 2')).toMatchObject({ error: "expected ',' or ']'" })
    expect(parseJson('{"a": tru}')).toMatchObject({ error: 'unexpected "t"', line: 1 })
    expect(parseJson('1 2')).toMatchObject({ error: 'unexpected text after the value' })
    expect(parseJson('"a\u0001"')).toMatchObject({ error: 'control character in string' })
    expect(parseJson('[[[1]]]', 2)).toMatchObject({ error: 'too many values to show' })
    expect(parseJson('['.repeat(300) + ']'.repeat(300))).toMatchObject({ error: 'nested too deeply' })
  })

  test('JSON Lines: one value a line, a bad line kept as an error', () => {
    const root = parseJsonLines('{"a":1}\n\nnope\n[2]\n', 10)
    expect(jsonRows(root, new Set(), 0, 100).map(row => `${row.line} ${row.path} ${row.kind} ${row.text}`)).toEqual([
      '1 [0] object {1}',
      '3 [1] error unexpected "n" at column 1',
      '4 [2] array [1]',
    ])
  })
})

describe('jsonRows and paths', () => {
  test('folds below the open depth, toggles per path, and stops at the limit', () => {
    const parsed = parseJson('{"a": {"b": {"c": 1}}, "list": [], "odd key": 2}')
    if (!('root' in parsed)) throw new Error('parse')
    const brief = (toggled: string[], limit = 100) =>
      jsonRows(parsed.root, new Set(toggled), 1, limit).map(row => `${row.path}${row.isOpen === undefined ? '' : row.isOpen ? ' ▾' : ' ▸'}`)
    expect(brief([])).toEqual(['a ▾', 'a.b ▸', 'list', '["odd key"]'])
    expect(brief(['a.b'])).toEqual(['a ▾', 'a.b ▾', 'a.b.c', 'list', '["odd key"]'])
    expect(brief(['a'])).toEqual(['a ▸', 'list', '["odd key"]'])
    expect(brief([], 2)).toHaveLength(2)
  })

  test('childPath and file kinds', () => {
    expect(childPath(childPath(childPath('', 'a'), 3), 'c-d')).toBe('a[3]["c-d"]')
    expect(isJson('x.JSON')).toBe(true)
    expect(isJson('x.jsonc')).toBe(false)
    expect(isDelimited('data.tsv')).toBe(true)
  })
})
