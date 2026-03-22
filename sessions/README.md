Sessions
========

This folder contains filesystem-backed session manifests used to track and manage
Claude-agent sessions for different projects.

Session file format (JSON) - minimal example:

{
  "id": "<uuid>",
  "name": "Project workspace",
  "projectPath": "c:/tools/my-project",
  "owner": "alice",
  "description": "Optional notes",
  "createdAt": "2026-03-22T...",
  "status": "idle|running|paused",
  "metadata": { }
}

The Node helper at `lib/sessionManager.mjs` provides simple CRUD operations.

Discord integration
-------------------
The eventual Discord bot (user-facing) should expose commands to:

- `/sessions list` — list active sessions
- `/sessions create name:<name> project:<path>` — create a new session
- `/sessions info id:<id>` — show details for a session
- `/sessions start id:<id>` — mark session running / connect agent
- `/sessions stop id:<id>` — mark session idle / disconnect agent

Note: Adding `discord.js` as a dependency requires human approval per the
repo `CLAUDE.md` rules. The current codebase contains a scaffold at `index.mjs`
where the bot logic can be added once dependency changes are approved.
