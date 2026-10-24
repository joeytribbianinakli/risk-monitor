# AI Investment Risk Lab — GitHub Pages + Cloudflare Worker + D1 + Telegram

**Build date:** October 2026. **Purpose:** evidence-based risk monitoring and portfolio decision support — NOT automated trading, and NOT a crash predictor.

This package preserves the original dashboard's sections (overview, urgent alerts, full 22-indicator checklist, portfolio stress, trim/risk budget, valuation, trend signals, investment policy, decision journal, research) and adds **Live monitor**.

## Architecture and storage

```text
GitHub Pages (public static index.html)
   │  HTTPS + private bearer token, allowed origin only
   ▼
Cloudflare Worker  ──► Cloudflare D1 database
   │                     ├─ full dashboard state (fields, 22 indicators, 6 urgent cards, journal)
   │                     ├─ automated source checks / dated observations
   │                     ├─ status-change + manual-checkbox event history
   │                     └─ run logs + SEC polling cursors
   ├─ FRED (requires free API key): NASDAQ100, VIXCLS, BAMLH0A0HYM2, DFII10
   ├─ SEC EDGAR (keyless, identify your application): filings + company annual XBRL facts
   ├─ Finnhub (optional free key): QQQM, QQQ, SMH, NVDA, MSFT quotes
   └─ Telegram Bot API: private Telegram notifications
```

**Yes, Cloudflare stores your data.** D1 (a SQLite-based managed database) is the primary store. This is preferable to committing a JSON file back to a GitHub repository: public GitHub Pages would expose private investment data, while secure automatic commits require elevated GitHub permissions and can suffer conflicting writes. A JSON download remains available as a portable backup. Dashboard localStorage remains as a fallback when the Worker is unreachable.

As of October 2026 Cloudflare D1's free plan includes up to **5 million rows read/day**, **100,000 rows written/day**, and **5 GB across free D1 databases**, with **500 MB per database**. These limits can change; check current docs. D1 Free has finite CPU/query/request budgets, so schedule heavy tasks conservatively. A normal personal dashboard is unlikely to approach the row quotas, but **nothing is guaranteed free forever**. Sources: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/d1/platform/limits/

## 1. Prerequisites

- Cloudflare account (free tier), Node.js, npm.
- A GitHub repository for GitHub Pages (public website).
- Free FRED API key: https://fred.stlouisfed.org/docs/api/api_key.html
- Optional Finnhub key: https://finnhub.io/ (free quote endpoint entitlements vary).
- Telegram account and Telegram bot, via Telegram's **@BotFather**.
- A working contact email to identify yourself to SEC EDGAR — SEC data requires an honest User-Agent and can reject access when policies are not followed.

Never place **FRED_API_KEY, FINNHUB_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DASHBOARD_TOKEN** in GitHub Pages HTML, GitHub repository, or publicly shared messages. Put them in Worker secrets.

## 2. Connect Cloudflare D1 (required binding: `DB`)

**If you already created the database and deployed your Worker, do not create another database.** In your current setup the existing D1 database is named **`risk-monitor-db`**. The database name can vary, but the **Worker binding (variable name) must be exactly `DB`** because the application code calls `env.DB.prepare(...)`.

These are **different** settings:

| Setting | Your current setup | Why it matters |
|---|---|---|
| D1 database name | `risk-monitor-db` | The persistent database containing your records |
| Worker binding / variable name | **`DB`** (case-sensitive) | Makes the database accessible to code as `env.DB` |
| Previous binding name | `risk_monitor_db` | Does **not** satisfy `env.DB` and caused `Cannot read properties of undefined (reading 'prepare')` |

### Existing deployed Worker: Cloudflare dashboard method

1. Open **Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Bindings → Production** (menu labels can differ).
2. Select **Add binding → D1 database**.
3. Set **Variable name / Binding name** to **`DB`** (uppercase).
4. Select the **existing** database **`risk-monitor-db`**. Do not create a replacement database.
5. Click **Deploy** to apply the binding.
6. Once the dashboard connects successfully, you may remove the obsolete `risk_monitor_db` **binding** if it is unused. **Never delete the underlying database** just to remove a binding.

Cloudflare's edit panel may show only the database selector, not an editable binding name. In that case, **add a new `DB` binding** rather than attempting to rename the old one.

### Wrangler configuration (important for future deployments)

If you deploy from a local `worker` project, configure the same binding in `worker/wrangler.jsonc` so future deployments do not overwrite the dashboard configuration. The relevant section should resemble:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "risk-monitor-db",
    "database_id": "YOUR_EXISTING_D1_DATABASE_UUID"
  }
]
```

Use the **actual UUID** shown for `risk-monitor-db` in Cloudflare; do **not** create a new database or substitute the example UUID. If `wrangler.jsonc` contains `"binding": "risk_monitor_db"` or any other name, change **only the binding** to `DB`, while retaining the correct database name and UUID. Keep that change in source control.

For a **brand-new installation only**, from the `worker` folder:

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create risk-monitor-db
```

