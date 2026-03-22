import SessionManager from './lib/sessionManager.mjs'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

async function main () {
  const agentName = 'Explore'
  const prompt = 'Run a quick codebase exploration (test)'
  const session = await SessionManager.createSession({ name: `subagent-${agentName}`, projectPath: '', owner: 'tester', description: prompt })
  const s = await SessionManager.loadSession(session.id)
  s.status = 'approved-subagent'
  s.metadata = s.metadata || {}
  s.metadata.subagent = { agentName, prompt }
  s.metadata.approvedBy = 'tester'
  s.metadata.approvedAt = new Date().toISOString()
  await SessionManager.saveSession(s)
  console.log('Created approved sub-agent session', s.id)

  // execute (simulate same logic as executeSubagent in index.mjs)
  try {
    s.status = 'executing'
    await SessionManager.saveSession(s)
    const outDir = path.resolve(process.cwd(), 'sessions')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${s.id}-output.txt`)
    const safeAgent = String(agentName).replace(/"/g, '\\"')
    const safePrompt = String(prompt).replace(/"/g, '\\"')
    const cmd = `node -e "console.log('Executing sub-agent: ${safeAgent}'); console.log('Prompt: ${safePrompt}'); console.log('Simulated execution complete.')"`
    let stdout = ''
    let stderr = ''
    try {
      const res = await execAsync(cmd, { cwd: process.cwd(), timeout: 5 * 60 * 1000 })
      stdout = res.stdout || ''
      stderr = res.stderr || ''
    } catch (e) {
      stderr = (e && e.message) ? e.message : String(e)
    }
    const outContent = ['--- SUB-AGENT EXECUTION OUTPUT ---', `Agent: ${agentName}`, `Prompt: ${prompt}`, '', stdout || '<no stdout>', stderr ? `\n--- STDERR ---\n${stderr}` : ''].join('\n')
    try { fs.writeFileSync(outPath, outContent, 'utf8') } catch (we) { console.warn('Failed writing sub-agent output file', we && we.message) }
    s.status = stderr ? 'failed' : 'done'
    s.metadata = s.metadata || {}
    s.metadata.output = outPath
    s.metadata.executedAt = new Date().toISOString()
    await SessionManager.saveSession(s)
    console.log('Execution completed. Output file:', outPath)
    // print output
    const out = fs.readFileSync(outPath, 'utf8')
    console.log('--- OUTPUT START ---')
    console.log(out)
    console.log('--- OUTPUT END ---')
  } catch (e) {
    console.error('Execution error', e)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
