'use strict';
/*
 * Rana Internet ERP — full database schema (SQLite build; mirrors the MySQL 8
 * schema described in the master prompt for the production VPS deployment).
 * All money is stored as INTEGER paise (1 PKR = 100) — never floats.
 */
const { db } = require('./db');

const SCHEMA = `
-- ============================ CORE / AUTH ============================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_at ON login_attempts(ip, at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,           -- JSON
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);

-- ============================ NETWORK TOPOLOGY ============================
CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  zone TEXT,
  description TEXT,
  lat REAL,
  lng REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT,
  model TEXT,
  kind TEXT NOT NULL DEFAULT 'router',     -- router | olt | other
  driver TEXT NOT NULL DEFAULT 'mock',     -- mock | mikrotik | snmp (generic)
  host TEXT,
  port INTEGER,
  protocol TEXT,                           -- api | snmp | ssh | rest
  safe_mode INTEGER NOT NULL DEFAULT 0,    -- device-level read-only
  status TEXT NOT NULL DEFAULT 'disabled', -- disabled | enabled | error
  last_sync_at TEXT,
  last_seen_at TEXT,
  identity TEXT,                           -- JSON: version/uptime etc from device
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL DEFAULT 'api',   -- api | snmp_community | ssh
  username TEXT,
  secret_enc TEXT,                              -- AES-256-GCM, never shown after save
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devcred_device ON device_credentials(device_id);

CREATE TABLE IF NOT EXISTS device_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,      -- info, sessions, secrets, onu_list, onu_control, rx_power
  supported INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS command_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_type TEXT NOT NULL,     -- router | olt
  action TEXT NOT NULL,
  description TEXT,
  requires_confirm INTEGER NOT NULL DEFAULT 0,
  payload_template TEXT,         -- JSON with {username} etc placeholders
  UNIQUE(device_type, action)
);

CREATE TABLE IF NOT EXISTS command_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  payload TEXT,                  -- JSON
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | success | failed | cancelled | pending_sync
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  response TEXT,                 -- JSON device response
  correlation_id TEXT,
  initiated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_device ON command_logs(device_id, status);
CREATE INDEX IF NOT EXISTS idx_commands_customer ON command_logs(customer_id);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,           -- device | session | onu | customer
  ref TEXT,                      -- pppoe username / onu serial / customer id
  data TEXT,                     -- JSON
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_hist ON status_history(scope, ref, at);

CREATE TABLE IF NOT EXISTS olts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  pop_id INTEGER REFERENCES pops(id) ON DELETE SET NULL,
  pon_count INTEGER NOT NULL DEFAULT 8,
  vendor TEXT,
  model TEXT,
  driver_status TEXT NOT NULL DEFAULT 'framework', -- framework | connected
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pon_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
  port_no INTEGER NOT NULL,
  name TEXT,
  profile TEXT,
  status TEXT NOT NULL DEFAULT 'available',  -- available | occupied | disabled
  UNIQUE(olt_id, port_no)
);
CREATE TABLE IF NOT EXISTS splitters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ratio TEXT NOT NULL DEFAULT '1:8',         -- 1:4 | 1:8 | 1:16 | custom
  capacity INTEGER NOT NULL DEFAULT 8,
  pop_id INTEGER REFERENCES pops(id) ON DELETE SET NULL,
  pon_port_id INTEGER REFERENCES pon_ports(id) ON DELETE SET NULL,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  lat REAL,
  lng REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fiber_boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  pon_port_id INTEGER REFERENCES pon_ports(id) ON DELETE SET NULL,
  splitter_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 8,
  lat REAL,
  lng REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS box_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id INTEGER NOT NULL REFERENCES fiber_boxes(id) ON DELETE CASCADE,
  port_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'free',  -- free | occupied | faulty
  UNIQUE(box_id, port_no)
);
CREATE TABLE IF NOT EXISTS onus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT UNIQUE,
  mac TEXT UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  box_port_id INTEGER REFERENCES box_ports(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'registered',  -- registered | online | offline | disabled
  rx_power REAL,
  last_seen_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS onu_signal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  onu_id INTEGER NOT NULL REFERENCES onus(id) ON DELETE CASCADE,
  rx_power REAL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================ CUSTOMERS ============================
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  father_name TEXT,
  cnic TEXT,                        -- 13 digits, unique when present
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  lat REAL,
  lng REAL,
  status TEXT NOT NULL DEFAULT 'application', -- application | pending | active | suspended | disconnected | terminated
  device_status TEXT NOT NULL DEFAULT 'unknown',  -- unknown | online | offline | pending_sync
  package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  billing_day INTEGER NOT NULL DEFAULT 5,
  payment_terms TEXT DEFAULT 'monthly',
  install_charges INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  advance INTEGER NOT NULL DEFAULT 0,   -- credit balance in paise
  pppoe_username TEXT,
  pop_id INTEGER REFERENCES pops(id) ON DELETE SET NULL,
  olt_id INTEGER REFERENCES olts(id) ON DELETE SET NULL,
  pon_port_id INTEGER REFERENCES pon_ports(id) ON DELETE SET NULL,
  splitter_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL,
  box_id INTEGER REFERENCES fiber_boxes(id) ON DELETE SET NULL,
  box_port_no INTEGER,
  onu_id INTEGER REFERENCES onus(id) ON DELETE SET NULL,
  installed_at TEXT,
  application_ref TEXT,
  application_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_cnic ON customers(cnic) WHERE cnic IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_pppoe ON customers(pppoe_username) WHERE pppoe_username IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'other', -- cnic_front | cnic_back | agreement | receipt | photo | other
  file_path TEXT NOT NULL,
  original_name TEXT,
  size INTEGER,
  mime TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  download_mbps INTEGER NOT NULL,
  upload_mbps INTEGER NOT NULL,
  price_monthly INTEGER NOT NULL,     -- paise
  install_fee INTEGER NOT NULL DEFAULT 0,
  cycle_days INTEGER NOT NULL DEFAULT 30,
  data_limit_mb INTEGER,
  grace_days INTEGER NOT NULL DEFAULT 0,
  device_profile TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  pop_id INTEGER,
  olt_id INTEGER,
  pon_port_id INTEGER,
  splitter_id INTEGER,
  box_id INTEGER,
  box_port_no INTEGER,
  pppoe_username TEXT,
  status TEXT NOT NULL DEFAULT 'current', -- current | history
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conns_customer ON customer_connections(customer_id, status);

-- ============================ APPLICATIONS / INSTALLATIONS ============================
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  requested_package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'owner',  -- owner | website
  source_ip TEXT,
  status TEXT NOT NULL DEFAULT 'new',     -- new | surveyed | in_installation | completed | activated | rejected
  feasibility TEXT,                        -- pending | feasible | not_feasible
  survey_notes TEXT,
  proposed_route TEXT,
  est_charges INTEGER,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);

CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | cancelled
  scheduled_at TEXT,
  completed_at TEXT,
  cable_meters REAL,
  materials TEXT,        -- JSON [{item_id, name, qty}]
  notes TEXT,
  photos TEXT,           -- JSON [doc ids]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inst_customer ON installations(customer_id);

-- ============================ BILLING ============================
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  period_from TEXT,
  period_to TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid', -- draft | unpaid | partial | paid | void
  subtotal INTEGER NOT NULL DEFAULT 0,   -- paise
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  generated_by TEXT,                     -- auto | manual | user:<id>
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,   -- package | installation | discount | advance_adjustment | previous_balance | late_fee | other
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 0  -- signed paise
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,       -- cash | bank_transfer | jazzcash | easypaisa | raast | other
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,    -- paise
  fee INTEGER NOT NULL DEFAULT 0,
  transaction_ref TEXT,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | refunded | reversed
  reject_reason TEXT,
  attachment_path TEXT,
  received_by TEXT,
  notes TEXT,
  posted INTEGER NOT NULL DEFAULT 0,      -- journal posted exactly once
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_txref ON payments(transaction_ref) WHERE transaction_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  user_id INTEGER,
  action TEXT NOT NULL,      -- approve | reject | refund
  reason TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL,  -- invoice | payment | refund | adjustment
  direction TEXT NOT NULL,   -- debit | credit
  amount INTEGER NOT NULL,   -- paise (always positive; direction decides sign)
  memo TEXT,
  invoice_id INTEGER,
  payment_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledgers(customer_id, at);

-- ============================ FINANCE / ACCOUNTS ============================
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,        -- asset | liability | equity | income | expense
  category TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  description TEXT
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank TEXT,
  account_no TEXT,
  kind TEXT NOT NULL DEFAULT 'cash',   -- cash | bank
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  memo TEXT,
  source TEXT NOT NULL,      -- opening | payment | invoice | expense | salary | purchase | provider | transfer | manual | adjustment
  ref_id INTEGER,
  created_by INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0,   -- paise
  credit INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);
CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ftype TEXT NOT NULL,
  ref_table TEXT,
  ref_id INTEGER,
  amount INTEGER NOT NULL,
  account_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,    -- upstream | salary | fuel | rent | electricity | maintenance | material | misc
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  pay_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  description TEXT,
  transaction_ref TEXT,
  expense_date TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  joined_at TEXT,
  base_salary INTEGER NOT NULL DEFAULT 0,
  advance_balance INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  stype TEXT NOT NULL,       -- salary | advance | deduction | advance_refund
  amount INTEGER NOT NULL,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  notes TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================ UPSTREAM PROVIDERS ============================
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  account_no TEXT,
  service_description TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bandwidth_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  capacity_mbps INTEGER NOT NULL,
  monthly_cost INTEGER NOT NULL,    -- paise
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  started_at TEXT,
  ends_at TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS provider_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  period TEXT,
  amount INTEGER NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | partial | paid
  paid INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT,
  notes TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS provider_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_invoice_id INTEGER NOT NULL REFERENCES provider_invoices(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  transaction_ref TEXT,
  notes TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================ RECOVERY ============================
CREATE TABLE IF NOT EXISTS recovery_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_by INTEGER,
  notes TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS promises_to_pay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  promise_date TEXT NOT NULL,
  amount INTEGER,
  notes TEXT,
  fulfilled INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================ COMPLAINTS ============================
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  category TEXT NOT NULL,    -- no_internet | slow_speed | onu_issue | fiber_damage | router_issue | billing | shifting | other
  priority TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high | urgent
  status TEXT NOT NULL DEFAULT 'open',      -- open | in_progress | pending | resolved | closed
  summary TEXT,
  details TEXT,
  box_id INTEGER REFERENCES fiber_boxes(id) ON DELETE SET NULL,
  pon_port_id INTEGER REFERENCES pon_ports(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE TABLE IF NOT EXISTS ticket_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status TEXT,
  note TEXT,
  by INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================ INVENTORY ============================
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  reorder_level INTEGER NOT NULL DEFAULT 5,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  account_no TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  transaction_ref TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  mtype TEXT NOT NULL,   -- purchase | issue | adjust_in | adjust_out | damage | return
  qty INTEGER NOT NULL,
  unit_cost INTEGER,
  supplier_id INTEGER,
  installation_id INTEGER,
  customer_id INTEGER,
  notes TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON inventory_movements(item_id, at);

-- ============================ NOTIFICATIONS ============================
CREATE TABLE IF NOT EXISTS notification_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tkey TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',  -- sms | whatsapp | email | manual
  subject TEXT,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT,
  channel TEXT,
  to_address TEXT,
  customer_id INTEGER,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'manual',  -- manual | queued | sent | failed
  provider_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function migrate() {
  db.exec(SCHEMA);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO schema_meta(key, value) VALUES ('version', '1')
      ON CONFLICT(key) DO NOTHING;
  `);
  console.log('[migrate] schema applied');
}

if (require.main === module) migrate();
module.exports = { migrate };
