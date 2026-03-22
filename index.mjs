#!/usr/bin/env node
/**
 * original-curse-killer — Discord → Claude Code channel bridge (MCP server)
 *
 * Architecture: This is NOT a standalone bot. It is an MCP channel server that
 * Claude Code spawns as a subprocess. Discord messages are forwarded into the
 * running Claude session as <channel> events; Claude replies via the `reply` tool.
 *
 * Start with:
 *   claude --dangerously-load-development-channels server:discord
 *
 * Or, once published to a marketplace:
 *   claude --channels plugin:discord@marketplace
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Client, GatewayIntentBits, Partials } from 'discord.js'
import fs from 'fs'
import path from 'path'

// ── .env loader (no extra deps) ────────────────────────────────────────────

try {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const eq = trimmed.indexOf('=')
      if (eq === -1) return
      const key = trimmed.substring(0, eq).trim()
      let val = trimmed.substring(eq + 1)
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    })
  }
} catch (_) {}

// ── Config ─────────────────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_BOT_TOKEN
const ALLOWED = (process.env.DISCORD_ALLOWED_USERS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

if (!TOKEN) {
  process.stderr.write('Missing DISCORD_BOT_TOKEN. Fill .env or set env var.\n')
  process.exit(1)
}

function isAllowed (userId) {
  return ALLOWED.length === 0 || ALLOWED.includes(String(userId))
}

// ── Routing tables ─────────────────────────────────────────────────────────
// Keyed by Discord channel ID; used by the reply tool to send messages back.

const channelCache = new Map()  // channelId  → discord.js Channel
const messageCache = new Map()  // messageId  → discord.js Message (for threading)

// ── Helpers ────────────────────────────────────────────────────────────────

/** Split text into Discord-safe chunks at paragraph boundaries when possible. */
function splitMessage (text, limit = 1900) {
  const chunks = []
  while (text.length > limit) {
    let cut = text.lastIndexOf('\n\n', limit)
    if (cut < limit * 0.5) cut = text.lastIndexOf('\n', limit)
    if (cut < 1) cut = limit
    chunks.push(text.slice(0, cut))
    text = text.slice(cut).replace(/^\n+/, '')
  }
  if (text.length) chunks.push(text)
  return chunks
}

// ── MCP server ─────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'discord', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions:
      'You are connected to Discord via the discord channel bridge. ' +
      'Inbound messages arrive as <channel source="discord" channel_id="..." ' +
      'author="..." message_id="...">. ' +
      'To respond, call the reply tool with the channel_id. ' +
      'Keep replies concise and chat-appropriate. ' +
      'You can pass message_id to reply_to for threading.',
  }
)

// reply tool — Claude calls this to send a message to Discord
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to a Discord channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The Discord channel ID to send to' },
          text:       { type: 'string', description: 'Message text (split automatically if > 1900 chars)' },
          reply_to:   { type: 'string', description: 'Optional message ID to thread the reply onto' },
        },
        required: ['channel_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`)

  const { channel_id, text, reply_to } = req.params.arguments ?? {}
  const ch = channelCache.get(channel_id)
  if (!ch) {
    return { content: [{ type: 'text', text: `channel ${channel_id} not in cache` }] }
  }

  const chunks = splitMessage(text || '')
  const replyTarget = reply_to ? messageCache.get(reply_to) : null

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0 && replyTarget) {
      await replyTarget.reply(chunks[i])
    } else {
      await ch.send(chunks[i])
    }
  }

  return { content: [{ type: 'text', text: 'sent' }] }
})

// ── Discord client ─────────────────────────────────────────────────────────

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
})

discord.once('ready', () => {
  process.stderr.write(`Discord ready: ${discord.user.tag}\n`)
})

discord.on('messageCreate', async (msg) => {
  try {
    if (msg.author?.bot) return
    if (!isAllowed(msg.author.id)) return

    const text = (msg.content || '').trim()
    if (!text) return

    // Cache channel and message for reply routing
    channelCache.set(msg.channelId, msg.channel)
    messageCache.set(msg.id, msg)

    // Show typing while Claude processes
    msg.channel.sendTyping().catch(() => {})

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: text,
        meta: {
          channel_id: msg.channelId,
          author:     msg.author.username,
          message_id: msg.id,
        },
      },
    })
  } catch (err) {
    process.stderr.write(`messageCreate error: ${err}\n`)
  }
})

// ── Start ──────────────────────────────────────────────────────────────────

// Connect to Claude Code over stdio (Claude Code spawns this as a subprocess)
await mcp.connect(new StdioServerTransport())

// Login to Discord
await discord.login(TOKEN)
