import { describe, expect, test } from 'claude-code/testing'
import { decodeBase64, imageCells, imageFormatOf, imageInfo } from '../hooks/image'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap(part => (typeof part === 'string' ? [...part].map(c => c.charCodeAt(0)) : part)))

describe('decodeBase64', () => {
  test('decodes, stops at the limit, and at junk', () => {
    expect([...decodeBase64('aGVsbG8=', 99)]).toEqual([104, 101, 108, 108, 111])
    expect([...decodeBase64('aGVsbG8=', 2)]).toEqual([104, 101])
    expect([...decodeBase64('aGVs!bG8=', 99)]).toEqual([104, 101, 108])
  })
})

describe('imageInfo', () => {
  test('PNG from its IHDR', () => {
    const png = bytes([0x89], 'PNG', [13, 10, 26, 10, 0, 0, 0, 13], 'IHDR', [0, 0, 2, 128, 0, 0, 1, 224])
    expect(imageInfo(png)).toEqual({ format: 'png', width: 640, height: 480 })
  })

  test('GIF, and WebP in each of its three kinds', () => {
    expect(imageInfo(bytes('GIF89a', [10, 0, 20, 0]))).toEqual({ format: 'gif', width: 10, height: 20 })
    const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, body)
    expect(imageInfo(riff('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 99, 0, 0, 49, 0, 0]))).toEqual({ format: 'webp', width: 100, height: 50 })
    // VP8L: 14 bits of width-1 then 14 of height-1, little-endian after 0x2f.
    const packed = 299 | (199 << 14)
    expect(imageInfo(riff('VP8L', [0, 0, 0, 0, 0x2f, packed & 255, (packed >> 8) & 255, (packed >> 16) & 255, (packed >>> 24) & 255])))
      .toEqual({ format: 'webp', width: 300, height: 200 })
    expect(imageInfo(riff('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 32, 0]))).toEqual({ format: 'webp', width: 64, height: 32 })
  })

  test('JPEG from its frame header, past other segments', () => {
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 120, 0, 160, 3, 0, 0, 0, 0])
    expect(imageInfo(jpeg)).toEqual({ format: 'jpeg', width: 160, height: 120 })
    expect(imageInfo(bytes([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ format: 'jpeg', width: 0, height: 0 })
  })

  test('the bytes decide, not the name; unknown is undefined', () => {
    expect(imageInfo(bytes('hello world'))).toBeUndefined()
    expect(imageFormatOf('a/Photo.JPG')).toBe('jpeg')
    expect(imageFormatOf('logo.svg')).toBeUndefined()
  })
})

describe('imageCells', () => {
  test('keeps the aspect with cells twice as tall as wide, within the box', () => {
    expect(imageCells(800, 400, 60, 40)).toEqual({ columns: 60, rows: 15 })
    expect(imageCells(400, 800, 60, 20)).toEqual({ columns: 20, rows: 20 })
    expect(imageCells(16, 16, 60, 40)).toEqual({ columns: 2, rows: 1 })
    expect(imageCells(0, 0, 60, 40)).toEqual({ columns: 60, rows: 30 })
    expect(imageCells(5000, 10, 999, 999).columns).toBe(255)
  })
})
