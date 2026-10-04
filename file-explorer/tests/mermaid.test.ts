import { describe, expect, test } from 'claude-code/testing'
import { cacheFolder, diagramKey, isMermaid, mmdcArgs, mmdcError } from '../hooks/mermaid'

describe('mermaid helpers', () => {
  test('which fences are diagrams', () => {
    expect(isMermaid('mermaid')).toBe(true)
    expect(isMermaid('Mermaid ')).toBe(true)
    expect(isMermaid('mmd')).toBe(true)
    expect(isMermaid('markdown')).toBe(false)
  })

  test('keys differ by content and stay put for the same text', () => {
    expect(diagramKey('graph TD\nA-->B')).toBe(diagramKey('graph TD\nA-->B'))
    expect(diagramKey('graph TD\nA-->B')).not.toBe(diagramKey('graph TD\nA-->C'))
    expect(diagramKey('x')).toMatch(/^[0-9a-f]{17}$/)
  })

  test('a per-person cache folder, never a shared temp', () => {
    expect(cacheFolder({ xdg: '/home/a/.cache', home: '/home/a' })).toBe('/home/a/.cache/claude-file-explorer/mermaid')
    expect(cacheFolder({ xdg: 'relative', home: '/home/a' })).toBe('/home/a/.cache/claude-file-explorer/mermaid')
    expect(cacheFolder({ localAppData: 'C:\\Users\\a\\AppData\\Local' })).toBe('C:/Users/a/AppData/Local/claude-file-explorer/mermaid')
    expect(cacheFolder({})).toBeUndefined()
  })

  test('mmdc reads stdin and writes one picture', () => {
    expect(mmdcArgs('/c/k.png', 'png')).toEqual(['mmdc', '--quiet', '--input', '-', '--output', '/c/k.png', '--backgroundColor', 'white', '--scale', '2'])
    expect(mmdcArgs('/c/k.svg', 'svg')).not.toContain('--scale')
  })

  test("mmdc's error without its stack", () => {
    const stderr = [
      '',
      'Error: Parse error on line 4:',
      'graph TD  A --> ',
      '----------------^',
      "Expecting 'AMP', 'COLON', got 'EOF'",
      'Parser.parseError (https://x/chunk.mjs:1561:21)',
      '    at #evaluate (file:///x/ExecutionContext.js:402:19)',
    ].join('\n')
    expect(mmdcError(stderr)).toBe("Parse error on line 4: Expecting 'AMP', 'COLON', got 'EOF'")
    expect(mmdcError('')).toBe('mmdc failed')
    expect(mmdcError('x'.repeat(300))).toHaveLength(200)
  })
})
