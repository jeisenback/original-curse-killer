#!/usr/bin/env node
import fs from 'fs/promises'
import { spawn } from 'child_process'

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude'

function runClaude (prompt, cwd, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const args = ['--print', prompt]
    const opts = { timeout: timeoutMs }
    if (cwd) opts.cwd = cwd
    const proc = spawn(CLAUDE_CLI, args, opts)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', chunk => { stdout += chunk })
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) return resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      reject(new Error(stderr.trim() || `claude exited with code ${code}`))
    })
  })
}

async function main () {
  const payloadPath = process.argv[2]
  if (!payloadPath) {
    console.error('Usage: safe-runner.mjs <payload.json>')
    process.exit(2)
  }
  let payload
  try {
    const raw = await fs.readFile(payloadPath, 'utf8')
    payload = JSON.parse(raw)
  } catch (e) {
    console.error('safe-runner: failed to read payload', e && e.message)
    process.exit(1)
  }

  const { agentName, prompt, projectPath, sessionId } = payload
  console.log('SAFE RUNNER START')
  console.log('Session:', sessionId || '<unknown>')
  console.log('Agent:', agentName)
  if (projectPath) console.log('ProjectPath:', projectPath)
  console.log('--- PROMPT ---')
  console.log(prompt || '')
  console.log('--- END PROMPT ---')

  try {
    const { stdout, stderr } = await runClaude(prompt, projectPath || null)
    if (stdout) {
      console.log('--- CLAUDE OUTPUT ---')
      console.log(stdout)
      console.log('--- END OUTPUT ---')
    }
    if (stderr) {
      console.error('--- CLAUDE STDERR ---')
      console.error(stderr)
    }
    process.exit(0)
  } catch (e) {
    console.error('safe-runner: claude execution failed:', e && e.message)
    process.exit(1)
  }
}

main()
