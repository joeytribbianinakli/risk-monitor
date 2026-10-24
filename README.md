# AI Investment Risk Lab — Clear severity edition (October 2026)

A guided, self-hosted financial-risk research tool. **Static frontend on GitHub Pages, Cloudflare Worker for data checks and Telegram, Cloudflare D1 for saved data.** No trades are placed and numerical thresholds are investigation prompts, not crash forecasts.

## What changed

- A calm **Home** page explains what to do next, with four collapsible sidebar navigation groups instead of eleven always-visible tabs.
- **Automated results** now display human-readable conclusions, source dates, *why a rule reached a result*, and *how to interpret it*. No more unexplained `SOURCE: CLEAR` labels. The original calculation and dated source remain visible when you override a checklist result.
- **Market checklist** still contains all 22 indicators (12 primary, 10 supporting; weekly → monthly → quarterly → event-driven; priority within each). Every item has “what it means / where to find the data / how to assess / example note”. **An automated numerical rating is placed in the checklist field only when a fresh, rule-based assessment is available.** A user-selected rating always takes precedence until you restore automation. Company data-only observations remain **Not assessed**.
- **Stock reviews** let you select or add a ticker and maintain separate notes and statuses for nine company-specific indicators. Stocks and assessments save inside the existing D1 `user_state` JSON, under `fields.stockReviews`—**no new database tables or migration needed**.
- **Portfolio stress, position sizing, valuation, moving averages, investment policy and journal** now describe when to use them, what they calculate and what a result means. Existing calculations and controls are preserved.
- **Telegram** messages now begin with a human-readable category, *why the notification was sent*, evidence, observation date, and what (if anything) you need to do. A new SEC filing is always described as **information, not a risk rating**. User checkbox transitions, including per-stock statuses, are logged and can trigger Telegram messages.
- Worker D1 binding must be called **`DB`**. This package references the user's existing `risk-monitor-db` database name. Keep your deployed Worker name and existing D1 UUID.

## Which pages to use

| When | Go to | You will see / do |
|---|---|---|
| Starting your routine | **Home** | Connection status, shortcut to results and tools |
| A Telegram alert arrives | **Monitor → Automated results** | Machine's exact status, source reading and explanation; use the checklist to override the final severity |
| Weekly/monthly/quarterly market research | **Review → Market checklist** | 22 guided AI/Nasdaq indicators, 3 with rule-based auto-filled severity; other items require manual judgments |
| Reviewing NVDA, MSFT or another individual stock | **Review → Stock reviews** | Separate saved per-ticker fundamentals, earnings and valuation notes |
| An unexpected company/market event happens | **Monitor → Urgent events** | Verify the event, record whether you investigated it |
| Considering more concentrated exposure | **Plan → Portfolio stress / Position sizing** | Hypothetical portfolio losses and trim-to-target arithmetic |
| Considering a stock purchase | **Plan → Valuation** | EPS × P/E bear/base/bull comparisons |
| Making a trade decision | **Plan → Investment rules / Decision journal** | The reason and conditions for re-entry |

**Important scope distinction:** The market checklist analyzes *market-wide conditions and representative AI companies*, plus a few personal portfolio safeguards. It does not implicitly maintain a different copy for each ticker. Use **Stock reviews** for individual holdings. Each stock's ticker, notes and status are persisted in `fields.stockReviews`.

## What is really automated?

- **Rule-based automatic checks:** Nasdaq-100 index trend (not adjusted QQQM), rapid declines, published VIX level, and widening US high-yield credit spreads. A threshold reaching Moderate/Serious on the **individual rule** means *investigate*, not sell. The Worker retains its internal clear/watch/serious data values; the HTML maps these to Low/Moderate/Serious respectively.
- **Automatic observations, partial conclusions:** Nasdaq index weekly RSI, 10-year real yield, optional Finnhub quotes, new SEC filings, annual company-wide operating cash flow minus PP&E cash outlays. These are **not** enough to assess AI-specific investment returns or forecast EPS.
- **Manual / analyst judgment:** Forward EPS consensus revisions, AI capex payback, supplier order quality, genuine company valuation, Nasdaq breadth, sector relative total returns, contracts, tax/liquidity needs, ETF look-through, re-entry plan. The dashboard now explains what to obtain and where. A numerical observation is not a completed risk review.
- Every machine card displays its observation date, rules and source. Missing or stale data are **not** presented as clear.
- **One rating field:** Your market checklist now shows **Not assessed / Low / Moderate / Serious / Very serious**. T1, M1, and S2 can fill the field from fresh rule-based Worker readings. Change that same dropdown to override it. Click **Restore latest automatic rating** to use the current saved Worker result, or **Refresh + restore automatic rating** to ask the Worker for new data first. New data do not overwrite a manual override until you ask. Partial data (e.g., MSFT cash flow) never automatically become Low.

