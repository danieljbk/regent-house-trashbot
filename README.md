# Trash Duty

Automated trash duty rotation for a shared house. Cloudflare Worker handles scheduling and serves the API. Static dashboard on Cloudflare Pages shows the schedule and lets housemates report missed duties with PIN protection.

Trash day is **Tuesday**.

## Repository Layout

```
.
├── index.html            # Dashboard (Cloudflare Pages)
├── script.js             # Dashboard logic
├── style.css             # Styles (shadcn zinc dark theme)
└── worker/src
    ├── index.js          # Cloudflare Worker (cron + API)
    └── wrangler.toml
```

## Architecture

| Layer | What | Responsibilities |
|-------|------|-----------------|
| Cloudflare Worker | `worker/src/index.js` | Cron-triggered rotation, `/schedule` and `/report` API |
| Cloudflare KV | `ROTATION_DB` namespace | Stores `TEAM_MEMBERS`, `CURRENT_INDEX`, `PENALTY_BOX` |
| Cloudflare Pages | Static files | Dashboard at `trash.kwon.ai` |

## API

**`GET /schedule`** — Returns current rotation state: on-duty person, previous duty, full team, current index, penalty info.

**`POST /report`** — Files a missed-duty penalty. Requires JSON body `{ "pin": "<PIN>" }`. Returns 401 on wrong PIN, 400 on invalid body. Assigns the offender 3 consecutive Tuesdays of duty.

## KV Data Model

| Key | Description |
|-----|-------------|
| `TEAM_MEMBERS` | JSON array of `{ name }`. Index order = rotation order. |
| `CURRENT_INDEX` | Stringified integer pointing to the current duty person. |
| `PENALTY_BOX` | `{ offenderIndex, weeksRemaining }`. Present only during active penalty. |

## Dashboard

Plain HTML/CSS/JS, no build step. Key features:

- **Date badge** — shows today's date
- **Next duty** — who's responsible for the next Tuesday (shifts forward after Tuesday passes)
- **Previous duty** — who had the last Tuesday
- **Upcoming schedule** — next 4 Tuesdays with names
- **Rotation order** — full team list with active indicator
- **Report section** — collapsible, requires shared PIN to submit

The frontend derives all dates relative to Tuesday and uses a forward-looking model: after Tuesday passes (Wed–Sun), it automatically shows the next person on duty.

## Deployment

### Worker

```bash
cd worker/src
wrangler secret put REPORT_PIN
wrangler deploy
```

### Frontend

Cloudflare Pages auto-deploys from `main`.

### KV Setup

```bash
wrangler kv:key put --binding=ROTATION_DB CURRENT_INDEX "0"
wrangler kv:key put --binding=ROTATION_DB TEAM_MEMBERS '[{"name":"..."}]'
```

