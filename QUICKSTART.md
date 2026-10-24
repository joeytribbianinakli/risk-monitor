# AI Investment Risk Lab — browser-only upgrade

**Version: October 24, 2026.** This updates the HTML dashboard and your **existing** Cloudflare Worker. **No npm, terminal, new D1 database, or D1 migration required.** You can update both files by copy/paste in GitHub and Cloudflare.

## Before you begin — keep your saved data

- Continue using your existing **Worker**, existing **`risk-monitor-db`** database, and existing **D1 binding named `DB`**. Do **not** delete or recreate them.
- On the current dashboard, export a JSON backup of your holdings/portfolio settings, notes and journal. Keep the file private.
- Write down your current Worker URL and make sure you still know your `DASHBOARD_TOKEN`. **Never put this token in HTML, GitHub, or a message.**
- Replacing HTML and Worker code does not delete database records. The upgraded settings store uses the existing `cursors` D1 table.

## 1. Replace the Worker code — copy/paste, no npm

1. Open [Cloudflare dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → your **existing** Worker.
2. Click **Edit code**.
3. Open `worker-copy-paste.js` from this package, **select all** (Ctrl+A), **copy all**, and replace the code in your existing Worker's main editor with the entire file. The file is a standalone ES module; no imports or packages are required.
4. Click **Deploy** (or **Save and Deploy** as your interface shows). Continue using the **same Worker URL**.
5. In **Bindings**, confirm **`DB` → `risk-monitor-db`**.
6. In **Settings → Variables and Secrets**, confirm the existing **`DASHBOARD_TOKEN`** secret remains set and `APP_ORIGIN` equals your exact GitHub Pages origin, such as `https://YOUR-USERNAME.github.io` (not the repo path).
7. In **Settings → Triggers / Cron Triggers**, make sure the previously scheduled triggers are still present. The code includes a `scheduled()` handler, but **copy-pasting JavaScript does not automatically create cron schedules**. For the current code, the expected UTC cron expressions are:
   - `25 12 * * MON-FRI` — FRED daily market trends and summary.
   - `15 * * * MON-FRI` — hourly optional quotes; rotating SEC checks at selected runs.
   - `40 12 * * MON` — SEC annual cash-flow context.
   Add or preserve these from the Cloudflare dashboard as appropriate. Cron times are UTC and source data can be delayed.

**Existing Cloudflare provider secrets can remain:** `FRED_API_KEY`, `FINNHUB_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. They are still valid and don't have to be re-entered. If you later save those values in the new HTML settings, the **encrypted D1 version takes priority**.

## 2. Replace your GitHub Pages HTML

1. Open the GitHub repository hosting the dashboard.
2. Replace your repository-root `index.html` with this package's `index.html` and commit the change.
3. Reload the public GitHub Pages dashboard (hard refresh if you see the old interface).
4. Under **Automated results**, connect using your existing Worker URL and **same** `DASHBOARD_TOKEN`.
5. If your old values are already in D1, choose **Load cloud data** rather than overwriting them with a stale local copy.

## 3. Manage alerts and credentials within the HTML

1. Open **Telegram & alert settings** in the navigation.
2. In **Telegram notification types**, use switches to control which events send messages. Click **Save alert settings to D1**.
3. In **Message templates**, edit the Telegram wording, preview with example values, and save.
4. In **Create additional alerts**, configure conditions such as **manual or automatic severity becomes Very serious**, a specific indicator's rating change, or a numerical threshold. Click **Save custom alerts**.
5. In **API keys & Telegram bot**, paste any provider keys you want to manage from this interface, then click **Encrypt & save entered keys to D1**. This sends the values **over HTTPS** to your Worker, which encrypts them **before storage in your existing D1 database**.
6. **View**, **Copy**, **Hide**, and **Remove** operate on the D1-managed keys. Revealed keys are automatically hidden after roughly 45 seconds. Existing Cloudflare Worker secrets **cannot be revealed** through the dashboard; to use View/Copy, re-enter them via the HTML once.
7. Click **Send Telegram test** and **Refresh source data** to verify the connection and sources.

### Where credentials live

| Credential | Storage | Reason |
| --- | --- | --- |
| `DASHBOARD_TOKEN` | Cloudflare Worker **secret**, configured once | Authorizes dashboard and derives key to decrypt D1-managed provider credentials. Never save to GitHub. |
| `FRED_API_KEY`, `FINNHUB_API_KEY` | Encrypted in **Cloudflare D1** if saved via HTML (otherwise existing Worker secrets) | Scheduled Worker checks need them after the browser closes. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Encrypted in **Cloudflare D1** if saved via HTML (otherwise existing Worker secrets) | Telegram notifications continue without a browser tab. |
| SEC contact and watched symbols | Encrypted in D1 if entered in the HTML; otherwise Worker configuration | Identifies your SEC requests and defines issuer coverage. |

**Security:** D1-managed provider values are protected with AES-256-GCM using a key derived from the strong `DASHBOARD_TOKEN` Worker secret. Only an authorized dashboard session can request View/Copy. If you rotate `DASHBOARD_TOKEN`, **re-enter browser-managed provider keys**, as previously encrypted entries become unreadable. Avoid exposing your token or your browser session. Clipboard history may also retain copied values. D1 retains the encrypted values; the Worker doesn't write them to public GitHub Pages. This protects ordinary database backups, but anyone with your dashboard token effectively has permission to retrieve keys. It is not a multi-user security model.

**Finnhub:** Worker quote requests now send your key as an `X-Finnhub-Token` header rather than a `token` URL query parameter. FRED uses its documented API-key query parameter. Both requests originate server-side in your Worker.

## 4. When and why do Telegram alerts arrive?

**The Worker doesn't watch the market continuously.** It checks when Cloudflare scheduled triggers execute or when you click a manual refresh. Source publication itself can be delayed.

- **Automated rule changes:** when the rule's status changes (e.g., Low → Moderate or Serious → Low) or an initially risky condition is detected. Not every poll.
- **Custom severity and numerical rules:** on a qualifying change/threshold crossing, as configured in the HTML. A rule set to Very serious does **not** magically make existing automated indicators Very serious; today's single-metric rules typically top out at Serious. Manual assessments can be Very serious.
- **SEC filing detected:** after polling identifies a new watched filing. A filing is information, **not** evidence of high risk by itself.
- **Manual checklist changes:** when you change and save a risk rating, if that category is enabled. You can disable these messages without affecting your saved records.
- **Scheduled summary:** Daily, on changes, every scheduled batch, or Off—select in alert settings. This is a recap, not necessarily a new warning.

All numerical rules are **review prompts**, not orders to sell. The status describes the **specific indicator**, not an overall market crash probability. The dashboard stores the underlying observations and decision notes separately.

## 5. Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Failed to fetch` | Worker URL, `APP_ORIGIN` exact GitHub Pages origin, HTTPS and Worker deployment. |
| `Cannot read properties of undefined (reading 'prepare')` | Your existing D1 binding must be named **`DB`**. |
| `no such table: cursors` | Old D1 migrations haven't been applied; this update does not create tables. Check you're using the original migrated database. |
| `Unauthorized` | Enter the correct Cloudflare `DASHBOARD_TOKEN` (not your database ID). |
| Cannot decrypt saved keys | `DASHBOARD_TOKEN` changed; re-enter provider credentials via the HTML. |
| No scheduled alerts | Confirm the Cloudflare cron triggers still exist, API keys are configured and alerts are enabled. Check Cloudflare Worker logs. |
| Key View/Copy says unavailable | That value exists only as an older Cloudflare secret. Re-enter it in the HTML to enable View/Copy. |
| Telegram test fails | Verify bot token, chat ID, and that you have sent `/start` to your bot. |

**Verification status:** local automated Worker tests and browser UI tests passed; this package hasn't been connected to your live Cloudflare/FRED/Finnhub/Telegram services. Validate with the Telegram test and source checks after deploying.
