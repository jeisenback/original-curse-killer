import fs from 'fs'
import path from 'path'
import https from 'https'

function loadDotEnv () {
  const p = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(p)) return {}
  const raw = fs.readFileSync(p, 'utf8')
  const out = {}
  raw.split(/\r?\n/).forEach(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const i = t.indexOf('=')
    if (i === -1) return
    const k = t.substring(0,i)
    const v = t.substring(i+1)
    out[k] = v.replace(/^"|"$/g, '')
  })
  return out
}

async function main(){
  const env = loadDotEnv()
  const token = env.DISCORD_BOT_TOKEN
  if (!token) { console.log('No token found in .env'); process.exit(2) }
  try{
    const opts = {
      hostname: 'discord.com',
      path: '/api/v10/users/@me',
      method: 'GET',
      headers: { Authorization: 'Bot ' + token }
    }
    await new Promise((resolve, reject) => {
      const req = https.request(opts, res => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          console.log('HTTP', res.statusCode)
          if (res.statusCode === 200) {
            try {
              const j = JSON.parse(data)
              console.log('Bot user:', j.username + '#' + j.discriminator)
            } catch (e) {
              console.log('Response parse error')
            }
          } else {
            console.log('Response:', data)
          }
          resolve()
        })
      })
      req.on('error', e => reject(e))
      req.end()
    })
  }catch(e){
    console.error('Request error:', e && e.message)
  }
}

main()