Copy the returned D1 UUID to `worker/wrangler.jsonc`, setting `binding` to `DB` and `database_name` to `risk-monitor-db`. If you've already created `risk-monitor-db`, **skip this creation command**.

Set the application variables in `worker/wrangler.jsonc`:

```json
"APP_ORIGIN": "https://YOUR-USERNAME.github.io",
"SEC_USER_AGENT": "AI Risk Monitor Your Name your-real-email@example.com"
```

- `APP_ORIGIN` must be the **origin** of your GitHub Pages URL (no trailing slash or `/REPOSITORY`). If you use a custom domain, supply its origin instead. This restricts browser cross-origin access; the private token is still required for authentication.
- Use your real application/contact identity for `SEC_USER_AGENT`; replace the example.
- Optionally edit `SEC_SYMBOLS` to follow relevant companies. Supported CIKs are MSFT, AMZN, GOOGL, META, NVDA, AVGO, ORCL, CRWV (at most 10).

**Apply database migrations** from the `worker` folder **once the Wrangler database configuration points to your existing D1 database**:

```bash
npx wrangler d1 migrations apply risk-monitor-db --remote
```

This uses your configured database name. If an older package still has `database_name: "ai-risk-monitor-db"`, first update it to your actual name and UUID. Migrations create missing application tables; they are separate from configuring the binding. If your tables are already present and migrations have been recorded, Wrangler skips completed migrations.

**Troubleshooting connection errors**

| Error | Likely cause | Corrective action |
|---|---|---|
| `Cannot read properties of undefined (reading 'prepare')` | Missing or misnamed `DB` binding | Add/verify production D1 binding `DB` → `risk-monitor-db`, then deploy; match Wrangler config |
| `no such table: ...` | D1 is bound, but database schema has not been migrated | Run the migrations command against the **same** existing database |
| `Unauthorized` / HTTP 401 | Wrong `DASHBOARD_TOKEN` | Ensure HTML token matches your Worker secret; don't post it publicly |
| Browser CORS / origin error | `APP_ORIGIN` doesn't match the Pages origin | Configure the exact origin, without the repository path |

After configuration, open the GitHub Pages dashboard → **Live monitor**, enter your Worker URL and dashboard token, then **Connect & refresh**. If connecting from the same browser that holds existing local dashboard inputs, follow the on-screen choice to save local data to D1 or load cloud state; avoid overwriting the cloud version unintentionally.

## 3. Add Worker secrets

From the **worker** folder:

```bash
npx wrangler secret put DASHBOARD_TOKEN
npx wrangler secret put FRED_API_KEY
npx wrangler secret put FINNHUB_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

`FINNHUB_API_KEY` is optional. You can omit Finnhub and the other feeds still function. Telegram requires both bot token and chat ID. **Generate** the dashboard token locally with `openssl rand -hex 32` or another cryptographically secure generator; use its result as DASHBOARD_TOKEN, and keep it out of git. DO NOT use a short or reused password.

### Telegram setup

1. In Telegram, open **@BotFather**, create a bot, copy the bot token (do not share).
2. Open your own bot chat and send `/start` or a normal message.
3. Look up the `chat.id` associated with your message from the Telegram Bot API `getUpdates` response (private 1:1 chat ID) or obtain it through a trusted Telegram chat-ID helper. `getUpdates` requires the private bot token — don't paste the URL publicly.
4. Enter the token and chat ID using the `wrangler secret put` commands.
5. After deployment, open the dashboard's **Live monitor** and click **Send Telegram test**.

Notifications:

- New automatic **Watch/Serious**, and transitions back to **Clear**.
- A **new SEC 8-K/10-Q/10-K** or equivalent watched filing, after a first-run baseline (new filing DOES NOT automatically mean bad news).
- Manual 22-indicator checkbox changes (`Watch`, `Serious`, `Clear`, `Unknown`), and 6 urgent-card check/review/clear transitions after the first cloud state exists.
- Source failure/recovery via the `Data provider health` check, and optional run digests.

**No Telegram notification** is sent for merely typing evidence notes; that avoids unnecessary spam. You may change `CHECKIN_MODE` in Wrangler from `changes` to `daily` (default: one evidence digest per market-check day) or `always` (summary after every scheduled run), or `off` (only status transitions/new filings/manual changes). `changes` sends change-related messages and a check-in summary on source/trigger changes.

## 4. Deploy the Worker

```bash
npx wrangler deploy
```

Copy the deployed HTTPS Worker URL, e.g. `https://ai-risk-monitor.YOUR-SUBDOMAIN.workers.dev`.

