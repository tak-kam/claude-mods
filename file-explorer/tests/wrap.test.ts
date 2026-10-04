import { describe, expect, test } from 'claude-code/testing'
import { buttonCells, expandTabs, fitCount, lastStart, packRows, rowsOf, shiftCells, widest } from '../hooks/wrap'

describe('expandTabs', () => {
  test('pads to the next stop of four', () => {
    expect(expandTabs('\tx')).toBe('    x')
    expect(expandTabs('ab\tc')).toBe('ab  c')
    expect(expandTabs('日\tx')).toBe('日  x')
    expect(expandTabs('none')).toBe('none')
  })
})

describe('rowsOf', () => {
  test('counts wrapped rows by cells, one at least', () => {
    expect(rowsOf('', 10)).toBe(1)
    expect(rowsOf('x'.repeat(10), 10)).toBe(1)
    expect(rowsOf('x'.repeat(11), 10)).toBe(2)
    expect(rowsOf('日本語日本語', 10)).toBe(2)
    expect(rowsOf('\t\t\tx', 10)).toBe(2)
  })
})

describe('fitCount', () => {
  test('takes units while their rows fit', () => {
    expect(fitCount([1, 1, 1, 1], 0, 3)).toBe(3)
    expect(fitCount([2, 2, 2], 0, 5)).toBe(2)
    expect(fitCount([1, 3, 1], 1, 4)).toBe(2)
  })

  test('always takes one, even one taller than the room', () => {
    expect(fitCount([9, 1], 0, 4)).toBe(1)
  })

  test('takes nothing past the end', () => {
    expect(fitCount([1, 1], 2, 5)).toBe(0)
  })
})

describe('lastStart', () => {
  test('is total minus room for unwrapped lines', () => {
    expect(lastStart([1, 1, 1, 1, 1], 3)).toBe(2)
  })

  test('stops earlier when the last lines wrap', () => {
    expect(lastStart([1, 1, 1, 2, 2], 4)).toBe(3)
  })

  test('is zero when everything fits', () => {
    expect(lastStart([1, 2], 10)).toBe(0)
    expect(lastStart([], 10)).toBe(0)
  })

  test('reaches a last line taller than the room', () => {
    expect(lastStart([1, 1, 9], 4)).toBe(2)
  })
})

describe('shiftCells and widest', () => {
  test('drop leading cells', () => {
    expect(shiftCells('abcdef', 2)).toBe('cdef')
    expect(shiftCells('abc', 0)).toBe('abc')
    expect(shiftCells('ab', 5)).toBe('')
    expect(shiftCells('日本語', 2)).toBe('本語')
    expect(shiftCells('\tx', 2)).toBe('  x')
  })

  test('measure the widest line in cells', () => {
    expect(widest(['ab', '日本語', '\tx'])).toBe(6)
    expect(widest([])).toBe(0)
  })
})

describe('buttonCells', () => {
  test('counts the hotkey prefix and symbols as two', () => {
    expect(buttonCells('Files', true)).toBe(8)
    expect(buttonCells('Files', false)).toBe(5)
    expect(buttonCells('↩', true)).toBe(5)
    expect(buttonCells('#', true)).toBe(4)
    expect(buttonCells('▲', false)).toBe(2)
  })
})

describe('packRows', () => {
  const item = (cells: number) => ({ cells })

  test('keeps a row within the room, gaps counted', () => {
    expect(packRows([item(4), item(4), item(4)], 9).map(row => row.length)).toEqual([2, 1])
    expect(packRows([item(4), item(4)], 8).map(row => row.length)).toEqual([1, 1])
    expect(packRows([item(3), item(3), item(3)], 11).map(row => row.length)).toEqual([3])
  })

  test('puts an item wider than the room on a row of its own', () => {
    expect(packRows([item(2), item(20), item(2)], 10).map(row => row.length)).toEqual([1, 1, 1])
  })

  test('packs nothing into nothing', () => {
    expect(packRows([], 10)).toEqual([])
  })
})
