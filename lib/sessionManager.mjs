import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR || path.resolve(process.cwd(), 'sessions')

async function ensureDir () {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true })
  } catch (e) {
    // ignore
  }
}

export async function listSessions () {
  await ensureDir()
  const files = await fs.readdir(SESSIONS_DIR)
  const sessions = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const data = JSON.parse(await fs.readFile(path.join(SESSIONS_DIR, f), 'utf8'))
      sessions.push(data)
    } catch (e) {
      // skip invalid
    }
  }
  return sessions
}

export async function createSession ({ name, projectPath, owner, description = '' }) {
  await ensureDir()
  const id = randomUUID()
  const session = {
    id,
    name,
    projectPath: projectPath || '',
    owner: owner || '',
    description,
    createdAt: new Date().toISOString(),
    status: 'idle',
    metadata: {}
  }
  await fs.writeFile(path.join(SESSIONS_DIR, `${id}.json`), JSON.stringify(session, null, 2), 'utf8')
  return session
}

export async function loadSession (id) {
  const p = path.join(SESSIONS_DIR, `${id}.json`)
  const raw = await fs.readFile(p, 'utf8')
  return JSON.parse(raw)
}

export async function saveSession (session) {
  if (!session || !session.id) throw new Error('session.id required')
  await ensureDir()
  await fs.writeFile(path.join(SESSIONS_DIR, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf8')
  return session
}

export async function deleteSession (id) {
  const p = path.join(SESSIONS_DIR, `${id}.json`)
  await fs.unlink(p)
}

export default { listSessions, createSession, loadSession, saveSession, deleteSession }
