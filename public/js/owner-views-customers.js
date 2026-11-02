/* Owner views — Applications workflow, Customers, Packages */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= APPLICATIONS ================= */
V.applications = async function (params) {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Applications'), UI.el('div', { class: 'sub' }, 'Website + manual applications → survey → installation → activation')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => newApplicationForm(() => location.reload()) }, '+ New Application'))));
  const box = UI.el('div'); root.append(box);

  const [apps, pkgs] = await Promise.all([UI.api('/api/applications'), UI.api('/api/packages').catch(() => [])]);
  const status = (params.status || 'open').toLowerCase();
  const openStatuses = ['new', 'surveyed', 'in_installation'];
  let rows = apps;
  if (status === 'open') rows = apps.filter((a) => openStatuses.includes(a.status));
  else if (status !== 'all') rows = apps.filter((a) => a.status === status);

  const counts = {};
  apps.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  const tabs = UI.el('div', { class: 'tabs' });
  [['open', `Open (${openStatuses.reduce((s, x) => s + (counts[x] || 0), 0)})`],
   ['all', `All (${apps.length})`],
   ['new', `New (${counts.new || 0})`],
   ['surveyed', `Surveyed (${counts.surveyed || 0})`],
   ['in_installation', `In Installation (${counts.in_installation || 0})`],
   ['completed', `Completed (${counts.completed || 0})`],
   ['activated', `Activated (${counts.activated || 0})`],
   ['rejected', `Rejected (${counts.rejected || 0})`]]
    .forEach(([k, l]) => tabs.append(UI.el('button', {
      class: k === status ? 'active' : '',
      onclick: () => UI.Router.go(`#/applications/${k}`),
    }, l)));
  root.append(tabs);

  box.append(UI.el('div', { class: 'card' },
    UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'ref', label: 'Ref' },
        { key: 'name', label: 'Customer', render: (r) => `<b>${UI.esc(r.name)}</b> <span class="muted small">${UI.esc(r.customer_code || '')}</span>` },
        { key: 'phone', label: 'Phone' },
        { key: 'pkg', label: 'Requested Pkg' },
        { key: 'channel', label: 'Channel', render: (r) => UI.esc(r.channel) },
        { key: 'feasibility', label: 'Feasibility', render: (r) => r.feasibility ? UI.statusBadge(r.feasibility) : '—' },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { key: 'created_at', label: 'Received', render: (r) => UI.esc(UI.date(r.created_at)) },
      ],
      rows,
      onRow: (r) => UI.Router.go(`#/applications/${r.id}`),
      empty: 'No applications in this stage',
    }))));
  return root;
};

