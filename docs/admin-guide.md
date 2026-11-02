# Owner / Super-Admin — Operations Guide

Login: `http://your-host/owner` → email + password (+ 6-digit TOTP code if 2FA is on).

The sidebar has 7 groups. Every screen below is backed by real endpoints — nothing is a
placeholder. Money is shown in PKR and stored as integer paise.

## 1 · Overview

### Dashboard
KPI cards (customers by status, today/month collections, outstanding, operating profit),
alerts (overdue invoices, pending payments, open tickets, new applications), three live
charts (monthly collections, customer growth, package distribution) and a network-device
summary (online sessions, ONU up/down, mock-mode warning when devices are simulated).

### Quick Search
Top-bar search across customers (name / phone / CNIC), invoices, tickets and ONUs.
Click a result to jump straight to it.

## 2 · Customers

### Applications (the sales pipeline)
Each application moves through **New → Surveyed → In Installation → Activated**
(or **Rejected** with a mandatory reason).

- **Survey** — record feasibility, survey notes, proposed route, estimated charges.
- **Schedule install** — assign a staff member + date (creates an Installation job).
- **Activate** — choose package, advance payment, billing day, first-invoice date.
  Activation creates the customer's live record, PPPoE identity and first invoice.
- **Reject** — requires a reason (kept in the audit trail).

Overrides (e.g. activating before install completes) are allowed but **always record
the reason** in the application timeline.

### Customers
Filter by status / area / package / text. CSV export and import. Each customer file has
tabs: **Profile** (CNIC, contacts, address, network mapping), **Invoices**, **Payments**,
**Ledger**, **Documents**, **Tickets**, **Timeline**.

- **Status change** (suspend / disconnect / reactivate) always asks for a reason.
- **Package change** is pro-rata: the billing engine computes the mid-cycle adjustment
  (new package proration + remaining old-package credit) and posts it as a real invoice
  line — you can review it before posting.
- **Documents** — upload (CNIC, agreement, site photos); files are served by reference.

### Packages
CRUD for speed packages (download/upload, monthly price, install fee, data limit,
active flag). Inactive packages disappear from the customer website but stay on
existing customers.

## 3 · Billing

### Invoices
Unique numbers (`RI-0000NN`), generated per billing day from active customers.
**⚡ Generate Due Now** runs the due-date generator on demand. Filters: status, customer,
due-date range. Click an invoice for:

- Line items (package, installation, discount, advance adjustment, previous balance,
  late fee, other) — every amount paise-precise.
- **PDF download** — company header + logo + PKR QR payload.
- Status history; voiding requires a reason and keeps the record (never deleted).

**+ Manual Invoice** — pick a customer (filter first), add line items, set period and
due date. This is also how you bill installation charges or one-offs.

### Payments
Record cash / bank / JazzCash / Easypaisa / Raast with an optional transaction reference
and receiving account. Payments start **pending**; the approval step posts the money
into the ledger and the correct accounts **exactly once**.

- **Duplicate reference warning** — if a reference was already used, the UI flags it and
  requires an explicit "I confirm this is not a duplicate" tick before force-posting.
- **Approve / Reject / Refund** — reject and refund require a reason; refunds create a
  real negative posting (never silent deletion).
- Partial payments and advances (no invoice selected) are supported; advances adjust
  the next invoice automatically.

### Recovery
Outstanding invoices with **aging buckets (1–7 / 8–15 / 16+ days)**, totals, agent
assignment (any staff member) and payment promises (date + amount). This is your
collections call sheet.

### Ledger
Running balance per customer across every invoice and payment — the same numbers that
appear on the invoice PDFs and the P&L.

## 4 · Network

### Network (visual tree)
The physical hierarchy **POP → OLT → PON port → Splitter → Fiber Box → Port → ONU** is
stored as real records (CRUD for each layer) and rendered as a tree. Customers attach
to a specific **box port** and **ONU**.

- **Fault tracing** — pick a fiber box or PON port → the system lists every affected
  customer with a one-click **WhatsApp notification** link and a **Notify All** action
  (logged, manual-mode friendly).
