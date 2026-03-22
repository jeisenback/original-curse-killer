# Discord Channel Service (template)

Lightweight scaffold for the Discord channel router service.

Purpose
- Run a single Discord bot that routes messages to per-project local webhook ports.

Quick start
1. Copy `.env.example` to `.env` and fill `DISCORD_BOT_TOKEN` and `DISCORD_ALLOWED_USERS`.
2. Install dependencies (optional): `npm install` (this template has no deps by default).
3. Run: `node index.mjs`

Environment
- `DISCORD_BOT_TOKEN` — required. Bot token from Discord Developer Portal.
- `DISCORD_ALLOWED_USERS` — comma-separated allowed user IDs (optional guard).
- `ROUTES_FILE` — path to routes JSON (default `routes.json`).

Webhook contract (POST /feature)
- JSON payload sent to local webhook endpoints:
  {
    "author": "username#1234",
    "project": "acme",
    "channelId": "123456789012345678",
    "channelName": "acme-dev",
    "content": "message text",
    "attachments": []
  }

Ports
- Each project maps to a unique local port (example `8791`). Ensure ports are free per concurrent instance.

Docker
- A `Dockerfile` is included; build with `docker build -t channels-discord .` and run with `docker run --env-file .env channels-discord`.

Routes example
- See `routes.sample.json` for mapping examples.

Next steps
- Implement `discord.js` logic in `index.mjs` or split into modules.
- Add tests, linter, and CI as needed.
