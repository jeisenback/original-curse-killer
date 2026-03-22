#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import os from 'os'
import SessionManager from './lib/sessionManager.mjs'
import { sanitizeTarget } from './lib/targetUtils.mjs'
import { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType } from 'discord.js'
import { exec } from 'child_process'
import { promisify } from 'util'

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
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1)
      }
      if (!process.env[key]) process.env[key] = val
    })
  }
} catch (e) {
  // ignore env load errors
}

const ROUTES_FILE = process.env.ROUTES_FILE || 'routes.json'
const TOKEN = process.env.DISCORD_BOT_TOKEN
const ALLOWED = (process.env.DISCORD_ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean)

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN. Fill .env or set env var.');
  process.exit(1);
}

const NODE_ENV = process.env.NODE_ENV || 'development'
const TEST_GUILD = process.env.DISCORD_TEST_GUILD_ID || ''
const BYPASS_APPROVE = (process.env.DISCORD_BYPASS_APPROVAL_USERS || '').split(',').map(s => s.trim()).filter(Boolean)

console.log('Discord channel service starting...')
console.log('NODE_ENV=', NODE_ENV)
console.log('ROUTES_FILE=', ROUTES_FILE)
console.log('DISCORD_ALLOWED_USERS=', ALLOWED.length ? ALLOWED.join(',') : '<not set>')

// Load routes file (optional)
try {
  const routesPath = path.resolve(process.cwd(), ROUTES_FILE)
  if (fs.existsSync(routesPath)) {
    const cfg = JSON.parse(fs.readFileSync(routesPath, 'utf8'))
    console.log('Loaded routes:', Object.keys(cfg))
  } else {
    console.log('No routes file found at', routesPath)
  }
} catch (e) {
  console.warn('Failed loading routes file:', e.message)
}

// Basic Discord bot with simple message command handlers for session management.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
})

// Discover available gstack skills from .claude/skills directory
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
const execAsync = promisify(exec)

function isAllowed (userId) {
  if (ALLOWED.length === 0) return true
  return ALLOWED.includes(userId) || ALLOWED.includes(userId.toString())
}

function canBypassApproval (userId) {
  if (!BYPASS_APPROVE || BYPASS_APPROVE.length === 0) return false
  const inBypass = BYPASS_APPROVE.includes(userId) || BYPASS_APPROVE.includes(userId.toString())
  const inAllowed = (ALLOWED && ALLOWED.length > 0) ? (ALLOWED.includes(userId) || ALLOWED.includes(userId.toString())) : false
  return inBypass && inAllowed
}

function helpText () {
  return [
    'Session commands: ',
    '`!sessions list` — list sessions',
    '`!sessions create <name> [projectPath]` — create session',
    '`!sessions info <id>` — show session details',
    '`!sessions start <id>` — mark session running',
    '`!sessions stop <id>` — mark session idle',
    '`!sessions delete <id>` — delete session'
  ].join('\n')
}