V.applicationDetail = async function (p) {
  const id = p.id;
  const root = UI.el('div');
  let a;
  try { a = await UI.api(`/api/applications/${id}`); } catch (e) { root.append(UI.el('div', { class: 'alert err' }, e.error || 'Not found')); return root; }
  const c = a.customer || {};
  const [pkgs, staff] = await Promise.all([UI.api('/api/packages'), UI.api('/api/staff')]);

  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {},
      UI.el('h1', {}, `Application ${a.ref}`, UI.statusBadge(a.status)),
      UI.el('div', { class: 'sub' }, `Received ${UI.dt(a.created_at)} • ${a.channel} channel`)),
    UI.el('div', { class: 'page-actions' },
      UI.el('a', { class: 'btn btn-outline btn-sm', href: `#/customers/${c.id}` }, 'Customer File'))));

  const grid = UI.el('div', { class: 'cards-2' });
  const info = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Applicant')));
  info.append(UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'kv' },
    UI.el('div', { class: 'k' }, 'Name'), UI.el('div', {}, `${c.name || '—'} (code ${c.customer_code || '—'})`),
    UI.el('div', { class: 'k' }, 'Father'), UI.el('div', {}, c.father_name || '—'),
    UI.el('div', { class: 'k' }, 'CNIC'), UI.el('div', {}, c.cnic || '—'),
    UI.el('div', { class: 'k' }, 'Phone'), UI.el('div', {}, c.phone || '—'),
    UI.el('div', { class: 'k' }, 'WhatsApp'), UI.el('div', {}, c.whatsapp || '—'),
    UI.el('div', { class: 'k' }, 'Address'), UI.el('div', {}, c.address || '—'),
    UI.el('div', { class: 'k' }, 'Requested Pkg'), UI.el('div', {}, a.pkg || '—'),
    UI.el('div', { class: 'k' }, 'Source IP'), UI.el('div', {}, a.source_ip || '—'))));
  grid.append(info);

  const survey = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Survey & Installation')));
  const sb = UI.el('div', { class: 'card-bd' });
  if (a.feasibility) sb.append(UI.el('div', { class: 'alert ' + (a.feasibility === 'feasible' ? 'ok' : a.feasibility === 'not_feasible' ? 'err' : 'warn') },
    (a.feasibility === 'feasible' ? '✅ ' : a.feasibility === 'not_feasible' ? '❌ ' : '⏳ ') + UI.esc(a.feasibility)));
  if (a.survey_notes) sb.append(UI.el('p', { class: 'small' }, 'Notes: ' + UI.esc(a.survey_notes)));
  if (a.proposed_route) sb.append(UI.el('p', { class: 'small' }, 'Route: ' + UI.esc(a.proposed_route)));
  if (a.est_charges) sb.append(UI.el('p', { class: 'small' }, `Est. installation charges: ${UI.money(a.est_charges)}`));
  if (a.reject_reason) sb.append(UI.el('p', { class: 'small' }, `Rejected: ${UI.esc(a.reject_reason)}`));
  if (!a.feasibility && !a.reject_reason) sb.append(UI.el('p', { class: 'muted small' }, 'Survey not done yet.'));
  sb.append(UI.el('div', { class: 'mt row' }, ...actionButtons(a, pkgs, staff)));
  survey.append(sb);
  grid.append(survey);
  root.append(grid);

  function actionButtons(app, pkgs, staff) {
    const out = [];
    if (app.status === 'new') {
      out.push(UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => surveyModal(app, () => location.reload()) }, '🔍 Record Survey'));
      out.push(UI.el('button', { class: 'btn btn-danger btn-sm', onclick: () => rejectModal(app, () => location.reload()) }, 'Reject'));
    }
    if (app.status === 'surveyed' && app.feasibility !== 'not_feasible') {
      out.push(UI.el('button', { class: 'btn btn-cyan btn-sm', onclick: () => scheduleInstallModal(app, staff, () => location.reload()) }, '🛠 Schedule Installation'));
      out.push(UI.el('button', { class: 'btn btn-danger btn-sm', onclick: () => rejectModal(app, () => location.reload()) }, 'Reject'));
    }
    if (app.status === 'completed') {
      out.push(UI.el('button', { class: 'btn btn-ok btn-sm', onclick: () => activateModal(app, pkgs, () => location.reload()) }, '⚡ Activate Connection'));
    }
    if (['completed', 'activated'].includes(app.status)) {
      out.push(UI.el('a', { class: 'btn btn-outline btn-sm', href: `#/customers/${c.id}` }, 'View Customer'));
    }
    return out;
  }

  function surveyModal(app, done) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'feasibility', label: 'Feasibility', type: 'select', options: [['feasible', 'Feasible'], ['not_feasible', 'Not Feasible'], ['pending', 'Pending / Revisit']], value: app.feasibility || 'feasible' },
      { name: 'survey_notes', label: 'Survey Notes', type: 'textarea' },
      { name: 'proposed_route', label: 'Proposed Route', placeholder: 'e.g. BX-JOH-01 → Street 12 → house' },
      { name: 'est_charges', label: 'Estimated Installation Charges (PKR)', type: 'number' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      try { await UI.api(`/api/applications/${app.id}/survey`, { method: 'POST', body: UI.readFields(inputs) }); UI.toast('Survey recorded'); m.close(); done(); }
      catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Save Survey');
    const m = UI.modal({ title: `Survey — ${app.ref}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }

  function rejectModal(app, done) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [{ name: 'reason', label: 'Rejection Reason (required — shown to customer & audited)', type: 'textarea' }]);
    const btn = UI.el('button', { class: 'btn btn-danger', onclick: async () => {
      const reason = UI.readFields(inputs).reason.trim();
      if (!reason) return UI.toast('Reason is required', 'err');
      try { await UI.api(`/api/applications/${app.id}/reject`, { method: 'POST', body: { reason } }); UI.toast('Application rejected'); m.close(); done(); }
      catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Reject Application');
    const m = UI.modal({ title: `Reject — ${app.ref}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }

  function scheduleInstallModal(app, staff, done) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'staff_id', label: 'Assign Technician', type: 'select', options: [[-1, '— select —'], ...staff.filter((s) => s.is_active).map((s) => [s.id, s.name])] },
      { name: 'date', label: 'Scheduled Date', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      if (!f.staff_id || f.staff_id === '-1') return UI.toast('Select a technician', 'err');
      try { await UI.api(`/api/applications/${app.id}/install`, { method: 'POST', body: { staff_id: f.staff_id, date: f.date, notes: f.notes } }); UI.toast('Installation scheduled'); m.close(); done(); }
      catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Schedule');
    const m = UI.modal({ title: `Schedule Installation — ${app.ref}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }

  function activateModal(app, pkgs, done) {
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Activation makes the customer ACTIVE, creates the first invoice (package + installation charges − advance) and syncs the PPPoE secret to the device when one is configured.'));
    const inputs = UI.fields(body, [
      { name: 'package_id', label: 'Package', type: 'select', options: [[-1, '— select —'], ...pkgs.filter((x) => x.is_active).map((x) => [x.id, `${x.name} — ${UI.money(x.price_monthly)}/mo`])] },
      { name: 'advance', label: 'Advance Received (PKR)', type: 'number', value: 0 },
      { name: 'billing_day', label: 'Billing Day (1-28)', type: 'number', value: 5 },
    ]);
    const chk = UI.el('input', { type: 'checkbox', checked: '' });
    const firstInv = UI.el('label', { class: 'small' }, chk, ' Generate first invoice now');
    const btn = UI.el('button', { class: 'btn btn-ok', onclick: async () => {
      const f = UI.readFields(inputs);
      if (!f.package_id || f.package_id === '-1') return UI.toast('Select a package', 'err');
      try {
        await UI.api(`/api/applications/${app.id}/activate`, { method: 'POST', body: {
          package_id: f.package_id, advance: f.advance, billing_day: f.billing_day,
          first_invoice: chk.checked,
        } });
        UI.toast('Customer activated 🎉'); m.close(); done();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Activate');
    const m = UI.modal({ title: `Activate — ${app.ref}`, body, footer: (ft, close) => ft.append(firstInv, UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }
  return root;
};

function newApplicationForm(done) {
  Promise.all([UI.api('/api/packages').catch(() => []), UI.api('/api/areas').catch(() => [])]).then(([pkgs, areas]) => {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Customer Name *' },
      { name: 'father_name', label: 'Father Name' },
      { name: 'cnic', label: 'CNIC', placeholder: '42101-1234567-1' },
      { name: 'phone', label: 'Phone', placeholder: '03XX-XXXXXXX' },
      { name: 'address', label: 'Address' },
      { name: 'area_id', label: 'Area', type: 'select', options: [[-1, '— select —'], ...areas.map((a) => [a.id, a.name])] },
      { name: 'package_id', label: 'Requested Package', type: 'select', options: [[-1, '— select —'], ...pkgs.map((p) => [p.id, p.name])] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      if (String(f.name).trim().length < 3) return UI.toast('Name required', 'err');
      try {
        const r = await UI.api('/api/applications', { method: 'POST', body: {
          name: f.name, father_name: f.father_name, cnic: f.cnic, phone: f.phone,
          address: f.address,
          area_id: f.area_id === '-1' ? null : Number(f.area_id),
          package_id: f.package_id === '-1' ? null : Number(f.package_id),
          notes: f.notes,
        } });
        UI.toast(`Application ${r.ref} created`); m.close(); done && done();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Create Application');
    const m = UI.modal({ title: 'New Application (Manual)', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  });
}

/* ================= CUSTOMERS ================= */
V.customers = async function () {
  const root = UI.el('div');
  const state = { page: '1', status: '', area_id: '', q: '', package_id: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Customers'), UI.el('div', { class: 'sub' }, 'Complete customer files with billing, network and audit history')),
    UI.el('div', { class: 'page-actions' },
      UI.el('button', { class: 'btn btn-outline', onclick: () => { const a = document.createElement('a'); a.href = '/api/customers/export.csv'; a.download = 'customers.csv'; a.click(); } }, '⬇ CSV Export'),
      UI.el('button', { class: 'btn btn-outline', onclick: () => importCsv() }, '⬆ CSV Import'),
      UI.el('button', { class: 'btn btn-primary', onclick: () => customerForm(null, () => render()) }, '+ Add Customer'))));

  const [pkgs, areas] = await Promise.all([UI.api('/api/packages').catch(() => []), UI.api('/api/areas').catch(() => [])]);
  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  const sel = (name, list) => {
    const s = UI.el('select', { onchange: () => { state[name] = s.value; state.page = '1'; render(); } }, UI.el('option', { value: '' }, 'All'));
    list.forEach(([x, y]) => s.append(UI.el('option', { value: x }, y)));
    return s;
  };
  fRow.append(sel('status', [['application', 'Application'], ['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended'], ['disconnected', 'Disconnected'], ['terminated', 'Terminated']]));
  fRow.append(sel('area_id', areas.map((a) => [a.id, a.name])));
  fRow.append(sel('package_id', pkgs.map((p) => [p.id, p.name])));
  const qInp = UI.el('input', { placeholder: 'Search name / code / phone / CNIC — press Enter' });
  qInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.q = qInp.value.trim(); state.page = '1'; render(); } });
  fRow.append(qInp);
  root.append(filters);

  const box = UI.el('div', { class: 'card' });
  root.append(box);
  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/customers?${qs}`);
    box.replaceChildren(
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'customer_code', label: 'Code' },
          { key: 'name', label: 'Name', render: (r) => `<b>${UI.esc(r.name)}</b><br><span class="muted small">${UI.esc(r.father_name || '')}</span>` },
          { key: 'phone', label: 'Phone' },
          { key: 'cnic', label: 'CNIC', render: (r) => UI.esc(r.cnic || '—') },
          { key: 'package_name', label: 'Package' },
          { key: 'pppoe_username', label: 'PPPoE' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
          { key: 'dues', label: 'Dues', cls: 'num', render: (r) => r.dues > 0 ? `<b style="color:var(--bad)">${UI.money(r.dues)}</b>` : UI.money(0) },
        ],
        rows: d.rows,
        onRow: (r) => UI.Router.go(`#/customers/${r.id}`),
      })),
      UI.pager(d.page, d.pages, (pg) => { state.page = String(pg); render(); }));
  }
  await render();

  function customerForm(c, done) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Full Name *', value: c ? c.name : '' },
      { name: 'father_name', label: 'Father Name', value: c ? c.father_name || '' : '' },
      { name: 'cnic', label: 'CNIC', value: c ? c.cnic || '' : '' },
      { name: 'phone', label: 'Phone', value: c ? c.phone || '' : '' },
      { name: 'whatsapp', label: 'WhatsApp', value: c ? c.whatsapp || '' : '' },
      { name: 'email', label: 'Email', value: c ? c.email || '' : '' },
      { name: 'address', label: 'Address', value: c ? c.address || '' : '' },
      { name: 'area_id', label: 'Area', type: 'select', options: [[-1, '— select —'], ...areas.map((a) => [a.id, a.name])], value: c && c.area_id ? String(c.area_id) : '-1' },
      { name: 'package_id', label: 'Package', type: 'select', options: [[-1, '— none —'], ...pkgs.map((p) => [p.id, p.name])], value: c && c.package_id ? String(c.package_id) : '-1' },
      { name: 'billing_day', label: 'Billing Day (1-28)', type: 'number', value: c ? c.billing_day : 5 },
      { name: 'pppoe_username', label: 'PPPoE Username', value: c ? c.pppoe_username || '' : '' },
      { name: 'status', label: 'Status', type: 'select', options: [['pending', 'Pending'], ['application', 'Application'], ['active', 'Active'], ['suspended', 'Suspended'], ['disconnected', 'Disconnected'], ['terminated', 'Terminated']], value: c ? c.status : 'pending' },
      { name: 'install_charges', label: 'Installation Charges (PKR)', type: 'number', value: c ? (c.install_charges / 100) : 0 },
      { name: 'advance', label: 'Advance Balance (PKR)', type: 'number', value: c ? (c.advance / 100) : 0 },
      { name: 'notes', label: 'Notes', type: 'textarea', value: c ? c.notes || '' : '' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      if (String(f.name).trim().length < 3) return UI.toast('Name required', 'err');
      try {
        if (c) { await UI.api(`/api/customers/${c.id}`, { method: 'PUT', body: f }); UI.toast('Customer updated'); }
        else { const r = await UI.api('/api/customers', { method: 'POST', body: f }); UI.toast(`Customer ${r.code} created`); }
        m.close(); done && done();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, c ? 'Save Changes' : 'Create Customer');
    const m = UI.modal({ title: c ? `Edit ${c.customer_code}` : 'Add Customer', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }

  function importCsv() {
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Paste CSV (header + rows). Columns: name, father_name, cnic, phone, whatsapp, address, area, package, status. Duplicates are skipped and reported.'));
    const ta = UI.el('textarea', { style: 'width:100%; min-height:140px; font-family:monospace; font-size:.8rem; border:1.5px solid var(--line-2); border-radius:9px; padding:10px;' });
    body.append(ta);
    const file = UI.el('input', { type: 'file', accept: '.csv', onchange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });
    body.append(file);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      try {
        const r = await UI.api('/api/customers/import', { method: 'POST', body: { text: ta.value } });
        UI.toast(`Imported ${r.created} — skipped ${r.skipped.length}, errors ${r.errors.length}`);
        m.close(); render();
        if (r.errors.length || r.skipped.length) {
          UI.modal({ title: 'Import Report', wide: true, body:
            `<div class="alert ok">Created: ${r.created}${r.createdNames && r.createdNames.length ? ' — ' + r.createdNames.map(UI.esc).join(', ') : ''}</div>` +
            `<div class="alert warn">Skipped: ${r.skipped.map((x) => `Row ${x.row}: ${x.reason}`).map(UI.esc).join('<br>') || 'none'}</div>` +
            `<div class="alert err">Errors: ${r.errors.map((x) => `Row ${x.row}: ${x.error}`).map(UI.esc).join('<br>') || 'none'}</div>` });
        }
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Import');
    const m = UI.modal({ title: 'Import Customers (CSV)', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => m.close() }, 'Cancel'), btn) });
  }
  return root;
};

