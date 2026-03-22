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

## Development — Discord + gstack workflow

Use these steps to develop and test bot/session features and to run gstack flows against sibling repos (e.g. `../dmforge`).

1. Prepare `.env` (repository root):

  - `DISCORD_BOT_TOKEN` — bot token
  - `DISCORD_ALLOWED_USERS` — comma list of allowed tester user IDs
  - `DISCORD_BYPASS_APPROVAL_USERS` — same single user ID for testing (must also be in `DISCORD_ALLOWED_USERS`)
  - `DISCORD_TEST_GUILD_ID` — optional: your test guild ID for instant slash-command registration

2. Start the bot locally:

```bash
# from repo root
node index.mjs
```

3. Fast command registration (use test guild): set `DISCORD_TEST_GUILD_ID` then restart. Guild-scoped commands appear instantly.

4. Typical Discord test flow (in test guild):

- Queue a sub-agent: `/run-subagent agent:Explore prompt:"run quick repo check"`
- Approve (allowed/bypass user): `/approve-subagent session:<id>` — bot will execute and post output path.
- Create a feature branch for another repo: in any channel send `!sessions branch feature/my-change ../dmforge`

5. Run gstack QA flows (if you have gstack installed):

```bash
# quick smoke (navigate + screenshot)
gstack open https://localhost:3000
gstack screenshot /path/to/out.png

# run a QA script (example)
gstack run ./gstack/playbook.md
```

6. Sessions and outputs:

- Session manifests are stored in the `sessions/` directory as JSON files.
- Execution outputs are written to `sessions/<id>-output.txt`.

Notes
- Keep `DISCORD_BYPASS_APPROVAL_USERS` limited to a single test user and mirror that ID in `DISCORD_ALLOWED_USERS` for safety.
- Use `DISCORD_TEST_GUILD_ID` when iterating on slash commands to avoid global propagation delay.

If you want, I can add a `CONTRIBUTING.md` with more step-by-step gstack playbooks for sibling repos.
