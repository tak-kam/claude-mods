// Pictures: which files are, and their format and size in pixels read from
// the header bytes, without decoding the picture.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

export function imageFormatOf(path: string): ImageFormat | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'gif') return 'gif'
  if (ext === 'webp') return 'webp'
  return undefined
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VALUE = new Map([...ALPHABET].map((char, i) => [char, i]))

// The first `most` bytes of base64 text; anything not base64 ends it.
export function decodeBase64(text: string, most: number): Uint8Array {
  const out = new Uint8Array(Math.min(most, Math.floor((text.length * 3) / 4)))
  let size = 0
  let bits = 0
  let held = 0
  for (const char of text) {
    if (size >= out.length) break
    const value = VALUE.get(char === '-' ? '+' : char === '_' ? '/' : char)
    if (value === undefined) {
      if (char === '=' || char === '\n' || char === '\r') continue
      break
    }
    held = (held << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[size++] = (held >> bits) & 0xff
    }
  }
  return out.subarray(0, size)
}

const be16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
const le16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
const be32 = (b: Uint8Array, at: number) => be16(b, at) * 0x10000 + be16(b, at + 2)
const le24 = (b: Uint8Array, at: number) => le16(b, at) + (b[at + 2] ?? 0) * 0x10000
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

// The format the bytes say they are (not the name), and the pixel size
// when the header gives it.
export function imageInfo(b: Uint8Array): { format: ImageFormat; width: number; height: number } | undefined {
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    return ascii(b, 12, 4) === 'IHDR' ? { format: 'png', width: be32(b, 16), height: be32(b, 20) } : { format: 'png', width: 0, height: 0 }
  }
  if (ascii(b, 0, 4) === 'GIF8') return { format: 'gif', width: le16(b, 6), height: le16(b, 8) }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8X') return { format: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ') return { format: 'webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
    return { format: 'webp', width: 0, height: 0 }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to a start-of-frame marker, which holds the size.
    let at = 2
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return { format: 'jpeg', width: 0, height: 0 }
      const marker = b[at + 1] ?? 0
      if (marker === 0xff) {
        at++
        continue
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return { format: 'jpeg', width: be16(b, at + 7), height: be16(b, at + 5) }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2
        continue
      }
      at += 2 + be16(b, at + 2)
    }
    return { format: 'jpeg', width: 0, height: 0 }
  }
  return undefined
}

// The box of cells a picture takes: as wide as it may be, its aspect kept
// with a cell twice as tall as wide, then shrunk to the rows there are.
export function imageCells(width: number, height: number, columns: number, rows: number): { columns: number; rows: number } {
  const most = Math.max(1, Math.min(255, columns))
  const tall = Math.max(1, Math.min(255, rows))
  if (width <= 0 || height <= 0) return { columns: most, rows: Math.max(1, Math.min(tall, Math.round(most / 2))) }
  // A small picture is not blown up past about 8 pixels a cell.
  let cols = Math.min(most, Math.max(1, Math.ceil(width / 8)))
  let high = Math.max(1, Math.round((cols * height) / width / 2))
  if (high > tall) {
    high = tall
    cols = Math.max(1, Math.min(most, Math.round((high * 2 * width) / height)))
  }
  return { columns: cols, rows: high }
}
