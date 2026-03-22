import { sanitizeTarget } from '../lib/targetUtils.mjs'

const cases = [
  'relative/path/to/project',
  '../traversal',
  'C:\\Windows\\system32',
  'https://github.com/owner/repo',
  'https://example.com/evil',
  '',
  'a'.repeat(300)
]

for (const c of cases) {
  try {
    const ok = sanitizeTarget(c)
    console.log('ACCEPT:', c, '=>', ok)
  } catch (e) {
    console.log('REJECT:', c, '=>', e.message)
  }
}
