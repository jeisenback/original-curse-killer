#!/usr/bin/env node
import fs from 'fs/promises'

async function main () {
  const p = process.argv[2]
  if (!p) {
    console.error('Usage: safe-runner.mjs <payload.json>')
    process.exit(2)
  }
  try {
    const raw = await fs.readFile(p, 'utf8')
    const payload = JSON.parse(raw)
    // Minimal, safe behavior: echo the payload in a structured way
    console.log('SAFE RUNNER START')
    console.log('Session:', payload.sessionId || '<unknown>')
    if (payload.projectPath) console.log('ProjectPath:', payload.projectPath)
    console.log('Agent:', payload.agentName)
    console.log('--- PROMPT ---')
    console.log(payload.prompt || '')
    console.log('--- END PROMPT ---')
    console.log('Simulated safe execution complete.')
    process.exit(0)
  } catch (e) {
    console.error('safe-runner error', e && e.message)
    process.exit(1)
  }
}

main()