### Scheduled checks (Cloudflare Cron, UTC)

Configured in `worker/wrangler.jsonc`:

| Cron | What it does | Important limitation |
|---|---|---|
| `25 12 * * MON-FRI` | FRED Nasdaq-100 50/200-session SMA, 5/20-day decline, VIX, high-yield spread, real yield; daily evidence digest | FRED is daily published information; often updates with delay |
| `15 * * * MON-FRI` | Optional Finnhub quotes hourly; SEC filings: poll a rotating subset of four issuers every four hours (up to eight issuers covered in roughly eight hours) | Finnhub entitlements/rate limits vary; SEC polling is not instant and a full watchlist may take eight hours to revisit |
| `40 12 * * MON` | SEC companyfacts annual cash-flow and PP&E capex context, rotating one of MSFT/AMZN/GOOGL/META per week | Whole-company **annual** cash-flow facts, not AI-specific ROI |

**Important:** the check schedule uses UTC, including across Toronto daylight-saving changes. Cloudflare may take several minutes to activate or update Cron Triggers. Hourly checking is NOT reliable intraday Nasdaq breadth or full real-time quote coverage. Telegram delivery depends on Cloudflare scheduled executions, the source being available, and Telegram acceptance.

Cloudflare Cron docs: https://developers.cloudflare.com/workers/configuration/cron-triggers/

## 5. Publish to GitHub Pages

Your repository should contain the **top-level `index.html`** from this package. One simple approach:

