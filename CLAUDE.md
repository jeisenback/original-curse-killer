CLAUDE.md — original-curse-killer
=================================

Purpose
-------
This repository contains a small Node.js Discord-related utility extracted from `golden_boy_peanuts`.
This file documents the local developer startup checklist, agent operating rules, and gstack QA notes so an automated agent or a human contributor can pick up work safely.

Project context
---------------
- Runtime: Node.js >= 18 (see `package.json` `engines`)
- Entrypoint: `index.mjs`
- Config samples: `routes.sample.json`, `.env.example`
- Container: `Dockerfile` for local container runs

Session startup (do this every time — in order)
---------------------------------------------
1. Read `CLAUDE.md` (this file) and `README.md` to orient.
2. Copy `.env.example` to `.env` and populate secrets locally (never commit `.env`):
   - `cp .env.example .env`
3. Confirm branch and working tree are clean:
   - `git fetch origin --quiet`
   - `git status --porcelain` → must be empty
4. Read the active issue you will work on (`gh issue view <N>`).
5. Ensure tests (if added) pass locally before making changes.

Quick start (local)
-------------------
1. Install deps (if any added):

```bash
npm install
```

2. Run locally:

```bash
npm start
# or
node index.mjs
```

3. Docker (build + run):

```bash
docker build -t original-curse-killer:local .
docker run --env-file .env -p 3000:3000 original-curse-killer:local
```

Gstack / QA notes
------------------
- This project is small; use `gstack` for browser-driven checks or endpoint dogfooding if you expose webhooks or HTTP routes.
- Recommended quick checks to add to a `.gstack/` playbook:
  - Verify the app starts and responds on the expected port
  - If there are public endpoints, visit them and assert 200 responses
  - If the bot uses OAuth/webhooks, run a form-driven flow to ensure signature verification works

I can add a starter `.gstack/playbook.md` with commands and assertions — tell me which endpoints or flows to exercise.

Agent operating rules (for automated agents)
-------------------------------------------
- Ask before making large changes (new dependencies, schema changes, or public API changes).
- Do not commit secrets or private keys. `.env` must never be committed.
- For this repo, prefer small, well-scoped changes with tests where applicable.

Decision authority (guidelines)
-------------------------------
- | Area | Agent Can Decide | Must Ask Human |
- |------|------------------|----------------|
- | Implementation approach | internal refactor, helper extraction | add new public API or change existing interface |
- | Dependencies | use existing packages | add new dependency (human must approve) |
- | Commits & Branches | author commits, follow format | merge to `main` or `develop` (human only) |

Before-you-code checklist
-------------------------
- Read the issue and acceptance criteria fully.
- Ensure working tree is clean and on the correct branch.
- Run local checks (`npm start`, tests) and reproduce the problem before fixing.

Git rules (simple)
------------------
- Branches: create feature branches from `main` (or `develop` if you use it):

```bash
git checkout -b feature/<issue>-short-desc main
```

- Commit message guideline: `<type>(<scope>): <description> (#<issue>)` e.g. `fix(bot): handle missing token (#12)`
- Open a PR for review; do not merge to `main` without human approval.

Hard stops (do not proceed without human approval)
-----------------------------------------------
- NEVER commit secrets or `.env` to the repository.
- NEVER add packages without human approval.
- NEVER push direct to `main` or `develop` without a reviewed PR.

Session end protocol
--------------------
1. Commit all work and ensure `git status` is clean.
2. Run local checks one more time (`npm start`, tests).
3. Push branch and open a PR describing changes and linking the issue.

Reference map
-------------
- Entrypoint: `index.mjs`
- Config sample: `routes.sample.json`
- Docker: `Dockerfile`
- Package manifest: `package.json`

If you'd like, I can:
- Pull the original `CLAUDE.md` verbatim from `jeisenback/golden_boy_peanuts` and include any additional sections you want preserved.
- Add a starter `.gstack/playbook.md` that runs basic smoke tests and records assertions.

