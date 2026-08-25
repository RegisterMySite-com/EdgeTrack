# EdgeTrack

**Privacy-first, Cloudflare-native web analytics** powered by a single Durable Object + SQLite, a zero-dependency tracker, and a modern React dashboard.

EdgeTrack runs entirely on the Cloudflare edge: ingestion, realtime active-visitor state, and historical analytics all live inside one Durable Object with SQLite storage. No third-party cookies, no external databases, and full GDPR-friendly controls (including one-click visitor data purge).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker                        │
│  ┌─────────────┐     /api/*      ┌───────────────────────┐  │
│  │ Static      │ ──────────────► │  Durable Object       │  │
│  │ Assets      │                 │  (App)                │  │
│  │ (dashboard, │                 │  • Hono router        │  │
│  │  tracker,   │                 │  • SQLite schema      │  │
│  │  demo)      │                 │  • Active sessions    │  │
│  └─────────────┘                 │  • Aggregates         │  │
│                                  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │ tracker.js (sendBeacon)            │ Dashboard (React)
         │                                    │
    Visitor browsers                     Your browser
```

**Key components**

| Piece | Location | Notes |
|-------|----------|-------|
| Worker entry + DO | `src/index.ts` | Hono routes, SQLite migrations, rate-limit, optional API-key auth |
| Tracker | `public/tracker.js` | < 8 KB pure JS, DNT/GPC, queue+retry, heartbeat, scroll, clicks |
| Dashboard | `public/index.html` | React 18 + Tailwind + Lucide (CDN), dark/light, keyboard shortcuts |
| Demo page | `public/demo.html` | Live embed test |

---

## Features

### Core analytics
- Real-time active visitors + live event stream (with country flags)
- Overview: visitors, pageviews, bounce rate, avg duration, devices, countries, trend chart
- Page-level metrics (time-on-page, scroll depth, exits)
- Visitor profiles + session timeline
- Engagement: scroll-depth funnel, top clicked elements
- Exit analysis

### Privacy & compliance
- Honors Do-Not-Track and Global Privacy Control by default
- First-party visitor ID only (cookie + localStorage)
- **GDPR purge**: one-click permanent deletion of a visitor's entire history
- Optional API-key protection for analytics endpoints
- Optional admin password lock for the dashboard API

### Production hardening
- CORS, per-IP + per-site rate limiting
- Request IDs + structured JSON logs
- Health endpoint (`GET /api/v1/health`)
- Resilient tracker (offline queue + retry when `sendBeacon` fails)
- Custom date-range picker (persisted in localStorage)

### Advanced (new)
- Funnel builder (path / event sequences)
- Weekly cohort retention table
- Alert rules + webhook endpoint
- Session recording ingest (DOM events only, auto-delete after 7 days)
- Shareable read-only dashboard links
- Dark / light theme + keyboard shortcuts (`1`–`5` tabs, `T` theme)

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Install Wrangler (if not global)
npm install -g wrangler
# or use npx

# 3. Authenticate
wrangler login

# 4. Start local dev (Durable Objects + assets)
wrangler dev
```

Open the printed URL (usually `http://127.0.0.1:8787`).  
- Dashboard: `/`  
- Demo tracker page: `/demo.html`  
- Health: `/api/v1/health`

---

## Deploy to Cloudflare (step-by-step)

1. **Install Wrangler**
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate**
   ```bash
   wrangler login
   ```

3. **Configure** – `wrangler.json` is already present with:
   - Durable Object binding `APP` → class `App`
   - SQLite migration for the `App` class
   - Static assets from `./public`
   - SPA-style not-found handling

4. **Optional secrets / vars**
   ```bash
   # Protect analytics endpoints with an API key
   wrangler secret put API_KEY

   # Optional admin password for dashboard API routes
   wrangler secret put ADMIN_PASSWORD
   ```

5. **Deploy**
   ```bash
   wrangler deploy
   ```

6. **Custom domain** (Workers & Pages → your worker → Settings → Domains)
   - Add a custom domain or use the `*.workers.dev` URL.

7. **Update tracker script URL** after deploy  
   In the dashboard **Settings** tab (or any page), copy the embed snippet – it automatically uses the current origin:
   ```html
   <script async defer data-site-id="YOUR_SITE_ID" src="https://your-worker.workers.dev/tracker.js"></script>
   ```

8. **Seed demo data & verify**
   - Open the dashboard → select the demo site → click **Seed Demo Data**
   - Or call:
     ```bash
     curl -X POST https://your-worker.workers.dev/api/v1/sites/et_live_demo/seed
     ```
   - Visit `/demo.html` with the tracker embedded and watch the Realtime tab.

---

## Environment variables / secrets

| Name | Type | Description |
|------|------|-------------|
| `ENVIRONMENT` | var | `"production"` / `"development"` (already set) |
| `API_KEY` | secret | When set, all `/api/v1/analytics/*` routes require `X-API-Key` or `Authorization: Bearer …` |
| `ADMIN_PASSWORD` | secret | Optional; protects non-public API routes |

---

## Privacy & GDPR notes

- Visitor IDs are first-party only and can be purged at any time via the dashboard or `DELETE /api/v1/analytics/visitors/:id`.
- The tracker respects `navigator.doNotTrack` and `navigator.globalPrivacyControl`.
- Session recordings (if enabled) store only DOM event metadata – never keystrokes – and auto-expire after 7 days.
- IP addresses are hashed before storage.
- No data is sent to third parties; everything stays inside your Cloudflare account.

---

## API surface (existing + new)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/beacon` | Tracker ingestion |
| GET | `/api/v1/realtime` | Active sessions + live events |
| GET | `/api/v1/analytics/overview` | Summary + chart (`range` or `start`/`end`) |
| GET | `/api/v1/analytics/pages` | Page metrics |
| GET | `/api/v1/analytics/visitors` | Visitor list |
| GET | `/api/v1/analytics/visitors/:id` | Visitor detail |
| **DELETE** | `/api/v1/analytics/visitors/:id` | **GDPR purge** |
| GET | `/api/v1/analytics/engagement` | Scroll funnel + top clicks |
| GET | `/api/v1/analytics/exits` | Exit analysis |
| GET | `/api/v1/analytics/export` | CSV / JSON export |
| GET | `/api/v1/analytics/retention` | Weekly cohort retention |
| GET/POST | `/api/v1/analytics/funnels` | Funnel CRUD |
| GET | `/api/v1/analytics/funnels/:id/results` | Funnel conversion |
| GET/POST/DELETE | `/api/v1/analytics/alerts` | Alert rules |
| POST | `/api/v1/analytics/alerts/webhook` | Incoming webhook receiver |
| POST | `/api/v1/sites/:id/share` | Create read-only share token |
| POST | `/api/v1/recordings` | Session recording ingest |
| GET | `/api/v1/health` | Health check |
| CRUD | `/api/v1/sites` | Site management + seed |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Durable Object class not found` | Ensure `migrations` block with `new_sqlite_classes: ["App"]` is present and you have run `wrangler deploy` at least once. |
| Tracker 404 | Confirm `public/tracker.js` is deployed (assets binding) and the embed `src` points to the correct origin. |
| Empty dashboard after seed | Hard-refresh; check `/api/v1/analytics/overview?site_id=et_live_demo`. |
| Rate-limit 429 | Default 180 req/min per IP+site; adjust in `checkRateLimit` if needed. |
| CORS errors | Origin is reflected; ensure preflight is allowed (already configured). |

---

## License

MIT – use it, fork it, ship it.
