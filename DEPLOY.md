# SIGNA — Deployment Guide

Two paths:

- **Phase 1 — ngrok** (5 min): share your local backend over the internet for demos
- **Phase 2 — Render.com** (30 min): free always-on hosting with a public URL

---

## Phase 1 — ngrok (share today)

### One-time setup
1. Sign up (free, no credit card): https://dashboard.ngrok.com/signup
2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
3. Register it locally:
   ```bash
   ngrok config add-authtoken <YOUR_TOKEN>
   ```

### Every time you want to share
Make sure your backend is running locally on port 3000 (`npm start` from `backend/`), then:
```bash
ngrok http 3000
```
ngrok prints a public URL like `https://abc-123.ngrok-free.app`. Share it. Works as long as your laptop + backend stay running.

**Gotcha**: free ngrok URL changes every restart. Upgrade ($8/mo) for a static subdomain — or use Phase 2 for permanent URLs.

---

## Phase 2 — Render.com (permanent free hosting)

### Prerequisites
- GitHub account
- Render.com account (free, no card)

### Step 1 — Push code to GitHub
From the project root:
```bash
cd "/Users/aharon.shahar/Documents/Claude/Projects/Signals_&_trends"
git init
git add .
git commit -m "Initial SIGNA commit"
# Create a new empty repo on github.com (don't init README). Then:
git remote add origin https://github.com/<YOU>/signa.git
git branch -M main
git push -u origin main
```
The `.gitignore` is already configured to skip `.env`, `node_modules`, and the SQLite files.

### Step 2 — Create Render Web Service
1. Go to https://dashboard.render.com → **New +** → **Web Service**
2. Connect your GitHub repo
3. Fill in:
   - **Name**: `signa` (becomes `https://signa.onrender.com`)
   - **Region**: pick closest to you
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### Step 3 — Environment variables (critical)
Under the "Environment" tab, add these (copy values from your local `backend/.env`):

| Key | Value |
|---|---|
| `MASSIVE_API_KEY` | `<your Massive key>` |
| `TWELVE_DATA_KEY` | `<your TwelveData key>` |
| `SIGNA_STRICT` | `1` |
| `WATCHLIST` | `AAPL,NVDA,TSLA,AMD,SOFI,AMZN,GME,MSFT,META,GOOGL` |
| `MARKET_SCAN_INTERVAL_MIN` | `5` |
| `SOCIAL_SCAN_INTERVAL_MIN` | `5` |
| `NODE_VERSION` | `20` |

Do **not** set `PORT` — Render injects it automatically.

### Step 4 — Deploy
Click **Create Web Service**. First build takes ~3 minutes. When green, your app lives at `https://signa.onrender.com`.

### Step 5 — Keep it awake (optional)
Render free tier sleeps after 15 min idle. To keep workers + cron alive:
1. Sign up at https://uptimerobot.com (free)
2. Add a new HTTP monitor:
   - **URL**: `https://signa.onrender.com/health`
   - **Interval**: 5 minutes
3. That's it. UptimeRobot pings every 5 min → service never sleeps.

---

## Post-deploy checklist

- [ ] Visit `https://signa.onrender.com` — dashboard loads
- [ ] `https://signa.onrender.com/health` returns JSON with `scanned > 0`
- [ ] `/api/market-regime` returns regime (first call takes ~3 min to compute)
- [ ] No Massive 429 errors in Render logs (check logs tab)

## Known caveats on free tier

1. **SQLite is ephemeral on Render free** — the DB file gets wiped on every redeploy. Signals rebuild within 5 min from live data, so it's okay. If you want persistence, attach a $1/mo disk or upgrade to Starter.
2. **Massive rate limit is 5 req/min globally** — if your public URL gets heavy traffic, everyone shares the same quota. For demo/personal use it's fine. Consider adding basic auth later.
3. **Cold starts** — if uptimerobot isn't set up, first visit after sleep takes 30–60s to respond while the service wakes + workers boot.
4. **Regime banner shows "computing" on cold boot** for ~3 min while 14 ETFs are throttled through the 13s queue. Subsequent visits are instant (30-min cache).

## Upgrade path

When you outgrow Render free:
- **Render Starter** ($7/mo): no sleep, 1GB disk, better performance
- **Fly.io 256MB VM + 1GB volume**: also free-forever if within limits, no sleep, persistent SQLite
- **Oracle Cloud ARM VM**: 4 cores / 24GB RAM free forever — full control, best long-term home

## Rollback

If a deploy breaks:
1. Render dashboard → Events tab → click any prior successful deploy → "Rollback"
2. Or revert the offending commit on GitHub; Render auto-redeploys
