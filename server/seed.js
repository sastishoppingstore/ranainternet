'use strict';
/*
 * DEMO SEED — clearly labeled demo data for the owner panel.
 * Set SEED_DEMO=0 to start with an empty production database.
 * Financial history posted here uses the same balanced-journal engine as live
 * operations, so every demo figure reconciles in the trial balance.
 */
const { db, tx } = require('./db');
const { setSetting } = require('./config');
const ac = require('./lib/accounting');
const { toPaise, todayPKT, addDays, cleanPhone } = require('./lib/util');
const { createInvoice } = require('./lib/billing');
const { recordPayment, approvePayment } = require('./lib/payments');

const SEED_CREDENTIALS = {
  email: 'owner@ranainternet.pk',
  name: 'Owner (Super Admin)',
  password: 'Rana@2026',
};

function monthAgo(n, day) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

function seedDemo() {
  if (db.prepare('SELECT COUNT(*) c FROM customers').get().c > 0) {
    console.log('[seed] demo data already present — skipping');
    return;
  }
  console.log('[seed] inserting DEMO data (labeled; SEED_DEMO=0 to disable)');

  /* ---------- settings ---------- */
  setSetting('company', {
    name: 'Rana Internet',
    tagline: 'Fiber internet for every home in Lahore',
    address: '12-B, Main Boulevard, Satellite Town, Lahore',
    phone: '042-35712345',
    whatsapp: '0300-1234567',
    email: 'info@ranainternet.pk',
    hours: '9:00 AM - 9:00 PM (7 days)',
    currency: 'PKR',
    invoice_footer: 'Rana Internet — Shukriya for your trust. For support call 042-35712345 or WhatsApp 0300-1234567.',
  });
  setSetting('billing', {
    default_grace_days: 3,
    due_days_after_invoice: 10,
    late_fee_per_day: toPaise(100),
    aging_bucket1_days: 7,
    aging_bucket2_days: 15,
  });
  setSetting('payments', { methods: ['cash', 'bank_transfer', 'jazzcash', 'easypaisa', 'raast'] });
  setSetting('notifications', { provider: 'manual', note: 'Manual mode: messages are rendered and stored for copy/share. Configure SMS/WhatsApp gateway later.' });
  setSetting('devices', { poll_enabled: true, global_safe_mode: false, poll_interval_min: 5 });
  setSetting('automation', { auto_suspend: false, auto_suspend_days: 15, auto_reactivate: false, speed_on_package_change: true, suspend_exempt_areas: [] });
  setSetting('backup', { retention: 14 });
  setSetting('map', { provider: 'osm', google_key: '' });
  setSetting('system', { demo_data: true, note: 'Database contains clearly-labeled demo seed data.' });

  /* ---------- areas ---------- */
  const insArea = db.prepare('INSERT INTO areas(name, zone, description, lat, lng) VALUES(?,?,?,?,?)');
  const areaIds = {};
  for (const [key, name, zone, lat, lng] of [
    ['satellite', 'Satellite Town', 'Lahore West', 31.511, 74.294],
    ['johar', 'Johar Town', 'Lahore North', 31.468, 74.290],
    ['gulberg', 'Gulberg', 'Lahore Central', 31.469, 74.312],
    ['wapda', 'Wapda Town', 'Lahore South', 31.421, 74.331],
    ['model', 'Model Town', 'Lahore North', 31.535, 74.327],
  ]) {
    areaIds[key] = Number(insArea.run(name, zone, 'Demo service area', lat, lng).lastInsertRowid);
  }

  /* ---------- packages ---------- */
  const insPkg = db.prepare(
    `INSERT INTO packages(name, download_mbps, upload_mbps, price_monthly, install_fee, cycle_days, data_limit_mb, grace_days, device_profile, description)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  );
  const pkg = {};
  for (const [key, row] of [
    ['starter', ['Starter 10', 10, 4, 2500, 1000, 30, null, 3, 'profile-10m', 'Perfect for browsing, WhatsApp and social media']],
    ['home', ['Home 20', 20, 8, 3500, 1000, 30, null, 3, 'profile-20m', 'HD streaming, online classes and gaming']],
    ['family', ['Family 30', 30, 12, 4500, 1500, 30, null, 3, 'profile-30m', 'Multiple devices, 4K streaming, no buffering']],
    ['business', ['Business 50', 50, 20, 6500, 2000, 30, null, 5, 'profile-50m', 'Business-grade connection with priority support']],
  ]) {
    const [name, dl, ul, price, install, cycle, dataLimit, grace, profile, desc] = row;
    pkg[key] = Number(insPkg.run(name, dl, ul, toPaise(price), toPaise(install), cycle, dataLimit, grace, profile, desc).lastInsertRowid);
  }

  /* ---------- network topology ---------- */
  const popId = Number(db.prepare('INSERT INTO pops(name, area_id, address, lat, lng) VALUES(?,?,?,?,?)')
    .run('Satellite POP / Main Room', areaIds.satellite, '12-B Main Boulevard, Satellite Town', 31.5112, 74.2941).lastInsertRowid);

  const routerId = Number(db.prepare(
    `INSERT INTO devices(name, vendor, model, kind, driver, host, port, protocol, status, notes)
     VALUES('Main Router (Demo)', 'MikroTik', 'Demo-Router', 'router', 'mock', '192.168.88.1', 8729, 'api', 'enabled',
      'DEMO: mock driver simulates responses. Replace with real MikroTik host/credentials for production.')`
  ).run().lastInsertRowid);
  db.prepare('INSERT INTO device_capabilities(device_id, capability) VALUES(?,?)').run(routerId, 'info');
  db.prepare('INSERT INTO device_capabilities(device_id, capability) VALUES(?,?)').run(routerId, 'sessions');

  const oltId = Number(db.prepare(
    `INSERT INTO olts(device_id, name, pop_id, pon_count, vendor, model, driver_status, notes)
     VALUES(?, 'Demo OLT (framework)', ?, 8, 'Unconfirmed', 'TBD', 'framework',
      'DEMO: brand/model not confirmed — pluggable driver architecture ready. Owner will select real OLT later.')`
  ).run(null, popId).lastInsertRowid);
  const ponIds = [];
  const insPon = db.prepare(`INSERT INTO pon_ports(olt_id, port_no, name, profile, status) VALUES(?,?,?,?,?)`);
  for (let i = 1; i <= 4; i++) {
    ponIds.push(Number(insPon.run(oltId, i, `PON ${i}`, 'GPON-2.5G', i <= 2 ? 'occupied' : 'available').lastInsertRowid));
  }

  const splitterId = Number(db.prepare(
    `INSERT INTO splitters(name, ratio, capacity, pop_id, pon_port_id, area_id, lat, lng) VALUES(?,?,?,?,?,?,?,?)`
  ).run('Splitter S1 (1:8)', '1:8', 8, popId, ponIds[0], areaIds.satellite, 31.5120, 74.2950).lastInsertRowid);

  const boxIds = {};
  const insBox = db.prepare(
    `INSERT INTO fiber_boxes(name, area_id, pon_port_id, splitter_id, capacity, lat, lng) VALUES(?,?,?,?,?,?,?)`
  );
  const boxDefs = [
    ['BX-SAT-01', areaIds.satellite, ponIds[0], 31.5125, 74.2955],
    ['BX-SAT-02', areaIds.satellite, ponIds[1], 31.5090, 74.2910],
    ['BX-JOH-01', areaIds.johar, ponIds[1], 31.4690, 74.2890],
  ];
  for (const [name, area, pon, lat, lng] of boxDefs) {
    const id = Number(insBox.run(name, area, pon, name.startsWith('BX-SAT-01') ? splitterId : null, 8, lat, lng).lastInsertRowid);
    boxIds[name] = id;
    const insPort = db.prepare('INSERT INTO box_ports(box_id, port_no, status) VALUES(?,?, \'free\')');
    for (let p = 1; p <= 8; p++) insPort.run(id, p);
  }

  /* ---------- staff ---------- */
  const insStaff = db.prepare('INSERT INTO staff(name, role, phone, joined_at, base_salary) VALUES(?,?,?,?,?)');
  const staff = {
    tech: Number(insStaff.run('Imran Khan (Demo)', 'Installation Technician', '0301-1112223', monthAgo(8, 1), toPaise(45000)).lastInsertRowid),
    collection: Number(insStaff.run('Bilal Ahmed (Demo)', 'Collection Agent', '0302-3334445', monthAgo(6, 1), toPaise(35000)).lastInsertRowid),
  };

  /* ---------- inventory ---------- */
  const insItem = db.prepare('INSERT INTO inventory_items(name, category, unit, reorder_level, unit_cost) VALUES(?,?,?,?,?)');
  const items = {};
  for (const [key, row] of [
    ['fiber', ['Single-mode Fiber Cable (per meter)', 'cable', 'meter', 100, toPaise(35)]],
    ['onu', ['ONU / FibeR Modem', 'device', 'pcs', 10, toPaise(8500)]],
    ['splitter', ['Splitter 1:8', 'component', 'pcs', 4, toPaise(2500)]],
    ['connector', ['Fiber Connector (SC/APC)', 'component', 'pcs', 20, toPaise(120)]],
    ['dropwire', ['Drop Wire (per meter)', 'cable', 'meter', 50, toPaise(15)]],
  ]) items[key] = Number(insItem.run(...row).lastInsertRowid);
  const supId = Number(db.prepare('INSERT INTO suppliers(name, phone, address, notes) VALUES(?,?,?,?)')
    .run('Demo Fiber Supplies Co.', '042-36600011', 'Hafeez Center, Lahore', 'DEMO supplier').lastInsertRowid);
  const insMov = db.prepare(`INSERT INTO inventory_movements(item_id, mtype, qty, unit_cost, supplier_id, notes) VALUES(?,?,?, ?,?,?)`);
  insMov.run(items.fiber, 'purchase', 500, toPaise(35), supId, 'Opening stock (demo)');
  insMov.run(items.onu, 'purchase', 25, toPaise(8500), supId, 'Opening stock (demo)');
  insMov.run(items.splitter, 'purchase', 6, toPaise(2500), supId, 'Opening stock (demo)');
  insMov.run(items.connector, 'purchase', 40, toPaise(120), supId, 'Opening stock (demo)');
  insMov.run(items.dropwire, 'purchase', 200, toPaise(15), supId, 'Opening stock (demo)');
  insMov.run(items.onu, 'issue', 1, null, null, 'Demo installation material issue');

  /* ---------- bank accounts ---------- */
  const cashId = Number(db.prepare(
    `INSERT INTO bank_accounts(name, bank, account_no, kind, account_id, opening_balance)
     VALUES('Office Cash', '', '', 'cash', (SELECT id FROM accounts WHERE category='cash' LIMIT 1), 0)`
  ).run().lastInsertRowid);
  const bankId = Number(db.prepare(
    `INSERT INTO bank_accounts(name, bank, account_no, kind, account_id, opening_balance)
     VALUES('HBL Business Account (Demo)', 'HBL', '0012-3456789-01', 'bank', (SELECT id FROM accounts WHERE category='bank' LIMIT 1), 0)`
  ).run().lastInsertRowid);
  ac.postJournal({
    entryDate: monthAgo(3, 1), memo: 'DEMO opening balances', source: 'opening',
    lines: [
      { account_id: ac.accountIdForBank(cashId), debit: toPaise(50000), credit: 0 },
      { account_id: ac.accountIdForBank(bankId), debit: toPaise(600000), credit: 0 },
      { account_id: ac.accountByCategory('capital', 'equity'), debit: 0, credit: toPaise(650000) },
    ],
  });

  /* ---------- upstream provider ---------- */
  const provId = Number(db.prepare(
    `INSERT INTO providers(company, contact_name, phone, service_description, notes)
     VALUES('Demo Upstream Provider', 'Network Sales', '051-111-222-333', 'Wholesale IP transit (DEMO)', 'Clearly-labeled demo provider record.')`
  ).run().lastInsertRowid);
  db.prepare(
    `INSERT INTO bandwidth_plans(provider_id, capacity_mbps, monthly_cost, billing_period, started_at) VALUES(?,?,?,?,?)`
  ).run(provId, 1000, toPaise(150000), 'monthly', monthAgo(3, 1));
  const insProvInv = db.prepare('INSERT INTO provider_invoices(provider_id, period, amount, due_date, invoice_no, notes) VALUES(?,?,?,?,?,?)');
  for (let m = 2; m >= 0; m--) {
    const period = monthAgo(m, 1).slice(0, 7);
    const inv = Number(insProvInv.run(provId, period, toPaise(150000), addDays(monthAgo(m, 1).slice(0, 8) + '15', 0), `UP-${period}`, 'Monthly IP transit (demo)').lastInsertRowid);
    if (m < 2) {
      db.prepare('INSERT INTO provider_payments(provider_invoice_id, amount, account_id, transaction_ref) VALUES(?,?,?,?)')
        .run(inv, toPaise(150000), bankId, `TT-${period}`);
      db.prepare('UPDATE provider_invoices SET paid=?, status=? WHERE id=?').run(toPaise(150000), 'paid', inv);
      ac.postJournal({
        entryDate: addDays(monthAgo(m - 1, 1).slice(0, 8) + '16', 0), memo: `Upstream payment UP-${period} (demo)`, source: 'provider', refId: inv,
        lines: [
          { account_id: ac.accountByCategory('provider', 'liability'), debit: toPaise(150000), credit: 0 },
          { account_id: ac.accountIdForBank(bankId), debit: 0, credit: toPaise(150000) },
        ],
      });
    }
    // post the expense+payable for each period
    ac.postJournal({
      entryDate: monthAgo(m, 1), memo: `Upstream invoice UP-${period} (demo)`, source: 'provider', refId: inv,
      lines: [
        { account_id: ac.accountByCategory('upstream', 'expense'), debit: toPaise(150000), credit: 0 },
        { account_id: ac.accountByCategory('provider', 'liability'), debit: 0, credit: toPaise(150000) },
      ],
    });
  }

  /* ---------- customers ---------- */
  const insCust = db.prepare(
    `INSERT INTO customers(customer_code, name, father_name, cnic, phone, whatsapp, email, address, area_id, lat, lng,
      status, package_id, billing_day, install_charges, advance, pppoe_username, pop_id, olt_id, pon_port_id,
      splitter_id, box_id, box_port_no, onu_id, installed_at, created_at, notes)
     VALUES('RI-' || printf('%06d', (SELECT COUNT(*) FROM customers) + 1),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`
  );
  const insOnu = db.prepare('INSERT INTO onus(serial, mac, customer_id, box_port_id, status) VALUES(?,?,?,?, \'registered\')');
  const insConn = db.prepare(
    `INSERT INTO customer_connections(customer_id, pop_id, olt_id, pon_port_id, splitter_id, box_id, box_port_no, pppoe_username, status)
     VALUES(?,?,?,?,?,?,?,?, \'current\')`
  );

  const demoCustomers = [
    // name, father, cnic, phone, area, box, port, pkg, status, billingDay, monthsBilled (history)
    ['Ali Raza', 'Muhammad Aslam', '42101-1000001-1', '0300-1000001', 'satellite', 'BX-SAT-01', 1, 'home', 'active', 5, 3],
    ['Ayesha Siddiqui', 'Abdul Sattar', '42101-1000002-2', '0301-1000002', 'satellite', 'BX-SAT-01', 2, 'family', 'active', 5, 3],
    ['Hassan Mahmood', 'Haji Muhammad', '42101-1000003-3', '0302-1000003', 'satellite', 'BX-SAT-01', 3, 'starter', 'active', 10, 2],
    ['Fatima Noor', 'Noor Muhammad', '42101-1000004-4', '0303-1000004', 'johar', 'BX-JOH-01', 1, 'home', 'active', 5, 3],
    ['Usman Ghani', 'Ghulam Rasool', '42101-1000005-5', '0304-1000005', 'johar', 'BX-JOH-01', 2, 'business', 'active', 15, 2],
    ['Zainab Khalid', 'Khalid Mehmood', '42101-1000006-6', '0305-1000006', 'gulberg', 'BX-SAT-02', 1, 'family', 'suspended', 5, 3],
    ['Bilal Hussain', 'Hussain Ahmed', '42101-1000007-7', '0306-1000007', 'wapda', 'BX-SAT-02', 2, 'starter', 'active', 10, 1],
    ['Sana Javed', 'Javed Iqbal', '42101-1000008-8', '0307-1000008', 'model', null, null, 'home', 'pending', 5, 0],
    ['Kamran Akhtar', 'Akhtar Ali', '42101-1000009-9', '0308-1000009', 'satellite', 'BX-SAT-01', 4, 'home', 'active', 5, 2],
    ['Mehwish Tariq', 'Tariq Mehmood', '42101-1000010-1', '0309-1000010', 'gulberg', null, null, 'starter', 'application', 5, 0],
  ];
  const custIds = {};
  demoCustomers.forEach((c, i) => {
    const [name, father, cnic, phone, areaKey, boxKey, port, pkgKey, status, billDay, months] = c;
    const boxId = boxKey ? boxIds[boxKey] : null;
    const portRow = boxId ? db.prepare('SELECT id FROM box_ports WHERE box_id=? AND port_no=?').get(boxId, port) : null;
    const area = areaIds[areaKey];
    const info = insCust.run(
      name, father, cnic, cleanPhone(phone), cleanPhone(phone), null,
      `${port ? 'House ' + (100 + i) : 'Street ' + (i + 1)}, ${area}`, area,
      31.50 + i * 0.002, 74.29 + i * 0.002,
      status, pkg[pkgKey], billDay, toPaise(1000), 0,
      `rana${(1001 + i)}`,
      popId, oltId, ponIds[boxKey === 'BX-JOH-01' ? 1 : 0], boxKey === 'BX-SAT-01' ? splitterId : null,
      boxId, port || null, null,
      status === 'active' || status === 'suspended' ? monthAgo(months, billDay) : null,
      'DEMO seed customer'
    );
    const cid = Number(info.lastInsertRowid);
    custIds[name] = cid;
    if (portRow) {
      const onuId = Number(insOnu.run(`HGU-D0${(1000 + i)}`, `00:1A:2B:3C:4D:${(10 + i).toString(16).toUpperCase()}`, cid, portRow.id).lastInsertRowid);
      db.prepare('UPDATE customers SET onu_id=? WHERE id=?').run(onuId, cid);
      db.prepare(`UPDATE box_ports SET status='occupied' WHERE id=?`).run(portRow.id);
      insConn.run(cid, popId, oltId, ponIds[boxKey === 'BX-JOH-01' ? 1 : 0], boxKey === 'BX-SAT-01' ? splitterId : null, boxId, port, `rana${1001 + i}`);
    }
  });

  /* ---------- invoices + payments history ---------- */
  const P = { home: 3500, family: 4500, starter: 2500, business: 6500 };
  const activeNames = demoCustomers.filter((c) => c[8] === 'active').map((c) => c[0]);
  const suspendedName = demoCustomers.find((c) => c[8] === 'suspended')[0];

  function billMonth(name, m, { pay = true, method = 'cash' } = {}) {
    const c = demoCustomers.find((x) => x[0] === name);
    const pkgKey = c[7];
    const cid = custIds[name];
    const periodFrom = monthAgo(m, c[9]);
    const periodTo = addDays(periodFrom, 29);
    const dueDate = addDays(periodFrom, 10);
    const inv = createInvoice({
      customerId: cid,
      items: [{ item_type: 'package', description: `DEMO — ${c[7] === 'business' ? 'Business 50' : pkgKey === 'starter' ? 'Starter 10' : pkgKey === 'home' ? 'Home 20' : 'Family 30'} (${periodFrom} to ${periodTo})`, qty: 1, amount: toPaise(P[pkgKey]) }],
      periodFrom, periodTo, dueDate,
      generatedBy: 'demo-seed',
    });
    if (pay) {
      const p = recordPayment({
        customerId: cid, invoiceId: inv.id, amount: inv.total, method,
        transactionRef: `DEMO-${inv.invoice_no}`, accountId: method === 'cash' ? cashId : bankId,
        receivedBy: 'Demo Seed', notes: 'DEMO payment', force: true,
      }, 1);
      db.prepare(`UPDATE payments SET created_at=?, approved_at=? WHERE id=?`)
        .run(addDays(periodFrom, 3), addDays(periodFrom, 3), p.id);
      approvePayment(p.id, 1);
    }
    return inv;
  }

  for (const name of activeNames) {
    const c = demoCustomers.find((x) => x[0] === name);
    const months = c[10];
    for (let m = months; m >= 1; m--) {
      billMonth(name, m, { pay: true, method: m % 2 ? 'cash' : 'jazzcash' });
    }
  }
  // suspended customer: 2 old months paid, recent months unpaid → overdue
  billMonth(suspendedName, 3, { pay: true });
  billMonth(suspendedName, 2, { pay: true });
  billMonth(suspendedName, 1, { pay: false });
  billMonth(suspendedName, 0, { pay: false });

  // one pending payment awaiting owner approval (demo)
  const pendingCust = db.prepare('SELECT id, name FROM customers WHERE status=\'active\' LIMIT 1').get();
  const pendingInv = db.prepare('SELECT * FROM invoices WHERE customer_id=? AND status IN (\'unpaid\',\'partial\') ORDER BY id DESC LIMIT 1').get(pendingCust.id);
  if (pendingInv) {
    const p = recordPayment({
      customerId: pendingCust.id, invoiceId: pendingInv.id, amount: Math.min(toPaise(1000), pendingInv.balance),
      method: 'easypaisa', transactionRef: 'DEMO-EP-778811', accountId: cashId,
      receivedBy: 'Bilal Ahmed (Demo)', notes: 'Partial payment submitted from office', force: true,
    }, 1);
    db.prepare(`UPDATE payments SET created_at=? WHERE id=?`).run(todayPKT(), p.id);
  }

  /* ---------- website application + workflow demo ---------- */
  const appRef = 'APP-DEMO01';
  const newAppCust = db.prepare('SELECT id FROM customers WHERE name=?').get('Mehwish Tariq').id;
  db.prepare(
    `INSERT INTO applications(ref, customer_id, requested_package_id, channel, source_ip, status, feasibility, survey_notes)
     VALUES(?,?,?, 'website', '203.0.113.10', 'new', NULL, NULL)`
  ).run(appRef, newAppCust, pkg.starter);

  const pendingCustRow = db.prepare('SELECT id FROM customers WHERE name=?').get('Sana Javed');
  const pendAppId = Number(db.prepare(
    `INSERT INTO applications(ref, customer_id, requested_package_id, channel, status, feasibility, survey_notes, proposed_route, est_charges)
     VALUES('APP-DEMO02', ?, ?, 'owner', 'surveyed', 'feasible', 'Feasible — 45m drop from BX-JOH-01', 'BX-JOH-01 → Street 12 → house', 0)`
  ).run(pendingCustRow.id, pkg.home).lastInsertRowid);
  const instId = Number(db.prepare(
    `INSERT INTO installations(customer_id, staff_id, status, scheduled_at, notes) VALUES(?, ?, 'scheduled', ?, 'DEMO scheduled installation')`
  ).run(pendingCustRow.id, staff.tech, addDays(todayPKT(), 2)).lastInsertRowid);
  db.prepare(`UPDATE applications SET status='in_installation' WHERE id=?`).run(pendAppId);

  // completed installation demo record for an active customer
  const aliCust = custIds['Ali Raza'];
  db.prepare(
    `INSERT INTO installations(customer_id, staff_id, status, scheduled_at, completed_at, cable_meters, materials, notes)
     VALUES(?, ?, 'completed', ?, datetime('now'), 42, ?, 'DEMO completed installation')`
  ).run(aliCust, staff.tech, monthAgo(3, 8), JSON.stringify([{ item_id: items.fiber, name: 'Single-mode Fiber Cable (per meter)', qty: 42 }]));

  /* ---------- tickets ---------- */
  const insTicket = db.prepare(
    `INSERT INTO tickets(ticket_no, customer_id, category, priority, status, summary, details, box_id, assigned_to, created_at, resolved_at)
     VALUES(?,?,?,?,?,?,?,?,?, datetime('now'), ?)`
  );
  const t1 = Number(insTicket.run('TKT-00001', custIds['Fatima Noor'], 'slow_speed', 'medium', 'in_progress',
    'Speed dropping to 5 Mbps in evenings', 'Customer reports 5-8 Mbps during peak hours (demo)', boxIds['BX-JOH-01'], staff.tech, null).lastInsertRowid);
  db.prepare('INSERT INTO ticket_updates(ticket_id, status, note, by) VALUES(?,?,?,?)').run(t1, 'in_progress', 'Check RX power on ONU (demo note)', staff.tech);
  const t2 = Number(insTicket.run('TKT-00002', custIds['Hassan Mahmood'], 'billing', 'low', 'resolved',
    'Duplicate charge on last invoice', 'Verified — extra line item removed (demo)', null, null, null).lastInsertRowid);
  db.prepare(`UPDATE tickets SET resolved_at=datetime('now') WHERE id=?`).run(t2);
  db.prepare('INSERT INTO ticket_updates(ticket_id, status, note, by) VALUES(?,?,?,?)').run(t2, 'resolved', 'Refund of duplicate charge processed (demo)', 1);

  /* ---------- recovery + promises ---------- */
  db.prepare('INSERT INTO recovery_assignments(customer_id, staff_id, assigned_by, notes) VALUES(?,?,?,?)')
    .run(custIds[suspendedName], staff.collection, 1, 'Follow up — 2 invoices overdue (demo)');
  db.prepare('INSERT INTO promises_to_pay(customer_id, promise_date, amount, notes) VALUES(?,?,?,?)')
    .run(custIds[suspendedName], addDays(todayPKT(), 3), toPaise(4500), 'Will pay full amount Friday (demo)');

  /* ---------- staff salary history ---------- */
  for (const s of [staff.tech, staff.collection]) {
    const name = db.prepare('SELECT name FROM staff WHERE id=?').get(s).name;
    db.prepare('INSERT INTO staff_transactions(staff_id, stype, amount, account_id, notes) VALUES(?,?,?,?,?)')
      .run(s, 'salary', db.prepare('SELECT base_salary FROM staff WHERE id=?').get(s).base_salary, cashId, 'DEMO salary payment');
    ac.postJournal({
      entryDate: monthAgo(1, 25), memo: `Salary — ${name} (demo)`, source: 'salary', refId: s,
      lines: [
        { account_id: ac.accountByCategory('salary', 'expense'), debit: db.prepare('SELECT base_salary FROM staff WHERE id=?').get(s).base_salary, credit: 0 },
        { account_id: ac.accountIdForBank(cashId), debit: 0, credit: db.prepare('SELECT base_salary FROM staff WHERE id=?').get(s).base_salary },
      ],
    });
  }

  console.log('[seed] demo data complete:',
    db.prepare('SELECT COUNT(*) c FROM customers').get().c, 'customers |',
    db.prepare('SELECT COUNT(*) c FROM invoices').get().c, 'invoices |',
    db.prepare('SELECT COUNT(*) c FROM payments').get().c, 'payments');
}

module.exports = { seedDemo, SEED_CREDENTIALS };

if (require.main === module) {
  const { migrate } = require('./migrate');
  const { ensureChart } = require('./lib/accounting');
  const { ensureTemplates } = require('./lib/notify');
  migrate(); ensureChart(); ensureTemplates();
  if (process.argv.includes('--reset')) {
    const { db } = require('./db');
    db.exec('DELETE FROM customers; DELETE FROM invoices; DELETE FROM payments; DELETE FROM applications; DELETE FROM installations;');
    console.log('[seed] cleared demo customer records');
  }
  seedDemo();
}
