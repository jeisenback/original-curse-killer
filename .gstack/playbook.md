Playbook: original-curse-killer (smoke checks)
=============================================

1) Start the app (local)

```bash
npm start &
sleep 1
```

2) Verify process started and port (if app binds a port)

```bash
ps aux | grep node
# or, if app listens on 3000, use curl
curl -sS http://localhost:3000/ || echo "no response"
```

3) If `routes.json` or `routes.sample.json` exists, load and validate JSON

```bash
node -e "JSON.parse(require('fs').readFileSync('routes.json','utf8')); console.log('routes OK')" 2>/dev/null || echo 'no routes.json'
```

4) If Discord bot token is missing, assert the env var is absent and warn

```bash
node -e "if(!process.env.DISCORD_BOT_TOKEN) console.warn('DISCORD_BOT_TOKEN missing')"
```

5) (Manual) Run Discord command smoke tests once bot dependency approved and bot is running.

Notes
-----
This is a starter playbook. If you want automatic browser-driven checks or OAuth/webhook flows, tell me which endpoints to exercise and I will add scripted `gstack` steps.
