// Pictures the terminal cannot decode (it takes PNG only), turned into a PNG
// by a converter the person already has: never installed here. The pure
// parts: which tool, and its argument vector.

export type RasterTool = 'sips' | 'ffmpeg' | 'magick' | 'convert'
export type Converters = { raster?: RasterTool; svg?: 'rsvg-convert' }

// The longest side of a converted picture, in pixels: plenty for a pane.
export const MAX_SIDE = 2048

export const SIPS = '/usr/bin/sips'

// The safest tool there is first: sips (macOS's own), then ffmpeg, then
// ImageMagick, whose many coders and delegates make it the last resort.
export function pickRaster(present: Partial<Record<RasterTool, boolean>>): RasterTool | undefined {
  return (['sips', 'ffmpeg', 'magick', 'convert'] as const).find(tool => present[tool] === true)
}

// The argument vector for one picture: `input` and `output` are absolute
// paths (the input's real path inside the project, the output in the
// person's private cache), so neither can read as an option.
export function rasterArgs(tool: RasterTool, format: string, input: string, output: string): string[] {
  if (!input.startsWith('/') || !output.startsWith('/')) throw new Error('paths must be absolute')
  if (tool === 'sips') return [SIPS, '--resampleHeightWidthMax', String(MAX_SIDE), '-s', 'format', 'png', input, '--out', output]
  if (tool === 'ffmpeg') {
    // `file:` keeps a name from being read as another protocol; one frame
    // (a GIF's first), scaled down to fit, never up.
    return [
      'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', `file:${input}`,
      '-frames:v', '1',
      '-vf', `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease`,
      `file:${output}`,
    ]
  }
  // ImageMagick: the coder named outright (`jpeg:`), so the bytes cannot
  // pick another; resources capped; the first frame only.
  const coder = format === 'jpeg' ? 'jpeg' : format === 'gif' ? 'gif' : 'webp'
  return [
    tool, '-limit', 'memory', '256MiB', '-limit', 'disk', '512MiB', '-limit', 'time', '20',
    `${coder}:${input}[0]`, '-resize', `${MAX_SIDE}x${MAX_SIDE}>`, `png:${output}`,
  ]
}

// librsvg's converter: it never fetches over the network, and reads local
// references only beside the file. Drawn 1200 pixels wide at most.
export function svgArgs(input: string, output: string): string[] {
  if (!input.startsWith('/') || !output.startsWith('/')) throw new Error('paths must be absolute')
  return ['rsvg-convert', '--format', 'png', '--width', '1200', '--keep-aspect-ratio', '--output', output, input]
}

// The first line a converter complained with.
export function convertError(stderr: string, tool: string): string {
  const line = stderr.split('\n').map(one => one.trim()).find(Boolean) ?? `${tool} failed`
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}