1. Create a public GitHub repository (for example, `ai-investment-risk-lab`).
2. Commit/upload **only `index.html`** to its root; optionally `README.md` without secrets. You can also put the Worker code in the repo provided all keys stay in Worker secrets and config files contain no real secrets.
3. GitHub repository **Settings → Pages → Deploy from a branch**; choose `main` and root `/`.
4. Visit `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.
5. Open **Live monitor**, paste your Worker URL and `DASHBOARD_TOKEN`, and click **Connect & refresh**.
6. Choose **Save local data to D1** the first time (or **Load cloud data** on a new device). Then autosync is enabled after a successful save.

The secret token is stored only in browser **sessionStorage** (in the current tab/session), not in the published HTML or localStorage. The Worker URL is saved in localStorage. Treat your dashboard token like a password; it grants read/write access. Avoid using the dashboard on untrusted devices, and revoke a leaked token by updating the Worker secret.

## 6. Data safety & sync

- **Cloud data:** `user_state` table stores the complete dashboard `state` JSON and an integer revision. The Worker uses optimistic concurrency control; if another device has updated it, saves return HTTP 409 rather than overwriting newer data.
- **Local fallback:** the original localStorage data remains available even if Cloudflare is offline; it is NOT automatically deleted.
- **Manual updates:** after cloud sync is active, checking or clearing a signal auto-saves the state, records the transition in D1, and Telegram announces the change (if configured).
- **Cloud monitoring:** live checks, automatic alerts, SEC notices, run logs and the full dashboard remain in D1 and are accessible to other authorized devices.
- **Retention:** events and run logs are retained indefinitely (no automatic deletion by the app); manual dashboard state persists until you overwrite it or delete D1. The live UI shows the latest 100 events, but the **Download full cloud history** button exports all events and run logs with pagination.
- **Backups:** original dashboard JSON export/import continues to work; export periodically (private file). D1 free database has limited point-in-time recovery; JSON backups are still wise.
- **No GitHub writes:** GitHub Pages hosts static HTML; the Worker never needs a GitHub personal access token.

### Manual check API

The frontend supports buttons for independent `market`, `sec`, and `fundamentals` runs. They are rate-limited per category to once every five minutes. Authenticated API routes are:

- `GET /api/ping`
- `GET /api/overview`
- `GET /api/user-state`
- `PUT /api/user-state` with `{revision, state}`
- `POST /api/check` with `{scope:"market"|"sec"|"fundamentals"}`
- `POST /api/test-telegram`
- `POST /api/override` with `{key,status,note}`, where `status` is `clear`, `watch`, `serious`, `review`, or `automatic` to remove the override; a reason is required when overriding.

All require the bearer token. CORS allows only your specified GitHub Pages **origin**.

### Manual overrides / automated reasoning notes

Each live source card displays the original computed `SOURCE` status, the dated observation, specific numerical evidence, and a link to the primary series or filing feed. You can set a separate `YOU` status (`Clear`, `Watch`, `Serious`, `Review`) and provide a required reason. The override **does not overwrite or disable the original source signal**. New source changes still trigger Telegram. Applying, changing, or removing an override sends a separate change event (subject to Telegram delivery).

The built-in **Monitoring coverage** guide labels every one of the 22 checklist indicators as **Automated**, **Partial**, or **Manual**, with justification. All 22 manual judgment fields remain editable. A `Clear` from one numerical metric must not be mistaken for complete proof that the higher-level business thesis is sound.

## 7. Exactly what is automated

| Indicator / event | Implementation | Accuracy caveat |
|---|---|---|
| T1 · Nasdaq trend | Full automated **NASDAQ-100 index** 50/200 trading-session SMA and 200-day direction | Index proxy **not** QQQM ETF; no distribution adjustment |
| A3 · Rapid selloff | Automated 5- and 20-session Nasdaq-100 drawdown alerts | Thresholds are illustrative, not empirically calibrated forecasts |
| S2 · VIX stress | Automated latest FRED VIXCLS stress bands | VIX can spike after stocks fall |
| M1 · HY credit stress | Automated FRED US high-yield OAS vs lowest observed level in ~183 days | Spreads may lag; credit series not instant |
| S1 · Nasdaq-100 14-week RSI context | Weekly RSI from FRED index closes; never automatically checks a divergence or sells | Index rather than QQQM, incomplete current week may distort RSI |
| M2 · Real yield | Automated numerical observation only | No automatic good/bad rating from real yield alone |
| SEC filing watch | Rotating watch of 8-K/10-Q/10-K and equivalents for named CIKs | Signals **new information**, not whether financial guidance worsened |
| F2/V2 · Fiscal cash flow | Rolling weekly XBRL annual cash flow for one issuer at a time (MSFT, AMZN, GOOGL, META), to limit Worker CPU cost | Total company not AI-specific and not ROIC; 10-K annual periods |
| Finnhub (optional) | Latest quotes & single-session move for QQQM, QQQ, SMH, NVDA, MSFT | Endpoints/quoting rights depend on free key; watch for large daily moves only |
| Manual checks | Persisted status transitions + Telegram checked / cleared changes | Notes are human input, not verified evidence |

**Not safely automatable from these free sources alone:** true Nasdaq-100 breadth, reliable historical SMH/QQQ total-return spread, 14-week adjusted-QQQM RSI/divergence (a Nasdaq-100 index RSI contextual proxy is included), company-level quarterly consensus estimate revisions, AI-specific marginal returns on capital, management guidance interpretation, power procurement, circular financing contracts, customer commitments, and your actual holdings/ETF look-through. These remain manual or contextual. They are NOT auto-checked as clear.

OANDA is not connected in this version: its APIs focus on foreign-exchange/brokerage data, which are not a dependable primary source for US Nasdaq index internals or AI company fundamental disclosures. Adding a provider just to increase the count of sources would reduce clarity rather than reliability.

## 8. Audit trail / error handling

- Each check shows **source, observation date, specific rule, calculated values and a written reason**, not just the time your Worker fetched it. Automated checks keep their source status even when manually overridden; the original evidence is never erased.
- FRED/quote observations older than six calendar days are treated as **source problems**, not an all-clear.
- A provider error never automatically resets a risk flag to Clear; the data-health check can become Watch.
- Automatic alerts are based on a status transition, not every repeated poll; a return to normal sends a **CLEARED** message. User overrides and removals create their own separate audit events, with user-supplied explanations. The source-derived risk signal still runs and alerts even during an override.
- First SEC poll creates a **baseline** so existing old filings do not spam Telegram.
- Sources may block Workers (e.g., SEC rate/access controls) and free endpoints may change; monitor source-health warnings.
- Telegram messages include the source where available. They do not include your whole private portfolio values; note manually entered checkbox evidence snippets may be forwarded, so do not put personal account numbers or secrets in evidence notes.

## 9. Tests

```bash
cd worker
npm test
```

Pure JavaScript rules are covered in `tests/rules.test.mjs`. HTML syntax and offline UI smoke checks are also included in `tests/ui_smoke.py` (Python + Playwright; optional). A live end-to-end integration test requires deploying Worker + D1 and providing your own private credentials; the package is **not connected** on delivery.

## Official reference links

- D1 free plan and limits: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/d1/platform/limits/
- Worker Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- FRED API: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
- FRED NASDAQ100: https://fred.stlouisfed.org/series/NASDAQ100
- VIX: https://fred.stlouisfed.org/series/VIXCLS
- HY OAS: https://fred.stlouisfed.org/series/BAMLH0A0HYM2
- SEC submissions and companyfacts API: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- Telegram Bot API: https://core.telegram.org/bots/api
- Finnhub quote API: https://finnhub.io/docs/api/quote
