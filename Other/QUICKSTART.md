# Upgrade guide — preserve your D1 data

**1. Back up your current dashboard first.** Download its JSON backup and full cloud history before replacing anything.

**2. Update GitHub Pages.** Replace only the public `index.html` with the new top-level `index.html`. This adds consistent **Low / Moderate / Serious / Very serious / Not assessed** severity outcomes to market and stock checklists, safe rule-based auto-fill, manual overrides in the same field, and two restore options.

**3. Update the existing Cloudflare Worker to receive correctly labeled Low/Moderate/Serious/Very serious Telegram checkbox messages and avoid migration-only notices.** In `worker/wrangler.jsonc`, change `name` to your existing Worker name, set the D1 binding **`DB`**, set `database_name` to your existing **`risk-monitor-db`**, insert its existing `database_id` (UUID), and confirm your `APP_ORIGIN` and SEC User-Agent. Then run:

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

**No D1 migration is necessary for this upgrade.** Do not create/delete the database, and do not change your existing API keys, Telegram secrets, or dashboard token. If a new Worker was accidentally created because `name` differs, update the existing Worker instead.

**4. Reconnect without overwriting.** Refresh GitHub Pages, click **Connect Worker** → enter the existing HTTPS Worker URL and dashboard token → **Connect & refresh**. If your records are already in D1, click **Load cloud data to dashboard** (not Save local defaults). The first connection does not overwrite D1.

**5. Understand what is automatic.** Go to **Monitor → Automated results** to see dates, values and reasons. Only **T1 Nasdaq index trend, M1 credit spreads and S2 VIX** currently receive fresh, rule-based checklist ratings. Their dropdowns fill automatically when no manual override exists. A cash-flow reading or filing notice remains **Not assessed** until you review it; a stale reading never means Low.

**6. Review market vs stocks separately.** Use **Review → Market checklist** for broad market risk. Use **Review → Stock reviews** to add NVDA, MSFT or another ticker and store that company's notes in D1 (as part of `fields.stockReviews`).

**7. Try a manual override and restore.** Expand T1/M1/S2 after the Worker returns fresh data. Choose a different severity from the dropdown—this will be preserved through later automatic updates. Select **Restore latest automatic rating** to restore the most recent existing Worker assessment, or **Refresh + restore automatic rating** to first rerun market feeds (the Worker rate-limits manual checks). The raw measurement and calculation remain visible; no trade occurs. For V2, cash-flow figures alone cannot assign a rating, so no restore control is offered.

**8. Confirm Telegram and saving.** Press **Send Telegram test**. Change a checklist status, wait for sync confirmation, and verify it loads on refresh. New Worker messaging explains **why the notification arrived**, the evidence and what to do.

**Troubleshooting:** `undefined.prepare` = missing/misnamed D1 **binding**; `no such table` = migrations not applied to correct DB; `401` = wrong access token; `403 Origin` = wrong `APP_ORIGIN`. If you only upload new HTML but not Worker JS, Telegram wording remains the old version.

Read `README.md` for all automated/manual coverage, alerts, frequencies, data storage, privacy and the complete deployment instructions.

**Important:** The checklist can use new severity labels even if the old Worker is still deployed, but to get matching Telegram descriptions and status-change events you should redeploy the included Worker code to the **same** Worker name, D1 database and binding. Secrets persist. There is **no new migration**. Old manual `clear`/`watch` values are translated to `Low`/`Moderate` without treating them as fresh machine results. Export a private JSON backup before upgrading.
