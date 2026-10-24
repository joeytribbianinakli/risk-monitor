# AI Investment Risk Lab — Alerts & Telegram control center

This release focuses on simple risk-rating explanations, editable Telegram notifications, custom triggers, and **encrypted D1 storage of credentials entered from the HTML**. It builds on your existing dashboard (market-wide 22-indicator checklist, per-ticker stock reviews, automated monitoring and portfolio calculators).

## Files

- **`index.html`** — upload to the root of your GitHub Pages repository.
- **`worker-copy-paste.js`** — replace the code of your **existing** Cloudflare Worker via **Edit code → paste → Deploy**. No npm required.
- **`QUICKSTART.md`** — complete browser-only upgrade and troubleshooting guide.

## Important choices

- **Provider keys and Telegram bot details entered in HTML:** encrypted and stored in your existing D1 database, so scheduled checks continue when your browser is closed.
- **Dashboard token:** stays in Cloudflare Worker Secrets. Never added to public HTML or D1. Required to connect and decrypt stored provider keys.
- **View/Copy:** available for credentials stored through the dashboard, after authenticated retrieval. Existing Cloudflare-managed secrets are not readable until you manually re-enter them in the dashboard.
- **Finnhub authentication:** sent through `X-Finnhub-Token` header by the Worker, not in the URL.
- **Alerts:** turn each category on/off; customize Telegram text templates; create up to 25 custom severity or numerical alerts.
- **Portfolio/checklist database:** reuses the existing D1 schema, no new migration. Existing journal, inputs and assessments remain stored if you keep using the same D1 database.

## Security and operational limitations

- Encryption uses AES-256-GCM with a key derived from a strong `DASHBOARD_TOKEN`. If you change it, re-enter the D1-managed provider credentials. The token provides access to the entire personal dashboard, so protect it like a password.
- Your browser does not need to stay open for scheduled runs, provided Cloudflare Cron triggers are enabled and credentials are configured. The dashboard does not create those triggers for you.
- Avoid storing account numbers or passwords in checklist notes, and avoid copying credentials on shared devices.
- Observations can be delayed or unavailable; the Worker does not treat missing evidence as low risk. Telegram does not guarantee instant delivery.
- No stock purchases or sales are automated.

See **QUICKSTART.md** for exact deployment steps.
