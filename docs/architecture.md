# Architecture & Design Notes

## Stack & constraints

- **Node.js + Express**, single process. Persistence is `node:sqlite` (built-in) in WAL
  mode — no external DB server, no ORM.
- **No frontend build step.** Vanilla ES2022 modules served statically; the owner panel
  is a hash-routed SPA (`owner-ui.js` toolkit + 7 view files + `owner.js` boot).
- **Money:** every monetary value is an **integer in paise** (1 PKR = 100 paise) in the
  DB and the API. Conversion to PKR happens only at the edge (`/100` for display,
  `toPaise` on input). No float arithmetic touches balances.
- **Time:** stored as ISO-8601 UTC strings; all business logic (billing day, due dates,
  aging, daily close) runs in **Asia/Karachi (PKT)**.

## Security

| Concern | Implementation |
|---|---|
| Passwords | bcrypt hashing, never stored/logged in plain |
| Sessions | HttpOnly `SameSite=Lax` cookie, server-side token store, per-session **CSRF token** |
| CSRF | `requireCsrf` middleware on **every** mutating owner route; token from `GET /api/me` / login; client sends `X-CSRF-Token` |
| 2FA | TOTP (RFC 6238) optional per user; setup returns secret + `otpauth://` URL; enable/disable require a valid code (+ password to disable) |
| Brute force | login throttling: 5 failures per IP → 15-minute lock |
| Secrets at rest | device credentials encrypted via `encryptSecret` (data/.dev_secret key, created on first run) |
| Audit | append-only `audit` table: who/what/when/IP for every meaningful action |
| Public site | unauth endpoints are read-only except one rate-limited `POST /api/public/application` |

## Double-entry accounting

- `journal_entries` + `journal_lines` (account_id, debit paise, credit paise).
- Every financial operation (invoice create/void, payment approve/reject/refund,
  expense, salary, purchase payable, provider payment, transfer, opening balance,
  manual entry) goes through a single posting helper that inserts **balanced** lines
  atomically. Unbalanced manual entries are rejected (422).
- Posted lines are never deleted: invoices void with a reason, payments are refunded
  with a real negative posting.
- **Exactly-once:** payment approval is the only path that posts a payment; the
  duplicate-transaction-reference check (with explicit confirm-to-force) prevents
  double-posting of the same bank/easypaisa reference.
- **Trial balance** sums debits/credits per account — the UI badges Balanced / Out of
  balance. **P&L** reports both **accrual** (revenue on invoice, expense on posting) and
  **cash** (real money in/out) figures, labeled by basis, with prior-month comparison.

## Billing engine

- Packages: download/upload Mbps, monthly price (paise), install fee, data limit, active.
- Invoices: unique sequential `RI-0000NN`; line-item types: `package`, `installation`,
  `discount`, `advance_adjustment`, `previous_balance`, `late_fee`, `other`.
- Due-date generation runs daily (scheduler) and on demand (`POST /api/invoices/generate-now`).
- **Pro-rata package change:** when a customer's package changes mid-cycle, the engine
  computes the remaining days on the old package (credit) and the new package's partial
  month, and produces reviewable invoice line items before posting.
- PDF invoice: header + logo + line items + PKR QR payload (`qrcode` package).

## Payments & ledger

- Methods: cash, bank transfer, JazzCash, Easypaisa, Raast, other.
- Lifecycle: `pending → approved` (posts to ledger + cash/bank accounts) or
  `pending → rejected` (reason). Approved payments can be `refunded` (real negative
  posting, reason required).
- Partial payments and **advances** (payment without invoice) are supported; advances
  carry into the next invoice as an `advance_adjustment` line.
- **Recovery:** outstanding invoices bucketed 1–7 / 8–15 / 16+ days with agent
  assignment and payment promises.
- **Ledger:** running balance per customer from the same journal that feeds invoices
  and P&L — one source of truth.

## Device integration (Mode B)

- **Driver framework** (`server/lib/devices.js`): a driver implements
  `exec(deviceCtx, action, payload) → response`. Bundled:
  - `mock` — simulated device; **every response carries `simulated: true`** and the UI
    shows a "MOCK mode" banner. Used for development and demo.
  - `mikrotik` — RouterOS API driver slot (TCP binary protocol).
  - `snmp` — slot for OLT/SNMP vendors.
- **Command queue:** all device actions are `command_logs` rows
  (`queued → running → success | failed`) with attempts (3), last error, response JSON,
  correlation id and initiating user. A single worker (`tickCommands`, hourly + on
  enqueue) processes one command per device at a time (per-device lock).
- **Safe mode:** global (`settings.devices.global_safe_mode`) and per-device flag.
  Destructive actions (`disable_user`, `remove_secret`, `disconnect_session`,
  `onu_disable`) are **blocked at enqueue time and at execution time** while safe mode
  is on; the command is marked failed with a clear reason. Read-only actions continue.
- **Never fake a success:** the system does not report a device action as successful
  unless the driver returned a response; mock/simulated results are always labeled as
  such in both the API and the UI.

## Notifications

- Templates per event (invoice issued, payment received, payment due, suspension,
  ticket update…) editable in Settings.
- **Manual mode (default):** messages are rendered and stored (`notification_logs`) for
  copy/share/WhatsApp. The UI **never** claims delivery when no SMS/WhatsApp gateway is
  configured. A gateway provider slot exists to be filled later.

## Scheduler

Hourly: device command tick + device status poll (updates ONU online counts).
Daily: due-invoice generation, payment-due reminders, auto-suspend (if enabled),
automatic SQLite backup (retention in days).

## Testing approach

- End-to-end API smoke tests (curl) against a seeded instance for every module.
- Headless **DOM-harness** test: loads the real `owner-ui.js` + all view files in a
  `vm` context with a minimal DOM shim and executes all 26 views against the live API,
  asserting each returns a populated element tree without runtime errors.
- `node --check` on every JS file (server + public) as a syntax gate.