/* ================= CUSTOMER DETAIL ================= */
V.customerDetail = async function (p) {
  const id = p.id;
  const root = UI.el('div');
  let c;
  try { c = await UI.api(`/api/customers/${id}`); } catch (e) { root.append(UI.el('div', { class: 'alert err' }, e.error || 'Not found')); return root; }

  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {},
      UI.el('h1', {}, `${c.name}`, UI.statusBadge(c.status), c.device_status ? UI.statusBadge(c.device_status) : null),
      UI.el('div', { class: 'sub' }, `${c.customer_code} • ${c.package ? c.package.name : 'no package'} • ${UI.money(c.dues)} outstanding`)),
    UI.el('div', { class: 'page-actions' },
      UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => V.recordPaymentModal({ customerId: c.id, customerName: c.name, invoiceId: c.lastInvoice && c.lastInvoice.balance > 0 ? c.lastInvoice.id : null }) }, '💰 Payment'),
      UI.el('button', { class: 'btn btn-outline btn-sm', onclick: () => V.newInvoiceModal(c) }, '🧾 Invoice'),
      UI.el('button', { class: 'btn btn-outline btn-sm', onclick: () => V.newTicketModal(c) }, '🎫 Ticket'),
      UI.el('button', { class: 'btn btn-warn btn-sm', onclick: () => statusModal() }, 'Change Status'),
      UI.el('button', { class: 'btn btn-outline btn-sm', onclick: () => packageModal() }, 'Change Package'))));

  const grid = UI.el('div', { class: 'cards-2 mb' });

  const prof = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Profile & Connection')));
  prof.append(UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'kv' },
    UI.el('div', { class: 'k' }, 'Father'), UI.el('div', {}, c.father_name || '—'),
    UI.el('div', { class: 'k' }, 'CNIC'), UI.el('div', {}, c.cnic || '—'),
    UI.el('div', { class: 'k' }, 'Phone'), UI.el('div', {}, `${c.phone || '—'}${c.whatsapp ? ' • WA ' + c.whatsapp : ''}`),
    UI.el('div', { class: 'k' }, 'Address'), UI.el('div', {}, `${c.address || '—'}${c.area ? ' — ' + c.area.name : ''}`),
    UI.el('div', { class: 'k' }, 'Billing'), UI.el('div', {}, `Day ${c.billing_day} • ${c.payment_terms} • Install ${UI.money(c.install_charges)} • Advance ${UI.money(c.advance)}`),
    UI.el('div', { class: 'k' }, 'PPPoE'), UI.el('div', {}, c.pppoe_username || '—'),
    UI.el('div', { class: 'k' }, 'Network Path'), UI.el('div', {}, networkPath(c)),
    UI.el('div', { class: 'k' }, 'ONU'), UI.el('div', {}, c.onu ? `${c.onu.model || 'ONU'}${c.onu.serial ? ' • SN ' + c.onu.serial : ''}${c.onu.mac ? ' • ' + c.onu.mac : ''}` : '—'),
    UI.el('div', { class: 'k' }, 'Installed'), UI.el('div', {}, UI.date(c.installed_at)),
    UI.el('div', { class: 'k' }, 'Notes'), UI.el('div', {}, c.notes || '—'))));
  grid.append(prof);

  const tl = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Activity Timeline')));
  const ul = UI.el('ul', { class: 'timeline' });
  (c.timeline || []).slice(0, 12).forEach((x) => {
    let det = '';
    try { det = x.details ? JSON.stringify(x.details).slice(0, 90) : ''; } catch { /* */ }
    ul.append(UI.el('li', {}, UI.el('div', { class: 't' }, x.action), UI.el('div', { class: 'd' }, `${UI.dt(x.at)} ${det}`)));
  });
  if (!c.timeline || !c.timeline.length) ul.append(UI.el('li', {}, UI.el('span', { class: 'muted' }, 'No activity yet')));
  tl.append(UI.el('div', { class: 'card-bd' }, ul));
  grid.append(tl);
  root.append(grid);

  const tabs = UI.el('div', { class: 'tabs' });
  const tabBox = UI.el('div');
  const tabDefs = [
    [`Invoices (${(c.invoices || []).length})`, renderInvoices],
    [`Payments (${(c.payments || []).length})`, renderPayments],
    ['Ledger', renderLedger],
    [`Documents (${(c.documents || []).length})`, renderDocs],
    [`Tickets (${(c.tickets || []).length})`, renderTickets],
  ];
  let first = true;
  tabDefs.forEach(([label, fn]) => {
    const b = UI.el('button', { onclick: () => { tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); fn(); } }, label);
    tabs.append(b);
    if (first) { b.classList.add('active'); first = false; }
  });
  root.append(tabs, tabBox);
  renderInvoices();

  function renderInvoices() {
    tabBox.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'period_from', label: 'Period', render: (r) => `${UI.date(r.period_from)} → ${UI.date(r.period_to)}` },
        { key: 'due_date', label: 'Due' },
        { key: 'total', label: 'Total', cls: 'num', render: (r) => UI.money(r.total) },
        { key: 'paid', label: 'Paid', cls: 'num', render: (r) => UI.money(r.paid) },
        { key: 'balance', label: 'Balance', cls: 'num', render: (r) => r.balance > 0 ? `<b style="color:var(--bad)">${UI.money(r.balance)}</b>` : UI.money(0) },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
      ],
      rows: c.invoices || [],
      onRow: (r) => UI.Router.go(`#/invoices/${r.id}`),
    }))));
  }
  function renderPayments() {
    tabBox.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'payment_ref', label: 'Ref' },
        { key: 'created_at', label: 'Date', render: (r) => UI.dt(r.created_at) },
        { key: 'method', label: 'Method', render: (r) => UI.statusBadge(r.method) },
        { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
      ],
      rows: c.payments || [],
      empty: 'No payments',
    }))));
  }
  function renderLedger() {
    tabBox.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'at', label: 'Date', render: (r) => UI.dt(r.at) },
        { key: 'memo', label: 'Memo' },
        { key: 'direction', label: 'Dr/Cr', render: (r) => r.direction === 'debit' ? 'Debit' : 'Credit' },
        { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
        { key: 'balance', label: 'Running Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
      ],
      rows: (c.ledger || []).slice().reverse(),
      empty: 'No ledger entries',
    }))));
  }
  function renderDocs() {
    const list = UI.el('div');
    (c.documents || []).forEach((doc) => {
      list.append(UI.el('div', { class: 'file-item' },
        UI.el('span', {}, `${UI.esc(doc.type)} — ${UI.esc(doc.original_name)} <span class="doc-badge">${UI.esc(doc.mime_type || '')}</span>`),
        UI.el('span', { class: 'row' },
          UI.el('a', { class: 'btn btn-outline btn-xs', href: `/api/files/customer/${doc.id}` }, 'View'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete document ${doc.original_name}?`))) return;
            try { await UI.api(`/api/customer-documents/${doc.id}`, { method: 'DELETE' }); UI.toast('Deleted'); location.reload(); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Delete'))));
    });
    if (!c.documents || !c.documents.length) list.append(UI.el('p', { class: 'muted small' }, 'No documents uploaded yet.'));
    const inp = UI.el('input', { type: 'file' });
    const btn = UI.el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
      const f = inp.files[0];
      if (!f) return UI.toast('Choose a file first', 'err');
      const fd = new FormData();
      fd.append('file', f);
      try {
        const res = await fetch(`/api/customers/${c.id}/documents`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': UI.csrf } });
        const j = await res.json();
        if (!res.ok) return UI.toast(j.error || 'Upload failed', 'err');
        UI.toast('Document uploaded'); location.reload();
      } catch (e) { UI.toast(e.message, 'err'); }
    } }, '⬆ Upload Document');
    list.append(UI.el('div', { class: 'row mt' }, inp, btn));
    tabBox.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, list)));
  }
  function renderTickets() {
    tabBox.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'ticket_no', label: 'Ticket' },
        { key: 'category', label: 'Category' },
        { key: 'priority', label: 'Priority', render: (r) => UI.statusBadge(r.priority) },
        { key: 'summary', label: 'Summary' },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { key: 'created_at', label: 'Created', render: (r) => UI.date(r.created_at) },
      ],
      rows: c.tickets || [],
      empty: 'No tickets',
    }))));
  }

  function networkPath(cc) {
    const parts = [];
    if (cc.onu_id) parts.push(`ONU #${cc.onu_id}`);
    if (cc.box) parts.push(`${cc.box.name} P${cc.box_port_no}`);
    if (cc.pon_port_id) parts.push(`PON ${cc.pon_port_id}`);
    if (cc.olt_id) parts.push(`OLT ${cc.olt_id}`);
    if (cc.pop_id) parts.push(`POP ${cc.pop_id}`);
    return parts.length ? parts.join(' → ') : 'Not mapped to network yet';
  }

  function statusModal() {
    const body = UI.el('div');
    UI.fields(body, [
      { name: 'status', label: 'New Status', type: 'select', options: [['active', 'Active'], ['pending', 'Pending'], ['suspended', 'Suspended'], ['disconnected', 'Disconnected'], ['terminated', 'Terminated']], value: c.status },
      { name: 'reason', label: 'Reason (mandatory — audited & notified to customer)', type: 'textarea' },
    ]);
    const sSel = body.querySelector('select'), sTa = body.querySelector('textarea');
    const btn = UI.el('button', { class: 'btn btn-warn', onclick: async () => {
      if (!sTa.value.trim()) return UI.toast('Reason required', 'err');
      try { await UI.api(`/api/customers/${c.id}/status`, { method: 'POST', body: { status: sSel.value, reason: sTa.value } }); UI.toast('Status changed'); location.reload(); }
      catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Change Status');
    UI.modal({ title: 'Change Customer Status', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  function packageModal() {
    UI.api('/api/packages').then((pkgs) => {
      const body = UI.el('div');
      body.append(UI.el('div', { class: 'alert info' }, 'Package change is prorate-chargeable: remaining days of the current cycle are adjusted automatically.'));
      UI.fields(body, [
        { name: 'package_id', label: 'New Package', type: 'select', options: [[-1, '— select —'], ...pkgs.filter((x) => x.is_active).map((x) => [x.id, `${x.name} — ${UI.money(x.price_monthly)}/mo`])] },
        { name: 'effective_date', label: 'Effective Date', type: 'date', value: new Date().toISOString().slice(0, 10) },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]);
      const pSel = body.querySelector('select'), dInp = body.querySelector('input[type=date]'), nTa = body.querySelector('textarea');
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        try {
          const r = await UI.api(`/api/customers/${c.id}/package`, { method: 'POST', body: { package_id: pSel.value, effective_date: dInp.value, notes: nTa.value } });
          UI.toast('Package updated' + (r.pro_rata !== undefined && r.pro_rata !== null ? ` — prorate ${UI.money(r.pro_rata)}` : ''));
          location.reload();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Apply Change');
      UI.modal({ title: 'Change Package', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    });
  }
  return root;
};

/* ================= PACKAGES ================= */
V.packages = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Packages'), UI.el('div', { class: 'sub' }, 'Published on the customer website automatically')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => pkgForm(null) }, '+ New Package'))));
  const box = UI.el('div'); root.append(box);
  const render = async () => {
    const rows = await UI.api('/api/packages');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Package', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        { key: 'download_mbps', label: 'Speed', render: (r) => `${r.download_mbps}/${r.upload_mbps} Mbps` },
        { key: 'price_monthly', label: 'Monthly', cls: 'num', render: (r) => UI.money(r.price_monthly) },
        { key: 'install_fee', label: 'Install Fee', cls: 'num', render: (r) => UI.money(r.install_fee) },
        { key: 'cycle_days', label: 'Cycle', render: (r) => `${r.cycle_days}d` },
        { key: 'data_limit_mb', label: 'Data Limit', render: (r) => r.data_limit_mb ? `${r.data_limit_mb} MB` : 'Unlimited' },
        { key: 'grace_days', label: 'Grace', render: (r) => `${r.grace_days}d` },
        { key: 'device_profile', label: 'Profile' },
        { key: 'is_active', label: 'Status', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('disabled') },
      ],
      rows,
      onRow: (r) => pkgForm(r),
    }))));
  };
  await render();

  function pkgForm(pkg) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Name *', value: pkg ? pkg.name : '' },
      { name: 'download_mbps', label: 'Download (Mbps)', type: 'number', value: pkg ? pkg.download_mbps : 20 },
      { name: 'upload_mbps', label: 'Upload (Mbps)', type: 'number', value: pkg ? pkg.upload_mbps : 8 },
      { name: 'price_monthly', label: 'Monthly Price (PKR)', type: 'number', value: pkg ? pkg.price_monthly / 100 : 2500 },
      { name: 'install_fee', label: 'Install Fee (PKR)', type: 'number', value: pkg ? pkg.install_fee / 100 : 1000 },
      { name: 'cycle_days', label: 'Cycle (days)', type: 'number', value: pkg ? pkg.cycle_days : 30 },
      { name: 'data_limit_mb', label: 'Data Limit (MB, blank = unlimited)', type: 'number', value: pkg && pkg.data_limit_mb ? pkg.data_limit_mb : '' },
      { name: 'grace_days', label: 'Grace Days', type: 'number', value: pkg ? pkg.grace_days : 3 },
      { name: 'device_profile', label: 'Device Profile', value: pkg ? pkg.device_profile || '' : '' },
      { name: 'description', label: 'Description (shown on website)', type: 'textarea', value: pkg ? pkg.description || '' : '' },
      { name: 'is_active', label: 'Active (shown publicly)', type: 'checkbox', value: pkg ? !!pkg.is_active : true },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        if (pkg) {
          await UI.api(`/api/packages/${pkg.id}`, { method: 'PUT', body: f });
          UI.toast('Package updated');
        } else {
          await UI.api('/api/packages', { method: 'POST', body: f });
          UI.toast('Package created');
        }
        m.close(); render();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, pkg ? 'Save' : 'Create');
    const m = UI.modal({ title: pkg ? `Edit ${pkg.name}` : 'New Package', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }
  return root;
};



/* ================= SHARED MODALS (used by customers & billing views) ================= */
V.recordPaymentModal = async function ({ customerId = null, customerName = '', invoiceId = null, balance = null } = {}) {
  const [accounts, customers] = await Promise.all([
    UI.api('/api/cash-accounts').catch(() => []),
    customerId ? Promise.resolve([]) : (async () => {
      const out = [];
      let page = 1;
      for (;;) {
        const d = await UI.api(`/api/customers?page=${page}`);
        out.push(...d.rows);
        if (page >= d.pages) break;
        page++;
      }
      return out;
    })(),
  ]);
  const body = UI.el('div');
  let custSel = null;
  if (!customerId) {
    const f = UI.el('div', { class: 'field' });
    f.append(UI.el('label', {}, 'Customer *'));
    custSel = UI.el('select');
    custSel.append(UI.el('option', { value: '' }, '— select —'));
    customers.forEach((c) => custSel.append(UI.el('option', { value: c.id }, `${c.customer_code} — ${c.name} (${c.phone || 'no phone'})`)));
    f.append(custSel);
    body.append(f);
  }
  const inputs = UI.fields(body, [
    { name: 'amount', label: 'Amount (PKR) *', type: 'number', min: 0 },
    { name: 'method', label: 'Method', type: 'select', options: [['cash', 'Cash'], ['bank_transfer', 'Bank Transfer'], ['jazzcash', 'JazzCash'], ['easypaisa', 'Easypaisa'], ['raast', 'Raast QR'], ['other', 'Other']] },
    { name: 'transaction_ref', label: 'Transaction Reference (for online methods)', placeholder: 'e.g. EP-123456' },
    { name: 'invoice_id', label: 'Apply To Invoice (blank = advance)', type: 'select', options: [[-1, '— no invoice (advance) —'], ...(invoiceId ? [[invoiceId, `Invoice ${invoiceId}${balance !== null ? ' (balance ' + UI.money(balance) + ')' : ''}`]] : [])] },
    { name: 'account_id', label: 'Receive Into', type: 'select', options: [[-1, 'Auto (cash/bank)'], ...accounts.map((a) => [a.id, `${a.name} (${a.kind})`])] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]);
  const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
    const f = UI.readFields(inputs);
    const cid = customerId || (custSel ? Number(custSel.value) : null);
    if (!cid) return UI.toast('Select a customer', 'err');
    const payload = {
      customer_id: cid, amount: f.amount, method: f.method,
      transaction_ref: f.transaction_ref || null,
      invoice_id: f.invoice_id === '-1' ? null : Number(f.invoice_id),
      account_id: f.account_id === '-1' ? null : Number(f.account_id),
      notes: f.notes || null,
    };
    try {
      const r = await UI.api('/api/payments', { method: 'POST', body: payload });
      UI.toast(`${r.payment_ref} recorded — pending approval`);
      m.close(); location.reload();
    } catch (e) {
      if (e.duplicate) {
        UI.modal({ title: '⚠️ Duplicate Transaction Reference', body:
          `<div class="alert err">This reference was already used by <b>${UI.esc(e.duplicate.payment_ref || '')}</b> (${UI.esc(e.duplicate.name || '')}, ${UI.money(e.duplicate.amount || 0)}).</div>
           <p class="small">If this is genuinely a separate payment that reuses the same reference, tick the confirmation and save again. Otherwise fix the reference.</p>
           <label class="small"><input type="checkbox" id="dupConfirm"> I confirm this is not a duplicate</label>`,
          footer: (ft, close) => ft.append(
            UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
            UI.el('button', { class: 'btn btn-warn', onclick: async () => {
              if (!document.getElementById('dupConfirm').checked) return UI.toast('Tick the confirmation box', 'err');
              try {
                const r2 = await UI.api('/api/payments', { method: 'POST', body: { ...payload, force: true } });
                UI.toast(`${r2.payment_ref} recorded (forced)`); close(); m.close(); location.reload();
              } catch (e2) { UI.toast(e2.error || e2.message, 'err'); }
            } }, 'Save Anyway')) });
        return;
      }
      UI.toast(e.error || e.message, 'err');
    }
  } }, 'Record Payment');
  const m = UI.modal({ title: customerId ? `Record Payment — ${customerName}` : 'Record Payment', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
};

V.newInvoiceModal = async function (c) {
  const body = UI.el('div');
  const today = new Date().toISOString().slice(0, 10);
  const lines = UI.el('div', { style: 'margin-bottom:10px;' });
  const addLine = (i = 0) => {
    const tr = UI.el('div', { class: 'row journal-lines', style: 'margin-bottom:6px; align-items:flex-end;' });
    tr.append(UI.el('input', { placeholder: 'item_type', style: 'width:150px; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px; font-size:.8rem;', value: i === 0 ? 'package' : '', list: 'itemTypes' }));
    tr.append(UI.el('input', { placeholder: 'Description', style: 'flex:1; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px; font-size:.8rem;', value: i === 0 && c ? `Package — ${c.package ? c.package.name : 'select on activation'}` : '' }));
    tr.append(UI.el('input', { type: 'number', placeholder: 'PKR', style: 'width:110px; text-align:right; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px; font-size:.8rem;' }));
    lines.append(tr);
  };
  addLine(0);
  const dl = UI.el('datalist', { id: 'itemTypes' });
  ['package', 'installation', 'discount', 'advance_adjustment', 'previous_balance', 'late_fee', 'other'].forEach((t) => dl.append(UI.el('option', { value: t })));
  const grid = UI.el('div', { class: 'grid-3 mb' });
  body.append(dl, lines, UI.el('button', { class: 'btn btn-ghost btn-sm', onclick: () => addLine() }, '+ Add Line'), grid);
  const inputs = UI.fields(grid, [
    { name: 'due_date', label: 'Due Date', type: 'date', value: today },
    { name: 'period_from', label: 'Period From', type: 'date', value: today },
    { name: 'period_to', label: 'Period To', type: 'date', value: today },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]);
  const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
    const items = [...lines.children].map((tr) => ({
      item_type: tr.children[0].value || 'other',
      description: tr.children[1].value || 'Charge',
      amount: parseFloat(tr.children[2].value) || 0,
    })).filter((i) => i.amount !== 0);
    if (!items.length) return UI.toast('Add at least one line with amount', 'err');
    const f = UI.readFields(inputs);
    try {
      const r = await UI.api('/api/invoices', { method: 'POST', body: { customer_id: c.id, items, due_date: f.due_date, period_from: f.period_from, period_to: f.period_to, notes: f.notes } });
      UI.toast(`Invoice ${r.invoice_no} created`); m.close(); location.reload();
    } catch (e) { UI.toast(e.error || e.message, 'err'); }
  } }, 'Create Invoice');
  const m = UI.modal({ title: `New Invoice — ${c.customer_code} ${c.name}`, body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
};

V.newTicketModal = async function (c) {
  const body = UI.el('div');
  const inputs = UI.fields(body, [
    { name: 'category', label: 'Category', type: 'select', options: [['no_internet', 'No Internet'], ['slow_speed', 'Slow Speed'], ['onu_issue', 'ONU Issue'], ['fiber_damage', 'Fiber Damage'], ['router_issue', 'Router Issue'], ['billing', 'Billing'], ['shifting', 'Shifting'], ['other', 'Other']] },
    { name: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
    { name: 'summary', label: 'Summary *' },
    { name: 'details', label: 'Details', type: 'textarea' },
  ]);
  const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
    const v = UI.readFields(inputs);
    if (!v.summary.trim()) return UI.toast('Summary required', 'err');
    try { await UI.api('/api/tickets', { method: 'POST', body: { ...v, customer_id: c.id } }); UI.toast('Ticket created'); m.close(); location.reload(); }
    catch (e) { UI.toast(e.error || e.message, 'err'); }
  } }, 'Create Ticket');
  const m = UI.modal({ title: `New Ticket — ${c.customer_code} ${c.name}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
};
