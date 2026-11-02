# Rana Internet — ISP Management System

Complete ISP management system for **Rana Internet** (Lahore, Pakistan), built from the
10-page master development prompt. Single Owner / Super-Admin web panel (Mode A — fully
functional standalone) with optional device integration (Mode B — pluggable driver
framework with a mock driver and a MikroTik RouterOS API driver stub).

## Quick start

```bash
npm install
npm start            # → http://localhost:3000
```

On first run the app auto-creates the SQLite database (`data/rana.sqlite`), applies the
schema, and seeds clearly-labeled demo data (10 customers, 20 invoices, 18 payments,
network tree, demo router, chart of accounts, opening balances).

| URL | What |
|---|---|
| `http://localhost:3000/` | **Customer website** — landing, packages, apply for connection, track application |
| `http://localhost:3000/owner` | **Owner / Super-Admin panel** |

Default login (demo seed):

```
email:    owner@ranainternet.pk
password: Rana@2026
```

Change the password in **Settings → Security** after first login.

## Tech stack

- **Backend:** Node.js + Express, `node:sqlite` (WAL mode), zero external DB drivers
- **Money:** integer **paise** end-to-end (never float); PKR, Asia/Karachi (PKT)
- **Auth:** cookie session + per-session CSRF token, bcrypt password hashing,
  TOTP 2FA (RFC 6238), login throttling (5 fails → 15 min lock)
- **Accounting:** double-entry journal; every financial event posts exactly once;
  trial balance always reconciles; no hard-delete of posted entries
- **PDF invoices:** `qrcode` (PKRaast-style QR payload) + company logo, server-rendered
- **Frontend:** vanilla JS (no build step), Canvas charts (no chart libs), Leaflet + OSM map
- **Device integration:** driver framework (`mock`, `mikrotik`, `snmp` slots);
  all device commands are queued, logged, retried (3×), and audited; **simulated
  responses are always labeled `simulated: true`** — the system never presents a fake
  device action as real.

## Repository layout

```
server/
  index.js          entrypoint (migrate → seed → listen)
  app.js            express app (static, /owner, 404)
  db.js             node:sqlite handle + tx helper
  migrate.js        schema (idempotent)
  seed.js           demo data (skipped if present)
  scheduler.js      hourly device tick, daily billing/reminders/suspend/backup
  config.js         settings store + constants
  lib/
    auth.js         sessions, CSRF, bcrypt, TOTP, throttle
    billing.js      invoice create, pro-rata package change, due-date generation
    payments.js     record/approve/reject/refund (exactly-once journal)
    accounting.js   journal posting, chart of accounts, trial balance
    devices.js      driver framework, command queue, safe mode
    notify.js       notification templates + manual-mode log (no fake delivery)
    pdf.js          invoice PDF (logo + QR)
    util.js         paise/CSV/dates/mime helpers
  routes/
    api.js          auth, customers, applications, packages, dashboards
    api_ops.js      invoices, payments, ledger, recovery, network, inventory,
                    staff, accounts/journal, providers, devices, settings,
                    backups, audit, reports
    site.js         public customer-site API (/api/public/*)
public/
  index.html        customer landing (EN/اردو)
  apply.html        connection application form
  track.html        application tracking (reference + phone)
  owner.html        owner panel shell (login + 2FA, sidebar, search)
  js/               owner-ui.js toolkit, 7 view files, owner.js boot, site.js
  css/              site.css (customer), owner.css (panel)
docs/               guides (admin, customer site, architecture, API)
data/               runtime data — NOT committed (DB, backups, uploads)
```

## Core guarantees (from the spec)

1. **No dead buttons, no fake charts** — every control posts to a real endpoint.
2. **Money is never a float** — paise integers; charts format for display only.
3. **Posted financials are never hard-deleted** — payments are approved/rejected/
   refunded; invoices void with a reason; the journal is append-only.
4. **Demo data is labeled** — banner in the panel + "DEMO" notes in seed rows.
5. **Device integration is never mandatory** — Mode A billing/invoicing/payments work
   with zero devices configured.
6. **Notifications are honest** — in manual mode messages are rendered and stored for
   copy/share; the UI never claims SMS/WhatsApp delivery when no gateway is configured.

## Testing done

- All API endpoints smoke-tested end-to-end (curl) — auth, dashboard, applications
  workflow, customers, invoices + PDF, payments lifecycle (exactly-once posting,
  duplicate-reference block), recovery aging, ledger, network tree/faults, map,
  inventory, staff, accounts, journal, trial balance, P&L (accrual + cash basis),
  providers, devices (mock test + command queue), settings, audit, backups, reports.
- All 26 owner-panel views executed headlessly against the live API (DOM-harness
  test) — 26/26 render without runtime errors.
- Public customer-site flow: apply → reference number → track.
