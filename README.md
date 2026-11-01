# Kantor Kita

**English** · [Bahasa Indonesia](README.id.md)

Kantor Kita is an interactive 3D office that runs in the browser, backed by a small local task server. Team members appear as characters in a four-floor building, tasks move across a kanban board, and members connected to an AI agent pick up and draft their own work while the owner reviews and approves the results. It runs on Node.js with no framework and no build step. The interface is mainly in Indonesian.

This repository is a fork of the original Kantor Kita project by Kangkung Mozzarella, extended by [@torpedoliar](https://github.com/torpedoliar) with an organization model, hierarchical AI delegation, application jobs, multi-provider settings, and operations tooling.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.160-000000?logo=threedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/tests-Playwright-2EAD33?logo=playwright&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [How work flows](#how-work-flows)
- [Data and synchronization](#data-and-synchronization)
- [Operations](#operations)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Security notes](#security-notes)
- [Full guide](#full-guide)
- [License and credits](#license-and-credits)

## Features

### The 3D office

- A building with a barbershop and parking garage on floor 1, a kitchen on floor 2, the open-plan workspace on floor 3 (meeting room, phone booths, pantry and lounge, prayer room), and a rooftop garden on floor 4. Extra work floors are generated when the organization has many divisions.
- Whole-building view with a glass stair tower, a city block with roads, traffic, trees, and other buildings, and animated camera transitions between the building and a single floor.
- Graphics levels from Low to Ultra: photo textures, shadows, HDRI reflections, ambient occlusion, and bloom, chosen automatically from the GPU and changeable at runtime. Furniture and people use CC0 models (Poly Haven, Kenney, MakeHuman), with simple fallbacks if a model fails to load.
- Characters walk, sit at their desks, chat, take calls, eat, pray, and use the rooftop on their own routines. Doors open automatically, and first-person and follow cameras are available.
- Time-of-day moods, animated desk monitors, and generated background music through Web Audio.
- Room editor: add rooms from templates, drag them on a 2D floor plan, place catalog furniture, and assign private offices to owners.

### Tasks and organization

- Kanban board with the columns Tugas, In progress, Review, and Selesai, plus a workflow graph and an event console.
- Organization chart with divisions, leads, and reporting lines. Drag cards to change managers, link divisions for collaboration, and edit each member's profile, effort level, workload capacity, and agent instructions.
- A seven-step setup wizard for new installations: PIN, company profile, template, divisions, people, AI agents, and a summary with floor plan previews.
- Owner actions (approving work, changing the organization, resets) require an owner PIN session.

### AI agents

- Members connected to an agent work their own tasks: queued, in progress, then needs review. The owner approves the draft or requests a revision with comments; earlier drafts stay in the draft history. Agents never publish anything themselves.
- In automatic mode, the director splits a task across division leads, and leads with AI staff split it again, up to three levels deep. Each result is reviewed by whoever delegated it, and only the main task reaches the owner.
- Questions from members go to their lead first; the lead escalates to the owner only for budget, scope, or final business decisions.
- Per-agent memory of up to 20 short notes, created only after the owner approves work.
- Anthropic-compatible and OpenAI-compatible providers, a fallback model, provider cooldown and retries, and streamed drafts for OpenAI-compatible providers. Provider credentials are encrypted on the server.
- Without an API key the server runs in a clearly labeled dry-run mode.

### Application jobs

- "Aplikasi" tasks produce immutable source revisions. The owner reviews the source and commands and approves a test run for that exact revision hash.
- Jobs run either locally on Windows (with an explicit risk acknowledgment, because it is not a sandbox) or in a locked-down Docker container: non-root, read-only source, no network by default, and CPU, memory, and PID limits.
- Review requires a passing exit code, matching non-skipped TAP cases, the same revision hash, and an HTTP smoke check. Static web previews run in a sandboxed iframe on a separate loopback port.

## Quick start

### With the task server (recommended)

Requirements: Node.js 22 or newer.

```sh
cp .env.example .env    # optionally set ANTHROPIC_API_KEY
npm start               # or: node server/server.js
```

Open http://127.0.0.1:3000. On Windows you can double-click `start.bat`, which starts the server and opens the browser when it is ready.

### Static, without the server

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Open http://127.0.0.1:4173. Tasks are then kept in the browser's localStorage. Three.js is bundled in `public/vendor/three/`, so only the Google Fonts request needs the internet; without it the office uses system fonts.

## Configuration

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Provider key. Empty means dry-run mode |
| `ANTHROPIC_BASE_URL` | Provider base URL. Default `https://api.anthropic.com`; a local Anthropic-compatible router also works |
| `ANTHROPIC_MODEL` | Fallback model when a member has no model selected |
| `PORT` | Server port on 127.0.0.1 (default 3000) |
| `KANTOR_SETTINGS_KEY` | 32-byte key (base64 or hex) for encrypted Settings credentials. If unset, `data/settings.key` is generated once; back it up |
| `KANTOR_RUNNER_IMAGE` | Pre-installed Docker image for application jobs (default `node:22-alpine`). The server never pulls images |
| `KANTOR_RETRY_DELAYS_MS`, `KANTOR_SYNTH_ATTEMPTS`, `KANTOR_SYNTH_RETRY_DELAYS_MS` | Retry behavior for transient provider failures |
| `KANTOR_DECISION_SLA_MS` | How long a decision waits before one reminder (default 15 minutes) |
| `KANTOR_KEEP_REVISIONS`, `KANTOR_JOB_MAX_AGE_DAYS` | Project retention (default 20 revisions, 30 days of job output) |

Provider and model routing can also be configured in the app under Settings.

## How work flows

1. The owner creates a task and assigns it, or assigns a large task to a division lead.
2. In automatic mode, leads plan and delegate through the organization; in direct mode, the assignee works it alone.
3. Agents draft results; humans fill in results for members without an agent.
4. Managers below the top level review their staff's drafts first, then the owner reviews.
5. Approved work goes to Selesai. A revision request sends it back to the queue with the comments.

Each task has its own conversation thread with owner, agent, and system messages, and decision cards for questions that need an answer.

## Data and synchronization

With the server, tasks, conversations, decisions, events, projects, and jobs are stored transactionally in `data/workspace.json`. Only `data/rooms.json` is tracked in git, so the room layout can be shared between machines with a normal pull and push. The organization and PIN (`data/org.json`), agent configuration, projects, provider credentials, and `settings.key` stay local.

`GET /api/workspace/export` produces an owner archive, and `POST /api/workspace/import` (owner only) replaces the workspace after archiving the old one.

## Operations

```sh
npm run backup                                        # copy data/ to data/backups/<time>/ with SHA-256 manifest
npm run doctor                                        # check every state file without starting the server
npm run restore -- --backup data/backups/<time> --yes # verify checksums, snapshot, then restore
```

On startup, corrupted JSON files are archived and the latest `data/last-good` snapshot is used; if none exists, the server runs in a degraded mode and reports it. `GET /api/health` and `GET /api/ready` are open for supervisors. `data/.lock` prevents two servers from using the same data folder.

## Testing

```sh
npm test               # every test file in sequence
npm run test:unit      # pure Node tests, no browser needed
npm run test:ui        # browser tests (needs npm install once for Playwright)
npm run test:smoke     # quick UI subset used in CI
npm run check          # node --check on all first-party JavaScript
npm run test:docker    # Docker runner tests; set RUN_DOCKER_TESTS=1 for live runs
```

Tests use a temporary data directory and a local mock provider, so they never touch live tasks or spend provider tokens. `.github/workflows/ci.yml` runs the static check and unit tests on Linux and Windows, then the UI smoke tests on Windows.

## Project layout

```
public/
  index.html          page structure, rail, drawers, 3D canvas
  office.js           3D building, movement, camera, furniture, task integration
  graphics.js         graphics levels and render pipeline
  org-model.js        pure organization logic (moves, leads, seating)
  org-chart.js        organization chart and side panel
  org-wizard.js       setup wizard and full reset
  tasks.js            tasks, validation, storage, export
  task-workspace.js   board, workflow graph, console
  messenger.js        task conversations and decisions
  settings.js         Settings dialog
  assets/             CC0 textures, models, HDRI (see assets/LICENSES.md)
  vendor/three/       bundled Three.js
server/
  server.js           static files, task and Settings API, agent worker
  providers.js        Anthropic-compatible and OpenAI-compatible transports
  settings.js         provider routing and encrypted credentials
  agents.js           seed list of agent-connected members
scripts/              backup, restore, doctor, check, asset preparation
tests/                unit and browser tests, suite runner
data/rooms.json       shared room layout
```

## Security notes

- The server has no login yet, so it listens only on 127.0.0.1. Do not expose it to a network before authentication is added.
- Settings changes require a same-origin session with a CSRF token. Credentials are never stored in localStorage, exports, responses, or task files.
- Local Windows application jobs are not sandboxed and run with your account's access. Prefer the Docker runner.
- Never share `data/settings.key`; without it stored provider credentials cannot be decrypted.

## Full guide

The complete Indonesian guide, covering every control, simulation detail, and test file, is in [docs/PANDUAN.md](docs/PANDUAN.md). Development notes and the change review are in [REVIEW.md](REVIEW.md) and `docs/superpowers/`.

## License and credits

Released under the [MIT License](LICENSE). Copyright © 2026 Kangkung Mozzarella, original author of Kantor Kita. Fork extensions by Yohanes Octavian Rizky ([@torpedoliar](https://github.com/torpedoliar)).

3D assets are CC0; sources and authors are listed in `public/assets/LICENSES.md`.
