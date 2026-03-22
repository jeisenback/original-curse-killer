#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const ROUTES_FILE = process.env.ROUTES_FILE || 'routes.json'
const TOKEN = process.env.DISCORD_BOT_TOKEN
const ALLOWED = process.env.DISCORD_ALLOWED_USERS || ''

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN. Fill .env or set env var.');
  process.exit(1);
}

console.log('Discord channel service scaffold starting...')
console.log('ROUTES_FILE=', ROUTES_FILE)
console.log('DISCORD_ALLOWED_USERS=', ALLOWED || '<not set>')

// NOTE: This is a scaffold template. Add your discord.js implementation here.
// Example outline:
// import { Client, GatewayIntentBits } from 'discord.js'
// const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })
// client.on('messageCreate', (msg) => { /* route message to local webhook */ })
// client.login(TOKEN)

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

console.log('Scaffold ready — implement bot logic and npm start to run.')