- Orphans (boxes/OLTs not hanging from the tree) are listed so the map always stays honest.

### Live Map
Leaflet + OpenStreetMap. Toggle customers / POPs / boxes / OLTs / splitters and filter
by status. Customer points use the stored lat/lng.

### Installations
Scheduled jobs → **complete** with materials issue (inventory) and ONU mapping.
Double-assignment protection: a box port already occupied cannot be assigned again.

### Tickets
Support tickets (no internet, slow speed, ONU, fiber damage, router, billing, shifting,
other) with priority, assignment, status flow (open → in progress → resolved → closed)
and resolution notes.

## 5 · Operations

### Inventory
Items with stock and unit cost, **purchases** (optional supplier + paid/unpaid → unpaid
creates a supplier payable journal entry), **issues** (to installation jobs; blocked if
stock insufficient), **adjustments** (± with reason) and a live **valuation** report.
Suppliers: CRUD + payables + payments (each payment posts to the ledger).

### Staff
Staff CRUD, plus **salary / advance / deduction / advance-refund** payments — each one
posts a real journal entry and shows in the staff history tab.

### Devices
The Mode-B integration hub:

- Add a device (vendor, model, kind, driver: `mock` / `mikrotik` / `snmp`, host/port,
  credentials — stored **encrypted**).
- **Test connection** — runs a real driver call; mock results are labeled `simulated`.
- **Commands** — 13 actions (info, sessions, ONUs, enable/disable user, disconnect,
  add/remove secret, set profile, ONU enable/disable/reboot). Destructive commands
  require an explicit confirm.
- **Safe mode** (global + per-device) — when ON, destructive commands are **blocked at
  queue time and at execution time** and the command is marked failed with a clear
  reason. Read-only commands still run.
- **Command queue** + **status history** — every command shows status, attempts,
  response and who initiated it. Nothing is silently dropped.

## 6 · Finance

### Accounts & Cash
Chart of accounts (assets / liabilities / equity / revenue / expense, with system
accounts that are locked), cash & bank accounts with opening balances (posted to
capital), **cashbook** per account (in/out/running balance), **account ledger** and
**daily close** (snapshot + check that the day's postings balance).

### Journal
Every posting, filterable by date / account / source (invoice, payment, expense,
salary, purchase, transfer, opening, manual). **Manual entries** allow multi-line debit/
credit entries but **reject anything that doesn't balance**.

### Statements (TB / P&L)
- **Trial balance** — always shown with a balanced/out-of-balance badge.
- **P&L** — month picker; accrual and cash figures both shown and **labeled by basis**,
  with prior-month comparison, income/expense by category, receivables and payables.

### Upstream Provider
Bandwidth provider(s) with plans, provider invoices and payments. Provider cost feeds
the P&L expense side so the "bandwidth cost vs revenue" picture is real, not guessed.

### Reports
Nine exportable reports (collections, invoices, dues aging, customers, expenses,
provider payables, tickets, inventory, bandwidth/sessions) with date-range filters and
**CSV download**.

### Audit Log
Every meaningful action (login, payment approved, status change, device command,
settings change…) with user, entity, details and IP. CSV export available.

## 7 · System

### Settings (tabs)
- **Company** — name, logo (upload), address, phone, WhatsApp, hours, invoice footer.
- **Billing** — rules (billing day defaults, late fee, auto-invoice behavior).
- **Payments** — enabled methods.
- **Notifications** — editable templates per event; manual mode stores rendered
  messages (copy/share) and never claims delivery without a gateway.
- **Devices** — polling, global safe mode, poll interval.
- **Automation** — auto-suspend after N days overdue, auto-reactivate, speed on
  package change, exempt areas.
- **Backup** — create SQLite backup now; retention in days; download backups.
- **Security** — change password, enable/disable **TOTP 2FA** (setup shows the secret +
  otpauth URL for your authenticator app; enabling requires a valid code).
- **Map** — provider note / Google key slot (OSM by default, no key needed).

### Backups
`GET/POST /api/backups` — list, create and download timestamped SQLite backups. The
scheduler also takes a daily backup.