// Execute an approved sub-agent. Whitelist: ALL (per user confirmation).
async function executeSubagent (s) {
  try {
    s.status = 'executing'
    await SessionManager.saveSession(s)
    const outDir = path.resolve(process.cwd(), 'sessions')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${s.id}-output.txt`)
    const agentName = (s.metadata && s.metadata.subagent && s.metadata.subagent.agentName) || 'unknown'
    const prompt = (s.metadata && s.metadata.subagent && s.metadata.subagent.prompt) || ''
    const safeAgent = String(agentName)
    const safePrompt = String(prompt)
    // Prepare a safe JSON payload and invoke the safe-runner script to avoid shell interpolation
    const payload = {
      agentName: safeAgent,
      prompt: safePrompt,
      projectPath: s.projectPath || (s.metadata && s.metadata.subagent && s.metadata.subagent.projectPath) || null,
      sessionId: s.id
    }
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'subagent-'))
    const payloadPath = path.join(tmpDir, `${s.id}-payload.json`)
    try {
      await fs.promises.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (we) {
      console.warn('Failed writing payload file', we && we.message)
    }
    const runner = path.join('scripts', 'safe-runner.mjs')
    const runnerCmd = `node ${runner} ${payloadPath}`
    let stdout = ''
    let stderr = ''
    try {
      const res = await execAsync(runnerCmd, { cwd: process.cwd(), timeout: 5 * 60 * 1000 })
      stdout = res.stdout || ''
      stderr = res.stderr || ''
    } catch (e) {
      stderr = (e && e.message) ? e.message : String(e)
    }
    const outContent = ['--- SUB-AGENT EXECUTION OUTPUT ---', `Agent: ${agentName}`, `ProjectPath: ${payload.projectPath || '<none>'}`, `Prompt: ${prompt}`, '', stdout || '<no stdout>', stderr ? `\n--- STDERR ---\n${stderr}` : ''].join('\n')
    try { fs.writeFileSync(outPath, outContent, 'utf8') } catch (we) { console.warn('Failed writing sub-agent output file', we && we.message) }
    s.status = stderr ? 'failed' : 'done'
    s.metadata = s.metadata || {}
    s.metadata.output = outPath
    s.metadata.executedAt = new Date().toISOString()
    await SessionManager.saveSession(s)
    return { ok: true, outPath }
  } catch (e) {
    console.error('executeSubagent error', e)
    try { s.status = 'failed'; s.metadata = s.metadata || {}; s.metadata.error = e && e.message; await SessionManager.saveSession(s) } catch (ee) { console.error('Failed saving session after execution error', ee) }
    return { ok: false, error: e && e.message }
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`)
  // Register slash commands for discovered skills (simple single-option commands)
  try {
    if (SKILL_NAMES.length > 0 && client.application) {
      const skillCmds = SKILL_NAMES.map(name => ({
        name: name.toLowerCase(),
        description: `Run gstack skill: ${name}`,
        options: [
          { name: 'target', description: 'Optional project path, URL, or short prompt', type: 3, required: false }
        ]
      }))
      // Add a channel management command: /create-channel repo:<name> issue:<id?>
      const channelCmd = {
        name: 'create-channel',
        description: 'Create a feature channel: feature-<repo> or feature-<repo>-<issue>',
        options: [
          { name: 'repo', description: 'Repository or short repo name (e.g. dmforge)', type: 3, required: true },
          { name: 'issue', description: 'Optional issue identifier (e.g. 123 or ISSUE-45)', type: 3, required: false },
          { name: 'role', description: 'Optional role name to grant write permissions', type: 3, required: false }
        ]
      }
      const archiveCmd = {
        name: 'archive-channel',
        description: 'Archive the current channel (moves to Archive category and locks)',
        options: [
          { name: 'channel', description: 'Channel name to archive (optional, defaults to current)', type: 3, required: false }
        ]
      }
      const runSubagentCmd = {
        name: 'run-subagent',
        description: 'Queue a sub-agent request for manual approval',
        options: [
          { name: 'agent', description: 'Sub-agent name (e.g. Explore)', type: 3, required: true },
          { name: 'prompt', description: 'Prompt or task for the sub-agent', type: 3, required: true },
          { name: 'target', description: 'Optional project path or repo URL (projectPath)', type: 3, required: false }
        ]
      }
      const approveSubagentCmd = {
        name: 'approve-subagent',
        description: 'Approve a queued sub-agent request (admin only)',
        options: [
          { name: 'session', description: 'Session ID created by /run-subagent (optional)', type: 3, required: false }
        ]
      }
      const listPendingCmd = {
        name: 'list-pending',
        description: 'List pending sub-agent sessions (helpful to copy id for approve)'
      }
      const cmds = [...skillCmds, channelCmd, archiveCmd, runSubagentCmd, approveSubagentCmd, listPendingCmd]
      // Register commands: use a test guild if provided for fast propagation
      if (TEST_GUILD) {
        const g = client.guilds.cache.get(TEST_GUILD)
        if (g && g.commands) {
          g.commands.set(cmds).then(() => console.log(`Registered slash commands to test guild ${TEST_GUILD}`)).catch(err => console.warn('Failed to register guild commands:', err && err.message))
        } else {
          // fallback to application-level set if guild not cached yet
          client.application.commands.set(cmds).then(() => console.log('Registered slash commands (fallback global)')).catch(err => console.warn('Failed to register slash commands:', err && err.message))
        }
      } else {
        // Overwrite global commands for this bot (simple approach)
        client.application.commands.set(cmds).then(() => {
          console.log('Registered slash commands for skills and channel management')
        }).catch(err => console.warn('Failed to register slash commands:', err && err.message))
      }
    }
  } catch (e) {
    console.warn('Slash command registration error:', e && e.message)
  }
})

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return
    const cmd = interaction.commandName
    // Channel management command
    if (cmd === 'create-channel') {
      if (!interaction.guild) return interaction.reply({ content: 'Channel creation must be used in a guild.', ephemeral: true })
      // permission check for managing channels
      const memberPerms = interaction.memberPermissions || (interaction.member && interaction.member.permissions)
      if (!memberPerms || !memberPerms.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ content: 'You need Manage Channels permission to run this command.', ephemeral: true })
      }
      const repoRaw = interaction.options.getString('repo') || ''
      const issueRaw = interaction.options.getString('issue') || ''
      const roleRaw = interaction.options.getString('role') || ''
      const sanitize = str => str.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '').replace(/\//g, '-')
      const repo = sanitize(repoRaw)
      if (!repo) return interaction.reply({ content: 'Invalid repo name', ephemeral: true })
      const generalName = `feature-${repo}`
      const issueName = issueRaw ? `feature-${repo}-${sanitize(issueRaw)}` : null
      await interaction.deferReply()
      try {
        // Ensure category exists for this repo
        let category = interaction.guild.channels.cache.find(c => c.name === generalName && c.type === ChannelType.GuildCategory)
        if (!category) {
          category = await interaction.guild.channels.create({ name: generalName, type: ChannelType.GuildCategory, reason: `Creating category ${generalName}` })
        }
        // Ensure general channel exists under category
        let general = interaction.guild.channels.cache.find(c => c.parentId === String(category.id) && c.name === generalName && c.type === ChannelType.GuildText)
        if (!general) {
          general = await interaction.guild.channels.create({ name: generalName, type: ChannelType.GuildText, parent: category.id, reason: `Creating feature channel ${generalName} under category` })
        }
        // Permission template: lock down by default, allow provided role and the command invoker
        try {
          const everyone = interaction.guild.roles.everyone
          const overwrites = [
            { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
          ]
          if (roleRaw) {
            const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleRaw.toLowerCase() || r.id === roleRaw)
            if (role) overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] })
          }
          // allow the command invoker
          if (interaction.member && interaction.member.user) {
            const memberId = interaction.user.id
            overwrites.push({ id: memberId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] })
          }
          await general.permissionOverwrites.set(overwrites, `Applying permission template for ${generalName}`)
        } catch (pe) {
          console.warn('Failed applying permission template to general channel:', pe && pe.message)
        }
        let createdIssueChannel = null
        if (issueName) {
          // create issue-specific channel
          const exists = interaction.guild.channels.cache.find(c => c.parentId === String(category.id) && c.name === issueName && c.type === ChannelType.GuildText)
          if (!exists) {
            createdIssueChannel = await interaction.guild.channels.create({ name: issueName, type: ChannelType.GuildText, parent: category.id, reason: `Creating issue channel ${issueName} under category` })
            // apply same permission template to issue channel
            try {
              const everyone = interaction.guild.roles.everyone
              const overwrites = [
                { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
              ]
              if (roleRaw) {
                const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleRaw.toLowerCase() || r.id === roleRaw)
                if (role) overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] })
              }
              if (interaction.member && interaction.member.user) overwrites.push({ id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] })
              await createdIssueChannel.permissionOverwrites.set(overwrites, `Applying permission template for ${issueName}`)
            } catch (pe) {
              console.warn('Failed applying permission template to issue channel:', pe && pe.message)
            }
          } else {
            createdIssueChannel = exists
          }
        }
        const parts = [`General channel: <#${general.id}>`]
        if (createdIssueChannel) parts.push(`Issue channel: <#${createdIssueChannel.id}>`)
        await interaction.editReply(parts.join('\n'))
      } catch (e) {
        console.error('create-channel error', e)
        await interaction.editReply('Failed to create channel: ' + (e && e.message ? e.message : String(e)))
      }
      return
    }

    // Archive command: move a channel to Archive category and lock it
    if (cmd === 'archive-channel') {
      if (!interaction.guild) return interaction.reply({ content: 'This command must be used in a guild.', ephemeral: true })
      const memberPerms = interaction.memberPermissions || (interaction.member && interaction.member.permissions)
      if (!memberPerms || !memberPerms.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ content: 'You need Manage Channels permission to run this command.', ephemeral: true })
      }
      const channelName = interaction.options.getString('channel')
      let targetChannel = null
      if (channelName) targetChannel = interaction.guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildText)
      else if (interaction.channel && interaction.channel.isTextBased && interaction.channel.guildId === interaction.guild.id) targetChannel = interaction.channel
      if (!targetChannel) return interaction.reply({ content: 'Channel not found.', ephemeral: true })
      await interaction.deferReply()
      try {
        let archiveCat = interaction.guild.channels.cache.find(c => c.name === 'Archive' && c.type === ChannelType.GuildCategory)
        if (!archiveCat) archiveCat = await interaction.guild.channels.create({ name: 'Archive', type: ChannelType.GuildCategory, reason: 'Creating Archive category' })
        await targetChannel.setParent(archiveCat.id, { lockPermissions: false })
        // lock down channel
        const everyone = interaction.guild.roles.everyone
        await targetChannel.permissionOverwrites.set([{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }], 'Archiving channel')
        await interaction.editReply(`Archived channel <#${targetChannel.id}> into ${archiveCat.name}`)
      } catch (e) {
        console.error('archive-channel error', e)
        await interaction.editReply('Failed to archive channel: ' + (e && e.message ? e.message : String(e)))
      }
      return
    }

    // Queue a sub-agent request
    if (cmd === 'run-subagent') {
      if (!isAllowed(interaction.user.id)) return interaction.reply({ content: 'You are not allowed to run sub-agents.', ephemeral: true })
      const agentName = interaction.options.getString('agent')
      const prompt = interaction.options.getString('prompt')
      const rawTarget = interaction.options.getString('target') || null
      let target = null
      if (rawTarget) {
        try {
          target = sanitizeTarget(rawTarget)
        } catch (err) {
          await interaction.reply({ content: `Invalid target: ${err.message}`, ephemeral: true })
          return
        }
      }
      await interaction.deferReply()
      try {
        const session = await SessionManager.createSession({
          name: `subagent-${agentName}`,
          projectPath: target || '',
          owner: interaction.user.username,
          description: prompt
        })
        // mark pending and store metadata
        const s = await SessionManager.loadSession(session.id)
        s.status = 'pending-subagent'
        s.metadata = s.metadata || {}
        s.metadata.subagent = { agentName, prompt, projectPath: target }
        await SessionManager.saveSession(s)
        const targetNote = target ? ` target=${target}` : ''
        await interaction.editReply({ content: `Queued sub-agent request as session ${s.id}.${targetNote} Use /approve-subagent ${s.id} to approve and execute.` })
      } catch (e) {
        console.error('run-subagent error', e)
        await interaction.editReply('Failed to queue sub-agent: ' + (e && e.message ? e.message : String(e)))
      }
      return
    }

    // List pending sessions for easy copy/paste
    if (cmd === 'list-pending') {
      const all = await SessionManager.listSessions()
      const pending = all.filter(s => s.status === 'pending-subagent')
      if (!pending.length) return interaction.reply({ content: 'No pending sub-agent sessions.', ephemeral: true })
      const lines = pending.slice(0, 20).map(s => `- ${s.id} — ${s.name} — ${s.createdAt}`)
      return interaction.reply({ content: `Pending sub-agent sessions:\n${lines.join('\n')}`, ephemeral: true })
    }

    // Approve a queued sub-agent request (admin)
    if (cmd === 'approve-subagent') {
      const memberPerms = interaction.memberPermissions || (interaction.member && interaction.member.permissions)
      // Allow approval if the user has ManageGuild OR is explicitly allowed via BYPASS_APPROVE env var
      if (!(memberPerms && memberPerms.has(PermissionsBitField.Flags.ManageGuild)) && !canBypassApproval(interaction.user.id)) {
        return interaction.reply({ content: 'You need Manage Guild permission to approve sub-agents.', ephemeral: true })
      }
      let sessionId = interaction.options.getString('session')
      if (!sessionId) sessionId = 'latest'
      // support shortcuts: "latest" or short prefix of the id
      if (sessionId === 'latest' || sessionId === 'last') {
        const all = await SessionManager.listSessions()
        const pending = all.filter(s => s.status === 'pending-subagent')
        if (!pending.length) return interaction.reply({ content: 'No pending sub-agent sessions found.', ephemeral: true })
        // pick most recently created pending session
        pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        sessionId = pending[0].id
      } else if (sessionId.length < 8) {
        const all = await SessionManager.listSessions()
        const matches = all.filter(s => s.id && s.id.startsWith(sessionId) && s.status === 'pending-subagent')
        if (matches.length === 0) return interaction.reply({ content: `No pending sessions found matching prefix: ${sessionId}`, ephemeral: true })
        if (matches.length > 1) {
          const lines = matches.slice(0, 10).map(s => `- ${s.id} — ${s.name} — ${s.createdAt}`)
          return interaction.reply({ content: `Multiple pending sessions match prefix. Use a longer prefix or the full id:\n${lines.join('\n')}`, ephemeral: true })
        }
        sessionId = matches[0].id
      }
      await interaction.deferReply()
      try {
        const s = await SessionManager.loadSession(sessionId)
        if (!s) return interaction.editReply('Session not found.')
        s.status = 'approved-subagent'
        s.metadata = s.metadata || {}
        s.metadata.approvedBy = interaction.user.username
        s.metadata.approvedAt = new Date().toISOString()
        await SessionManager.saveSession(s)
        await interaction.editReply(`Approved sub-agent session ${s.id}. Executing now (whitelist: ALL).`)
        // kickoff execution in background
        executeSubagent(s).then(res => {
          if (res && res.ok) {
            try { interaction.followUp({ content: `Sub-agent ${s.id} finished. Output: ${res.outPath}` }) } catch (e) { /* ignore */ }
          } else {
            try { interaction.followUp({ content: `Sub-agent ${s.id} failed to execute: ${res && res.error}` }) } catch (e) { /* ignore */ }
          }
        }).catch(err => {
          console.error('Background executeSubagent error', err)
        })
      } catch (e) {
        console.error('approve-subagent error', e)
        await interaction.editReply('Failed to approve sub-agent: ' + (e && e.message ? e.message : String(e)))
      }
      return
    }

    // Skill commands
    if (!SKILL_NAMES.includes(cmd)) {
      // Not a managed skill command
      return
    }
    if (!isAllowed(interaction.user.id)) {
      return interaction.reply({ content: 'You are not allowed to use these commands.', ephemeral: true })
    }
    const target = interaction.options.getString('target') || ''
    await interaction.deferReply()
    // Create a session manifest to track this skill invocation
    const name = `${cmd} session`
    const owner = interaction.user.username || interaction.user.tag || interaction.user.id
    try {
      const session = await SessionManager.createSession({ name, projectPath: target, owner, description: `Invoked via /${cmd} by ${owner}` })
      await interaction.editReply(`Started session ${session.name} (${session.id}) for skill /${cmd}. Project/target: ${target || '<none>'}`)
    } catch (e) {
      console.error('Failed creating session for slash command', e)
      await interaction.editReply('Failed to create session: ' + (e && e.message ? e.message : String(e)))
    }
  } catch (err) {
    console.error('interaction handler error', err)
    try { if (interaction.deferred || interaction.replied) await interaction.editReply('Internal error handling command') } catch (e) { /* ignore */ }
  }
})

