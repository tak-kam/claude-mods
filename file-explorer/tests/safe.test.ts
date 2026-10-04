import { describe, expect, test } from 'claude-code/testing'
import { cleanText, hitLine, isPlainRelative, oneLine } from '../hooks/safe'
import { iconFor, iconWidth } from '../hooks/icons'

describe('cleanText', () => {
  test('folds CRLF and drops C0 and C1 controls but tab and newline', () => {
    expect(cleanText('a\r\nb\rc\td\u001b[31me\u009bf\u0007')).toBe('a\nb\nc\td[31mef')
  })

  test('shows bidi overrides and isolates instead of applying them', () => {
    expect(cleanText('if (a ‮} ⁦x⁩')).toBe('if (a �} �x�')
  })
})

describe('oneLine and hitLine', () => {
  test('oneLine shows every control as ?', () => {
    expect(oneLine('a\nb\tc\u001b\u009b\u007f')).toBe('a?b?c???')
  })

  test('hitLine keeps tabs for the excerpt', () => {
    expect(hitLine('\ta\nb\u001b')).toBe('\ta?b?')
  })

  test('leave ordinary text, CJK and emoji alone', () => {
    expect(oneLine('日本語 📁 café')).toBe('日本語 📁 café')
  })
})

describe('isPlainRelative', () => {
  test('accepts paths under the root only', () => {
    expect(isPlainRelative('src/main.ts')).toBe(true)
    expect(isPlainRelative('.github/workflows/ci.yml')).toBe(true)
    expect(isPlainRelative('../etc/passwd')).toBe(false)
    expect(isPlainRelative('src/../../x')).toBe(false)
    expect(isPlainRelative('./src')).toBe(false)
    expect(isPlainRelative('/abs')).toBe(false)
    expect(isPlainRelative('a//b')).toBe(false)
    expect(isPlainRelative('')).toBe(false)
  })
})

describe('icons', () => {
  test('pick by name before extension', () => {
    expect(iconFor('package.json', false, false, 'emoji').glyph).toBe('📦 ')
    expect(iconFor('other.json', false, false, 'emoji').glyph).toBe('🔧 ')
    expect(iconFor('types.d.ts', false, false, 'emoji').glyph).toBe('📘 ')
    expect(iconFor('.env.local', false, false, 'emoji').glyph).toBe('🔑 ')
    expect(iconFor('Dockerfile.dev', false, false, 'emoji').glyph).toBe('🐳 ')
    expect(iconFor('noext', false, false, 'emoji').glyph).toBe('📄 ')
  })

  test('open and close folders, with special ones', () => {
    expect(iconFor('lib', true, false, 'emoji').glyph).toBe('📁 ')
    expect(iconFor('lib', true, true, 'emoji').glyph).toBe('📂 ')
    expect(iconFor('tests', true, false, 'emoji').glyph).toBe('🧪 ')
  })

  test('colour Nerd Font glyphs and keep ascii plain', () => {
    expect(iconFor('a.ts', false, false, 'nerd')).toEqual({ glyph: ' ', color: 'blue' })
    expect(iconFor('a.ts', false, false, 'ascii')).toEqual({ glyph: '· ' })
    expect(iconFor('dir', true, false, 'ascii').glyph).toBe('')
  })

  test('report the cells a glyph takes', () => {
    expect(iconWidth(iconFor('a.ts', false, false, 'emoji'), 'emoji')).toBe(3)
    expect(iconWidth(iconFor('a.ts', false, false, 'nerd'), 'nerd')).toBe(2)
    expect(iconWidth(iconFor('dir', true, false, 'ascii'), 'ascii')).toBe(0)
  })

  test('use no emoji that needs a variation selector', () => {
    for (const name of ['a.tsx', 'a.sql', 'a.png', 'a.zip', 'a.java']) {
      expect(iconFor(name, false, false, 'emoji').glyph.includes('️')).toBe(false)
    }
  })
})
