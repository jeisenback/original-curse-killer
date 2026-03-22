import { URL } from 'url'
import path from 'path'

// Basic target sanitizer: accepts either a relative project path (no .., no absolute drives)
// or a URL (only allowlist hosts if needed). Returns normalized string or throws.
export function sanitizeTarget (raw) {
  if (!raw && raw !== '') return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.length > 200) throw new Error('target too long')
  // reject null bytes
  if (s.indexOf('\u0000') !== -1) throw new Error('invalid target')
  // looks like a URL?
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      // allow only github.com by default; callers may relax
      const host = (u.hostname || '').toLowerCase()
      const allowHosts = ['github.com', 'raw.githubusercontent.com']
      if (!allowHosts.includes(host)) throw new Error('unsupported host')
      return u.toString()
    } catch (e) {
      throw new Error('invalid url target')
    }
  }
  // reject absolute Windows paths like C:\ or /etc
  if (path.isAbsolute(s)) throw new Error('absolute paths not allowed')
  // reject path traversal
  if (s.includes('..')) throw new Error('path traversal not allowed')
  // sanitize: collapse separators
  const normalized = path.posix.normalize(s.replace(/\\\\/g, '/'))
  if (normalized.startsWith('../') || normalized.includes('/../')) throw new Error('path traversal not allowed')
  return normalized
}

export function looksLikeUrl (raw) {
  if (!raw) return false
  return /^https?:\/\//i.test(String(raw))
}