// Log and surface unexpected errors
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at Promise', p, 'reason:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception', err)
})

// report existing sessions at startup
SessionManager.listSessions().then(sessions => {
  console.log(`Loaded ${sessions.length} session(s) from sessions directory.`)
}).catch(err => {
  console.warn('Could not read sessions directory:', err && err.message)
})

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author?.bot) return
    const text = (msg.content || '').trim()
    if (!text.startsWith('!sessions')) return
    if (!isAllowed(msg.author.id)) {
      await msg.reply('You are not allowed to use session commands.')
      return
    }

    const parts = text.split(/\s+/).slice(1) // remove command
    const sub = parts[0]
    if (!sub || sub === 'help') {
      await msg.reply(helpText())
      return
    }

    if (sub === 'list') {
      const sessions = await SessionManager.listSessions()
      if (!sessions.length) return msg.reply('No sessions found.')
      const lines = sessions.map(s => `- ${s.name} (${s.id}) — ${s.status}`)
      return msg.reply(lines.join('\n'))
    }

    if (sub === 'create') {
      const name = parts[1]
      if (!name) return msg.reply('Usage: !sessions create <name> [projectPath]')
      const projectPath = parts[2] || ''
      const owner = msg.author.username
      const session = await SessionManager.createSession({ name, projectPath, owner })
      return msg.reply(`Created session ${session.name} (${session.id})`)
    }

    // Create a git feature branch and push it. Usage: !sessions branch <branch-name> [repoPath]
    if (sub === 'branch') {
      const branch = parts[1]
      const repoPath = parts[2] ? path.resolve(parts[2]) : process.cwd()
      if (!branch) return msg.reply('Usage: !sessions branch <branch-name> [repoPath]')
      // validate branch name: allow alphanum, dash, underscore and slashes
      if (!/^[-\w\/]+$/.test(branch)) return msg.reply('Invalid branch name. Use only letters, numbers, -, _, or /.')
      try {
        if (!fs.existsSync(repoPath)) return msg.reply(`Path does not exist: ${repoPath}`)
        // ensure it's a git repo by checking for .git
        const gitFolder = path.join(repoPath, '.git')
        if (!fs.existsSync(gitFolder)) return msg.reply(`Not a git repository: ${repoPath}`)
        const { stdout: status } = await execAsync('git status --porcelain', { cwd: repoPath })
        if (status && status.trim()) return msg.reply(`Repository has uncommitted changes in ${repoPath}; commit or stash before creating a branch.`)
        await execAsync(`git checkout -b ${branch}`, { cwd: repoPath })
        await execAsync(`git push -u origin ${branch}`, { cwd: repoPath })
        return msg.reply(`Created and pushed branch ${branch} in ${repoPath}`)
      } catch (e) {
        console.error('git branch error', e)
        return msg.reply(`Git error: ${e && e.message ? e.message : String(e)}`)
      }
    }

    if (sub === 'info') {
      const id = parts[1]
      if (!id) return msg.reply('Usage: !sessions info <id>')
      try {
        const s = await SessionManager.loadSession(id)
        return msg.reply('' + JSON.stringify(s, null, 2))
      } catch (e) {
        return msg.reply(`Session not found: ${id}`)
      }
    }

    if (sub === 'start' || sub === 'stop' || sub === 'delete') {
      const id = parts[1]
      if (!id) return msg.reply(`Usage: !sessions ${sub} <id>`)
      try {
        const s = await SessionManager.loadSession(id)
        if (sub === 'delete') {
          await SessionManager.deleteSession(id)
          return msg.reply(`Deleted session ${id}`)
        }
        s.status = sub === 'start' ? 'running' : 'idle'
        await SessionManager.saveSession(s)
        return msg.reply(`Session ${id} is now ${s.status}`)
      } catch (e) {
        return msg.reply(`Session not found: ${id}`)
      }
    }

    return msg.reply('Unknown subcommand. ' + helpText())
  } catch (err) {
    console.error('message handler error', err)
    try { await msg.reply('Internal error handling command') } catch (e) { /* ignore */ }
  }
})

if (NODE_ENV === 'test') {
  console.log('Safe mode: NODE_ENV=test — skipping Discord login (no external connection).')
  console.log('Bot initialized in safe/test mode — handlers are active but not connected.')
} else {
  client.login(TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err)
    process.exit(1)
  })
  console.log('Bot initialized — listening for `!sessions` commands.')
}
