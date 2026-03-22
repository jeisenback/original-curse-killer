import fs from 'fs/promises'
import path from 'path'
import { loadSession, saveSession } from '../lib/sessionManager.mjs'

const SESSIONS_DIR = process.env.CLAUDE_SESSIONS_DIR || path.resolve(process.cwd(), 'sessions')

async function run () {
  const id = process.argv[2] || '171c27eb-a9e7-4aff-9d71-6cb3770ce4d7'
  try {
    const session = await loadSession(id)
    console.log('Loaded session:', session.id, 'status=', session.status)

    if (session.status !== 'pending-subagent') {
      console.log('Warning: session is not in "pending-subagent" state. Proceeding to approve anyway.')
    }

    session.status = 'approved-subagent'
    session.approvedAt = new Date().toISOString()
    session.approvedBy = process.env.USER || process.env.USERNAME || 'cli'
    await saveSession(session)
    console.log('Session marked approved.')

    // Start execution
    session.status = 'executing'
    session.executedAt = new Date().toISOString()
    await saveSession(session)
    console.log('Session status set to executing.')

    const outPath = path.join(SESSIONS_DIR, `${session.id}-output.txt`)
    const outLines = []
    outLines.push(`Execution start: ${new Date().toISOString()}`)
    outLines.push(`Agent: ${session.metadata && session.metadata.agentName ? session.metadata.agentName : 'unknown'}`)
    outLines.push(`Prompt: ${session.metadata && session.metadata.prompt ? session.metadata.prompt : ''}`)
    outLines.push('---')
    outLines.push('Simulated execution log:')
    outLines.push('> Running steps...')
    outLines.push('> Step 1: analyze repo (simulated)')
    outLines.push('> Step 2: prepare changes (simulated)')
    outLines.push('> Step 3: apply changes (simulated)')
    outLines.push('Execution complete: success')
    outLines.push(`Execution end: ${new Date().toISOString()}`)

    await fs.writeFile(outPath, outLines.join('\n'), 'utf8')

    session.status = 'done'
    session.metadata = session.metadata || {}
    session.metadata.output = outPath
    session.completedAt = new Date().toISOString()
    await saveSession(session)

    console.log('Execution completed. Output file:', outPath)
    console.log('Final session status:', session.status)
  } catch (err) {
    console.error('Error:', err && err.message)
    process.exitCode = 2
  }
}

run()