## How to interpret each checklist outcome

**Importance** (Critical/High/Medium/Low) describes how much attention an indicator deserves; it is not its current condition. **Severity** is the actual observed outcome of that indicator:

| Severity | Meaning | Next step |
|---|---|---|
| **Not assessed** | No defensible judgment, missing data, unavailable Worker, or data-only measurement | Gather evidence or run the Worker; do not assume Low |
| **Low** | No warning under this indicator's specific measured rule or manual analysis | Normal scheduled review; not a whole-market all-clear |
| **Moderate** | Early or limited warning, e.g., credit spread +100 bps from recent low | Check source, persistence and independent signals |
| **Serious** | Strong threshold or confirmed negative business evidence | Prioritize a deeper review and assess exposure |
| **Very serious** | Several compelling confirmations / material company threat, typically human-judged | Promptly reassess the thesis and position concentration |

A market indicator's **Low** does not mean the entire market is low risk. This is not an automated crash-probability score or a trading order. Some statuses are informational-only and cannot be promoted to ratings without additional evidence.

**Exactly which outcomes auto-fill?** `T1` Nasdaq-100 index trend, `M1` credit-spread widening, and `S2` VIX stress **at the level of their numerical rules only**. All other checklist items are human-reviewed or receive contextual auto data. A V2 Microsoft cash-flow reading is **Not assessed**, not Low, even if operating cash flow minus PP&E spending is positive.

To override: open **Review → Market checklist**, expand an indicator, change **Risk severity**. Your selection and optional evidence note are saved locally and to D1 when cloud autosync is active. The Worker still collects source measurements and sends machine alert transitions. To revert, use **Restore latest automatic rating**; to re-poll first and replace, use **Refresh + restore automatic rating** (subject to Worker API/rate limits). Those buttons appear **only** where an actual rule-based rating is available. If a Worker observation becomes stale, the screen shows Not assessed; you cannot restore that stale reading until refreshed.

**Stock reviews:** Each ticker uses the same five severity options but currently requires human judgments. Filing notifications and company cash-flow data alone cannot assign a defensible company risk rating. These records remain keyed by ticker in D1 (`fields.stockReviews`).

## Telegram: when and why

| Message | When sent | How to interpret / what to do |
|---|---|---|
| **Daily check-in** | Up to once on weekday market-check days when `CHECKIN_MODE=daily` | A summary of existing checks, not necessarily new bad news. Read observation dates. |
| **Moderate / Serious (individual rule)** | A supported automatic rule changes to its underlying watch or serious band | Read the measurement, look at other evidence; do not assume an imminent crash. |
| **Low (individual rule) / Info-only** | A monitored status changes back | Only this one rule improved; the whole market isn't certified safe. |
| **New company filing** | Rotating SEC feed identifies a new relevant 8-K/10-Q/10-K | A document appeared. Read it; no good/bad conclusion yet. |
| **You updated a review / override** | After a D1-synced manual market, urgent or stock checkbox transition, or manual override | Confirms **your action**, not new market data. No notice is sent for routine text typing. |
| **Telegram test** | You press the Send Telegram test button | Confirms bot delivery. |

By default the Worker uses **daily** mode. In `worker/wrangler.jsonc` the setting `CHECKIN_MODE` accepts `daily`, `changes`, `always` and `off`:

- `daily`: one status digest on weekday market-check run, plus separate change/SEC/manual messages.
- `changes`: extra digests when there are check transitions, plus separate change/SEC/manual messages.
- `always`: digest each scheduled run (can be noisy).
- `off`: no digests, but transition/filing/manual notifications remain.

Market FRED checks run at **12:25 UTC weekdays**; optional Finnhub quote polling on weekday hours; SEC filing polling rotates through companies every four hours; annual SEC cash-flow context rotates on Mondays. See `wrangler.jsonc` for actual Cron entries. **No instant/real-time delivery guarantee.** Cloudflare may run late; price feeds and published index series can lag.

## Data storage and protecting prior records

