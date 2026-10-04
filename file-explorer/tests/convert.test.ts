import { describe, expect, test } from 'claude-code/testing'
import { convertError, pickRaster, rasterArgs, svgArgs } from '../hooks/convert'
import { cacheFolder } from '../hooks/mermaid'

describe('picture converters', () => {
  test('the safest tool there is first, ImageMagick last', () => {
    expect(pickRaster({ sips: true, ffmpeg: true, magick: true })).toBe('sips')
    expect(pickRaster({ ffmpeg: true, magick: true })).toBe('ffmpeg')
    expect(pickRaster({ convert: true })).toBe('convert')
    expect(pickRaster({})).toBeUndefined()
  })

  test('ffmpeg reads and writes plain files only, one frame, scaled down', () => {
    const argv = rasterArgs('ffmpeg', 'gif', '/p/a.gif', '/c/k.png')
    expect(argv).toContain('-nostdin')
    expect(argv).toContain('file:/p/a.gif')
    expect(argv.at(-1)).toBe('file:/c/k.png')
    expect(argv[argv.indexOf('-frames:v') + 1]).toBe('1')
  })

  test('ImageMagick gets the coder named outright and capped resources', () => {
    const argv = rasterArgs('magick', 'jpeg', '/p/a.jpg', '/c/k.png')
    expect(argv).toContain('jpeg:/p/a.jpg[0]')
    expect(argv.at(-1)).toBe('png:/c/k.png')
    expect(argv.slice(1, 7)).toEqual(['-limit', 'memory', '256MiB', '-limit', 'disk', '512MiB'])
    expect(rasterArgs('convert', 'webp', '/p/a.webp', '/c/k.png')[0]).toBe('convert')
  })

  test("sips by its absolute path; rsvg-convert for SVG", () => {
    expect(rasterArgs('sips', 'jpeg', '/p/a.jpg', '/c/k.png')).toEqual(['/usr/bin/sips', '--resampleHeightWidthMax', '2048', '-s', 'format', 'png', '/p/a.jpg', '--out', '/c/k.png'])
    expect(svgArgs('/p/a.svg', '/c/k.png')).toEqual(['rsvg-convert', '--format', 'png', '--width', '1200', '--keep-aspect-ratio', '--output', '/c/k.png', '/p/a.svg'])
  })

  test('a relative path, which could read as an option, is refused', () => {
    expect(() => rasterArgs('ffmpeg', 'jpeg', '-x.jpg', '/c/k.png')).toThrow()
    expect(() => svgArgs('/p/a.svg', 'k.png')).toThrow()
  })

  test('errors: the first line; a folder of its own beside mermaid', () => {
    expect(convertError('\nError opening input: No such file\nmore', 'ffmpeg')).toBe('Error opening input: No such file')
    expect(convertError('', 'ffmpeg')).toBe('ffmpeg failed')
    expect(cacheFolder({ home: '/home/a' }, 'pictures')).toBe('/home/a/.cache/claude-file-explorer/pictures')
  })
})
