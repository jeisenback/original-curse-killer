#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { Client, GatewayIntentBits, Partials } from 'discord.js'

// Load `.env` file into process.env if present (simple parser, no extra deps)
try {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8')
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const eq = trimmed.indexOf('=')
      if (eq === -1) return
      const key = trimmed.substring(0, eq).trim()
      let val = trimmed.substring(eq + 1)
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1)
      }
      if (!process.env[key]) process.env[key] = val
    })
  }
} catch (_) {}

const TOKEN = process.env.DISCORD_BOT_TOKEN
const ALLOWED = (process.env.DISCORD_ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean)
const NODE_ENV = process.env.NODE_ENV || 'development'
const TEST_GUILD = process.env.DISCORD_TEST_GUILD_ID || ''

// Path to the claude CLI binary
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude'
// Default working directory passed to claude (can be overridden per-command)
const CLAUDE_PROJECT_PATH = process.env.CLAUDE_PROJECT_PATH || 'c:/tools'

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN. Fill .env or set env var.')
  process.exit(1)
}

console.log('Discord→Claude bridge starting...')
console.log('NODE_ENV=', NODE_ENV)
console.log('CLAUDE_CLI=', CLAUDE_CLI)
console.log('CLAUDE_PROJECT_PATH=', CLAUDE_PROJECT_PATH)
console.log('DISCORD_ALLOWED_USERS=', ALLOWED.length ? ALLOWED.join(',') : '<everyone>')

// Discover gstack skills from .claude/skills/
const SKILLS_DIR = path.resolve(process.cwd(), '.claude', 'skills')
let SKILL_NAMES = []
try {
  if (fs.existsSync(SKILLS_DIR)) {
    SKILL_NAMES = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name.replace(/_/g, '-'))
  }
} catch (e) {
  console.warn('Could not read skills directory:', e && e.message)
}
console.log('Skills discovered:', SKILL_NAMES.length ? SKILL_NAMES.join(', ') : '<none>')

// ── Helpers ────────────────────────────────────────────────────────────────

function isAllowed (userId) {
  if (ALLOWED.length === 0) return true
  return ALLOWED.includes(userId) || ALLOWED.includes(String(userId))
}

/**
 * Run `claude --print <prompt>` safely using spawn (no shell injection).
 * Resolves with the trimmed stdout string.
 */
function runClaudeCmd (prompt, cwd = CLAUDE_PROJECT_PATH, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_CLI, ['--print', prompt], { cwd, timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', chunk => { stdout += chunk })
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) return resolve(stdout.trim())
      reject(new Error(stderr.trim() || `claude exited with code ${code}`))
    })
  })
}

/** Split a long string into Discord-safe chunks (≤ 1900 chars). */
function splitMessage (text, maxLen = 1900) {
  const chunks = []
  while (text.length > maxLen) {
    chunks.push(text.slice(0, maxLen))
    text = text.slice(maxLen)
  }
  if (text.length) chunks.push(text)
  return chunks
}

/**
 * Send the Claude response back to Discord.
 * Uses editReply for the first chunk, followUp for the rest.
 */
async function sendClaudeResponse (output, interaction) {
  const chunks = splitMessage(output || '*(no response)*')
  await interaction.editReply(chunks[0])
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i])
  }
}

// ── Discord client ─────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`)

  // Build slash commands
  const skillCmds = SKILL_NAMES.map(name => ({
    name: name.toLowerCase(),
    description: `Run Claude skill: /${name}`,
    options: [
      { name: 'target', description: 'Optional path, URL, or extra context', type: 3, required: false }
    ]
  }))

  const claudeCmd = {
    name: 'claude',
    description: 'Send a prompt directly to Claude CLI',
    options: [
      { name: 'prompt', description: 'The prompt to send', type: 3, required: true },
      { name: 'project', description: 'Working directory for Claude (defaults to CLAUDE_PROJECT_PATH)', type: 3, required: false }
    ]
  }

  const cmds = [...skillCmds, claudeCmd]

  const register = TEST_GUILD
    ? client.guilds.cache.get(TEST_GUILD)?.commands ?? client.application.commands
    : client.application.commands

  register.set(cmds)
    .then(() => console.log(`Registered ${cmds.length} slash command(s)`))
    .catch(err => console.warn('Failed to register slash commands:', err && err.message))
})

// ── Slash command handler ──────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (!isAllowed(interaction.user.id)) {
    return interaction.reply({ content: 'You are not allowed to use this bot.', ephemeral: true })
  }

  const cmd = interaction.commandName

  let prompt
  let projectPath = CLAUDE_PROJECT_PATH

  if (cmd === 'claude') {
    prompt = interaction.options.getString('prompt')
    const rawProject = interaction.options.getString('project')
    if (rawProject) projectPath = path.resolve(rawProject)
  } else if (SKILL_NAMES.includes(cmd)) {
    // Skills are invoked as `/<skill-name> [target]` inside Claude
    const target = interaction.options.getString('target') || ''
    prompt = `/${cmd}${target ? ' ' + target : ''}`
  } else {
    return
  }

  await interaction.deferReply()
  try {
    const output = await runClaudeCmd(prompt, projectPath)
    await sendClaudeResponse(output, interaction)
  } catch (e) {
    console.error(`/${cmd} error`, e)
    await interaction.editReply('Claude error: ' + (e && e.message ? e.message : String(e)))
  }
})

// ── Message handler — treat every message as a Claude CLI prompt ───────────

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author?.bot) return
    if (!isAllowed(msg.author.id)) return

    const text = (msg.content || '').trim()
    if (!text) return

    // Keep Discord's typing indicator alive while Claude thinks
    const typingInterval = setInterval(() => msg.channel.sendTyping().catch(() => {}), 9000)
    msg.channel.sendTyping().catch(() => {})

    try {
      const output = await runClaudeCmd(text, CLAUDE_PROJECT_PATH)
      const chunks = splitMessage(output || '*(no response)*')
      await msg.reply(chunks[0])
      for (let i = 1; i < chunks.length; i++) {
        await msg.channel.send(chunks[i])
      }
    } finally {
      clearInterval(typingInterval)
    }
  } catch (err) {
    console.error('messageCreate error', err)
    try { await msg.reply('Error: ' + (err && err.message ? err.message : String(err))) } catch (_) {}
  }
})

// ── Error handlers ─────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason))
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err))

// ── Start ──────────────────────────────────────────────────────────────────

if (NODE_ENV === 'test') {
  console.log('TEST mode: skipping Discord login.')
} else {
  client.login(TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err)
    process.exit(1)
  })
}
