# AI Investment Risk Lab — ClearUX edition

A guided, self-hosted financial-risk research tool. **Static frontend on GitHub Pages, Cloudflare Worker for data checks and Telegram, Cloudflare D1 for saved data.** No trades are placed and numerical thresholds are investigation prompts, not crash forecasts.

## What changed

- A calm **Home** page explains what to do next, with four collapsible sidebar navigation groups instead of eleven always-visible tabs.
- **Automated results** now display human-readable conclusions, source dates, *why a rule reached a result*, and *how to interpret it*. No more unexplained `SOURCE: CLEAR` labels. The original machine verdict is preserved when you override it.
- **Market checklist** still contains all 22 indicators (12 primary, 10 supporting; weekly → monthly → quarterly → event-driven; priority within each). Every item has “what it means / where to find the data / how to assess / example note”. **A manual status is never silently changed because a feed returned data.**
- **Stock reviews** let you select or add a ticker and maintain separate notes and statuses for nine company-specific indicators. Stocks and assessments save inside the existing D1 `user_state` JSON, under `fields.stockReviews`—**no new database tables or migration needed**.
- **Portfolio stress, position sizing, valuation, moving averages, investment policy and journal** now describe when to use them, what they calculate and what a result means. Existing calculations and controls are preserved.
- **Telegram** messages now begin with a human-readable category, *why the notification was sent*, evidence, observation date, and what (if anything) you need to do. A new SEC filing is always described as **information, not a risk rating**. User checkbox transitions, including per-stock statuses, are logged and can trigger Telegram messages.
- Worker D1 binding must be called **`DB`**. This package references the user's existing `risk-monitor-db` database name. Keep your deployed Worker name and existing D1 UUID.

## Which pages to use

| When | Go to | You will see / do |
|---|---|---|
| Starting your routine | **Home** | Connection status, shortcut to results and tools |
| A Telegram alert arrives | **Monitor → Automated results** | Machine's exact status, source reading and explanation; optionally add an override |
| Weekly/monthly/quarterly market research | **Review → Market checklist** | Guided, manual 22-indicator overall AI/Nasdaq risk review |
| Reviewing NVDA, MSFT or another individual stock | **Review → Stock reviews** | Separate saved per-ticker fundamentals, earnings and valuation notes |
| An unexpected company/market event happens | **Monitor → Urgent events** | Verify the event, record whether you investigated it |
| Considering more concentrated exposure | **Plan → Portfolio stress / Position sizing** | Hypothetical portfolio losses and trim-to-target arithmetic |
| Considering a stock purchase | **Plan → Valuation** | EPS × P/E bear/base/bull comparisons |
| Making a trade decision | **Plan → Investment rules / Decision journal** | The reason and conditions for re-entry |

**Important scope distinction:** The market checklist analyzes *market-wide conditions and representative AI companies*, plus a few personal portfolio safeguards. It does not implicitly maintain a different copy for each ticker. Use **Stock reviews** for individual holdings. Each stock's ticker, notes and status are persisted in `fields.stockReviews`.

## What is really automated?

- **Rule-based automatic checks:** Nasdaq-100 index trend (not adjusted QQQM), rapid declines, published VIX level, and widening US high-yield credit spreads. A threshold reaching Watch/Serious means *investigate*, not sell.
- **Automatic observations, partial conclusions:** Nasdaq index weekly RSI, 10-year real yield, optional Finnhub quotes, new SEC filings, annual company-wide operating cash flow minus PP&E cash outlays. These are **not** enough to assess AI-specific investment returns or forecast EPS.
- **Manual / analyst judgment:** Forward EPS consensus revisions, AI capex payback, supplier order quality, genuine company valuation, Nasdaq breadth, sector relative total returns, contracts, tax/liquidity needs, ETF look-through, re-entry plan. The dashboard now explains what to obtain and where.
- Every machine card displays its observation date, rules and source. Missing or stale data are **not** presented as clear.
- **Manual overrides:** When a source reading exists, open “Disagree with the system?” and select your judgment with a required reason. Underlying machine status and alerting stay separate.

## Telegram: when and why

| Message | When sent | How to interpret / what to do |
|---|---|---|
| **Daily check-in** | Up to once on weekday market-check days when `CHECKIN_MODE=daily` | A summary of existing checks, not necessarily new bad news. Read observation dates. |
| **Needs attention / Strong warning** | A supported automatic rule changes to Watch or Serious | Read the measurement, look at other evidence; do not assume an imminent crash. |
| **Rule returned to normal / Info-only** | A monitored status changes back | Only this one rule improved; the whole market isn't certified safe. |
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
3. **Worker updates are needed only for the clearer Telegram wording and stock-specific checkbox notifications.** If you want those, update your *existing* Worker with `worker/src/index.js` and ensure the matching `worker/src/rules.js` remains present. If you update only HTML, the old Telegram text remains unchanged.
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