- D1 `user_state` holds the complete dashboard state: all number fields, manual market and urgent checks, journal, **stockReviews by ticker**, and policies, with a revision to prevent silent multi-device overwrites.
- `checks`, `events`, `overrides` and `run_log` hold source readings and monitoring/audit histories. No automatic deletion is performed by this app.
- Browser localStorage is a fallback. Cloud save happens when the Worker is **connected** and autosync has been enabled after you deliberately **Load cloud data** or **Save local data to D1**. *Do not assume a browser-local change reached D1 when the dashboard reports a sync failure.*
- Before replacing your GitHub Pages HTML or redeploying the Worker, use **Export JSON backup** and **Export full cloud history** (if connected). Keep these private.
- The HTML includes **example calculator numbers** for demonstration. Verify/replace them with actual inputs.
- A new Worker deployment does **not** need a new D1 database. **Never delete your existing `risk-monitor-db`.**

## Deploy / upgrade (existing users)

1. **Backup first.** From the existing deployed dashboard, export your JSON backup. If connected, also export full cloud history. Keep them outside your public GitHub repo.
2. **GitHub Pages:** replace your repository's `index.html` with this package's top-level `index.html`. No build step is needed; the HTML is self-contained.
3. **Worker update is recommended for the new severity labels in Telegram and proper new-value checkbox audit handling.** If you want those, update your *existing* Worker with `worker/src/index.js` and ensure the matching `worker/src/rules.js` remains present. If you update only HTML, checklist autofill will still work with the existing Worker API, but the old Worker may not send the correct Telegram notice for new severity values.
4. In `worker/wrangler.jsonc` set:
   - `name` to the **exact existing Worker name** (to update it, not create a new one).
   - `d1_databases[0].binding` to **`DB`** (exact capitalization).
   - `database_name` to **`risk-monitor-db`** (as currently configured), and `database_id` to your **existing D1 database UUID** from Cloudflare. Do not leave the placeholder.
   - `APP_ORIGIN` to the **origin** of your GitHub Pages URL (`https://USERNAME.github.io`, or your custom origin).
   - `SEC_USER_AGENT` to your legitimate app name/contact. `SEC_SYMBOLS` to your actual watchlist.
5. Run `cd worker && npm install && npx wrangler login && npx wrangler deploy`. If you used the Cloudflare web editor before, you can also update code there; verify that bindings and secrets are preserved. Deploying is a live change to your existing Worker.
6. **No D1 schema migrations are required for this UI/Telegram update.** If you are installing from scratch, apply the included migrations once: `npx wrangler d1 migrations apply risk-monitor-db --remote`. Do **not** create another DB for an upgrade.
7. Refresh your GitHub Pages site. Open **Monitor → Automated results → Cloud connection & storage settings**, connect using the existing Worker URL and `DASHBOARD_TOKEN`. If D1 already has your data, choose **Load cloud data** instead of overwriting it with browser defaults.
8. Confirm a saved market checkbox or stock review appears after reloading. Test Telegram delivery from the dashboard. Do not paste any secrets into a public issue or chat.

### Secrets stored only in Cloudflare Worker

Use `npx wrangler secret put ...` (from `worker`) for `DASHBOARD_TOKEN`, `FRED_API_KEY`, optional `FINNHUB_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. **Never put keys in the HTML, README, GitHub Pages repo or source control.** `SEC_USER_AGENT` is public application identification, not a secret.

If the dashboard says `Cannot read properties of undefined (reading 'prepare')`, inspect the Worker's **D1 binding variable**: it must be `DB`, pointing at your existing `risk-monitor-db` database. If you see `no such table`, apply the existing SQL migrations **to the correct remote DB** after confirming you are targeting the right database.

## Tests and limitations

Run `cd worker && npm test` (Node 22+ with native SQLite tests). The package includes a browser smoke test in `tests/smoke_ui.py` using Playwright; it can render offline with a storage mock, without production credentials. We have not tested this release against your actual Cloudflare account, live data providers, or Telegram bot. Live CORS, API entitlements, quota behavior, and delivery must be verified after deployment.

Some free sources are delayed or incomplete. SEC detects filings but cannot judge their economic meaning. OANDA's FX-focused offering was not required here. No system can reliably notify before every crash.

### Official references

- [Cloudflare D1](https://developers.cloudflare.com/d1/) · [Workers Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [FRED](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) · [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Finnhub quote API](https://finnhub.io/docs/api/quote) · [Telegram Bot API](https://core.telegram.org/bots/api)
