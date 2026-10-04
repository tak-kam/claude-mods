// File details and git-ignored paths: formatting and lookups, no engine
// calls, so each is tested on its own.

// A size in at most four cells: 812, 4.2K, 12K, 3.1M, 2G.
export function formatSize(bytes: number): string {
  if (bytes < 1000) return String(Math.max(0, Math.round(bytes)))
  const units = ['K', 'M', 'G', 'T']
  let value = bytes / 1024
  let unit = 0
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = value < 9.95 ? value.toFixed(1) : String(Math.round(value))
  return `${shown}${units[unit]}`
}

// How long ago, in at most three cells: now, 5m, 3h, 2d, 4w, 6mo, 2y.
export function formatAge(mtimeMs: number, nowMs: number): string {
  const seconds = Math.max(0, (nowMs - mtimeMs) / 1000)
  if (mtimeMs <= 0 || nowMs <= 0) return ''
  if (seconds < 60) return 'now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.floor(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)}h`
  const days = hours / 24
  if (days < 7) return `${Math.floor(days)}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

// `git ls-files --others --ignored --exclude-standard --directory -z`:
// ignored files, and whole ignored folders with a trailing slash.
export function parseIgnored(raw: string, limit: number): string[] {
  return raw.split('\0').filter(path => path !== '').slice(0, limit)
}

// Whether a path is ignored: listed itself, or under an ignored folder.
export function isIgnored(rel: string, ignored: ReadonlySet<string>): boolean {
  if (ignored.size === 0) return false
  if (ignored.has(rel) || ignored.has(`${rel}/`)) return true
  for (let at = rel.indexOf('/'); at >= 0; at = rel.indexOf('/', at + 1)) {
    if (ignored.has(rel.slice(0, at + 1))) return true
  }
  return false
}
