# Upgrade guide — preserve your D1 data

**1. Back up your current dashboard first.** Download its JSON backup and full cloud history before replacing anything.

**2. Update GitHub Pages.** Replace only the public `index.html` with the new top-level `index.html`. This improves navigation, checklist help, automated results, stock reviews and calculator explanations.

**3. Update the existing Cloudflare Worker if you want clearer Telegram messages and per-stock checkbox notifications.** In `worker/wrangler.jsonc`, change `name` to your existing Worker name, set the D1 binding **`DB`**, set `database_name` to your existing **`risk-monitor-db`**, insert its existing `database_id` (UUID), and confirm your `APP_ORIGIN` and SEC User-Agent. Then run:

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

**No D1 migration is necessary for this upgrade.** Do not create/delete the database, and do not change your existing API keys, Telegram secrets, or dashboard token. If a new Worker was accidentally created because `name` differs, update the existing Worker instead.

**4. Reconnect without overwriting.** Refresh GitHub Pages, click **Connect Worker** → enter the existing HTTPS Worker URL and dashboard token → **Connect & refresh**. If your records are already in D1, click **Load cloud data to dashboard** (not Save local defaults). The first connection does not overwrite D1.

**5. Understand what is automatic.** Go to **Monitor → Automated results** to see dates, values and reasons. Only some numerical rules are scored. A filing notice is an information prompt. No manual market or stock checklist item is silently marked safe.

**6. Review market vs stocks separately.** Use **Review → Market checklist** for broad market risk. Use **Review → Stock reviews** to add NVDA, MSFT or another ticker and store that company's notes in D1 (as part of `fields.stockReviews`).

**7. Confirm Telegram and saving.** Press **Send Telegram test**. Change a checklist status, wait for sync confirmation, and verify it loads on refresh. New Worker messaging explains **why the notification arrived**, the evidence and what to do.

**Troubleshooting:** `undefined.prepare` = missing/misnamed D1 **binding**; `no such table` = migrations not applied to correct DB; `401` = wrong access token; `403 Origin` = wrong `APP_ORIGIN`. If you only upload new HTML but not Worker JS, Telegram wording remains the old version.

Read `README.md` for all automated/manual coverage, alerts, frequencies, data storage, privacy and the complete deployment instructions.
