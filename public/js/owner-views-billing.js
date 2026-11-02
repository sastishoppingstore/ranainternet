/* Owner views — Invoices, Payments, Recovery, Ledger */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= INVOICES ================= */
V.invoices = async function () {
  const root = UI.el('div');
  const state = { page: '1', status: '', customer_id: '', from: '', to: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Invoices'), UI.el('div', { class: 'sub' }, 'Unique numbered, PDF with logo + QR, never hard-deleted')),
    UI.el('div', { class: 'page-actions' },
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const r = await UI.api('/api/invoices/generate-now', { method: 'POST', body: {} });
        UI.toast(`${r.created} invoice(s) generated`);
        if (r.created) render();
      } }, '⚡ Generate Due Now'),
      UI.el('button', { class: 'btn btn-outline', onclick: () => pickCustomerThenInvoice() }, '+ Manual Invoice'))));

  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  fRow.append(UI.el('select', { onchange: (e) => { state.status = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All statuses'], ['unpaid', 'Unpaid'], ['partial', 'Partial'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) => UI.el('option', { value: v }, l))));
  const custSel = UI.el('select', { id: 'invCust', onchange: (e) => { state.customer_id = e.target.value; state.page = '1'; render(); } });
  fRow.append(custSel);
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.from = e.target.value; state.page = '1'; render(); }, title: 'From due date' }));
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.to = e.target.value; state.page = '1'; render(); }, title: 'To due date' }));
  root.append(filters);

  // populate customer filter (paged)
  (async () => {
    const sel = custSel;
    sel.append(UI.el('option', { value: '' }, 'All customers'));
    let page = 1;
    for (;;) {
      const d = await UI.api(`/api/customers?page=${page}`).catch(() => null);
      if (!d) break;
      d.rows.forEach((c) => sel.append(UI.el('option', { value: c.id }, `${c.customer_code} — ${c.name}`)));
      if (page >= d.pages) break;
      page++;
    }
  })();

  const box = UI.el('div', { class: 'card' });
  root.append(box);
  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/invoices?${qs}`);
    box.replaceChildren(
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'invoice_no', label: 'Invoice' },
          { key: 'customer_name', label: 'Customer', render: (r) => `${UI.esc(r.customer_name)} <span class="muted small">${UI.esc(r.customer_code || '')}</span>` },
          { key: 'package_name', label: 'Package' },
          { key: 'due_date', label: 'Due' },
          { key: 'total', label: 'Total', cls: 'num', render: (r) => UI.money(r.total) },
          { key: 'paid', label: 'Paid', cls: 'num', render: (r) => UI.money(r.paid) },
          { key: 'balance', label: 'Balance', cls: 'num', render: (r) => r.balance > 0 ? `<b style="color:var(--bad)">${UI.money(r.balance)}</b>` : UI.money(0) },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        ],
        rows: d.rows,
        onRow: (r) => UI.Router.go(`#/invoices/${r.id}`),
      })),
      UI.pager(d.page, d.pages, (pg) => { state.page = String(pg); render(); }));
  }
  await render();

  async function pickCustomerThenInvoice() {
    const sel = custSel;
    if (sel.value) {
      const c = await UI.api(`/api/customers/${sel.value}`);
      V.newInvoiceModal(c);
    } else {
      UI.toast('Pick a customer in the filter above first', 'warn');
    }
  }
  return root;
};

V.invoiceDetail = async function (p) {
  const root = UI.el('div');
  let inv;
  try { inv = await UI.api(`/api/invoices/${p.id}`); } catch (e) { root.append(UI.el('div', { class: 'alert err' }, e.error || 'Not found')); return root; }
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {},
      UI.el('h1', {}, `Invoice ${inv.invoice_no}`, UI.statusBadge(inv.status)),
      UI.el('div', { class: 'sub' }, `${inv.customer.name} (${inv.customer.customer_code}) • ${UI.date(inv.period_from)} → ${UI.date(inv.period_to)} • Due ${UI.date(inv.due_date)}`)),
    UI.el('div', { class: 'page-actions' },
      UI.el('a', { class: 'btn btn-primary', href: `/api/invoices/${inv.id}/pdf`, target: '_blank' }, '📄 Download PDF'),
      inv.balance > 0 ? UI.el('button', { class: 'btn btn-ok', onclick: () => V.recordPaymentModal({ customerId: inv.customer_id, customerName: inv.customer.name, invoiceId: inv.id, balance: inv.balance }) }, '💰 Receive Payment') : null)));

  const grid = UI.el('div', { class: 'cards-2 mb' });
  const items = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Line Items')));
  items.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
    columns: [
      { key: 'item_type', label: 'Type', render: (r) => UI.esc(String(r.item_type).replace('_', ' ')) },
      { key: 'description', label: 'Description' },
      { key: 'qty', label: 'Qty', cls: 'num' },
      { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
    ],
    rows: inv.items || [],
  })));
  grid.append(items);

  const pay = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Payments Received')));
  pay.append(UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'kv' },
    UI.el('div', { class: 'k' }, 'Total'), UI.el('div', {}, `<b>${UI.money(inv.total)}</b>`),
    UI.el('div', { class: 'k' }, 'Paid'), UI.el('div', {}, UI.money(inv.paid)),
    UI.el('div', { class: 'k' }, 'Balance'), UI.el('div', {}, `<b style="color:${inv.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${UI.money(inv.balance)}</b>`),
    UI.el('div', { class: 'k' }, 'Generated By'), UI.el('div', {}, UI.esc(inv.generated_by || '—')),
    UI.el('div', { class: 'k' }, 'Notes'), UI.el('div', {}, UI.esc(inv.notes || '—')),
    UI.el('div', { class: 'k' }, 'Created'), UI.el('div', {}, UI.dt(inv.created_at)),
    UI.el('div', { class: 'k' }, 'Paid At'), UI.el('div', {}, inv.paid_at ? UI.dt(inv.paid_at) : '—'))));
  grid.append(pay);
  root.append(grid);

  if (inv.payments && inv.payments.length) {
    root.append(UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Payment History')),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'payment_ref', label: 'Ref' },
          { key: 'approved_at', label: 'Date', render: (r) => UI.dt(r.approved_at || r.created_at) },
          { key: 'method', label: 'Method', render: (r) => UI.statusBadge(r.method) },
          { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        ],
        rows: inv.payments,
      }))));
  }
  return root;
};

/* ================= PAYMENTS ================= */
V.payments = async function () {
  const root = UI.el('div');
  const state = { page: '1', status: '', method: '', customer_id: '', from: '', to: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Payments'), UI.el('div', { class: 'sub' }, 'Record → approve (posts to books exactly once) → refund with reason')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => V.recordPaymentModal({}) }, '+ Record Payment'))));

  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  fRow.append(UI.el('select', { onchange: (e) => { state.status = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['refunded', 'Refunded'], ['reversed', 'Reversed']].map(([v, l]) => UI.el('option', { value: v }, l))));
  fRow.append(UI.el('select', { onchange: (e) => { state.method = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All methods'], ['cash', 'Cash'], ['bank_transfer', 'Bank Transfer'], ['jazzcash', 'JazzCash'], ['easypaisa', 'Easypaisa'], ['raast', 'Raast'], ['other', 'Other']].map(([v, l]) => UI.el('option', { value: v }, l))));
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.from = e.target.value; state.page = '1'; render(); } }));
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.to = e.target.value; state.page = '1'; render(); } }));
  root.append(filters);

  const box = UI.el('div', { class: 'card' });
  root.append(box);
  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/payments?${qs}`);
    box.replaceChildren(
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'payment_ref', label: 'Ref' },
          { key: 'created_at', label: 'Date', render: (r) => UI.dt(r.created_at) },
          { key: 'customer_name', label: 'Customer', render: (r) => `${UI.esc(r.customer_name)} <span class="muted small">${UI.esc(r.customer_code || '')}</span>` },
          { key: 'invoice_no', label: 'Invoice' },
          { key: 'method', label: 'Method', render: (r) => UI.statusBadge(r.method) },
          { key: 'amount', label: 'Amount', cls: 'num', render: (r) => `<b>${UI.money(r.amount)}</b>` },
          { key: 'transaction_ref', label: 'Txn Ref' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
          { key: 'actions', label: '', render: (r) => rowActions(r) },
        ],
        rows: d.rows,
        onRow: null,
      })),
      UI.pager(d.page, d.pages, (pg) => { state.page = String(pg); render(); }));
  }

  function rowActions(r) {
    const w = UI.el('span', { class: 'row' });
    if (r.status === 'pending') {
      w.append(UI.el('button', { class: 'btn btn-ok btn-xs', onclick: async (e) => { e.stopPropagation();
        try { await UI.api(`/api/payments/${r.id}/approve`, { method: 'POST', body: {} }); UI.toast(`${r.payment_ref} approved & posted`); render(); }
        catch (err) { UI.toast(err.error || err.message, 'err'); }
      } }, 'Approve'));
      w.append(UI.el('button', { class: 'btn btn-danger btn-xs', onclick: (e) => { e.stopPropagation(); rejectPay(r); } }, 'Reject'));
    }
    if (r.status === 'approved') {
      w.append(UI.el('button', { class: 'btn btn-warn btn-xs', onclick: (e) => { e.stopPropagation(); refundPay(r); } }, 'Refund'));
    }
    if (r.attachment_path) w.append(UI.el('a', { class: 'btn btn-outline btn-xs', href: `/api/files/payment/${r.id}`, onclick: (e) => e.stopPropagation() }, '📎'));
    return w;
  }

  function rejectPay(r) {
    const body = UI.el('div');
    UI.fields(body, [{ name: 'reason', label: 'Rejection Reason (required, audited)', type: 'textarea' }]);
    const ta = body.querySelector('textarea');
    UI.modal({ title: `Reject ${r.payment_ref}`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-danger', onclick: async () => {
        if (!ta.value.trim()) return UI.toast('Reason required', 'err');
        try { await UI.api(`/api/payments/${r.id}/reject`, { method: 'POST', body: { reason: ta.value } }); UI.toast('Payment rejected'); close(); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Reject')) });
  }

  function refundPay(r) {
    const body = UI.el('div');
    UI.fields(body, [{ name: 'reason', label: 'Refund Reason (required, audited)', type: 'textarea' }]);
    const ta = body.querySelector('textarea');
    UI.modal({ title: `Refund ${r.payment_ref} (${UI.money(r.amount)})`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-warn', onclick: async () => {
        if (!ta.value.trim()) return UI.toast('Reason required', 'err');
        try { await UI.api(`/api/payments/${r.id}/refund`, { method: 'POST', body: { reason: ta.value } }); UI.toast('Refund posted (journal reversed)'); close(); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Refund')) });
  }
  await render();
  return root;
};

/* ================= RECOVERY ================= */
V.recovery = async function () {
  const root = UI.el('div');
  const state = { bucket: '', area_id: '', assigned: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Recovery / Collections'), UI.el('div', { class: 'sub' }, 'Outstanding invoices with aging, agent assignment and payment promises'))));
  const kpis = UI.el('div', { class: 'kpi-grid' });
  root.append(kpis);

  const [areas, staff] = await Promise.all([UI.api('/api/areas').catch(() => []), UI.api('/api/staff').catch(() => [])]);
  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  fRow.append(UI.el('select', { onchange: (e) => { state.bucket = e.target.value; render(); } },
    ...[['', 'All buckets'], ['1-7', '1-7 days'], ['8-15', '8-15 days'], ['16+', '16+ days']].map(([v, l]) => UI.el('option', { value: v }, l))));
  fRow.append(UI.el('select', { onchange: (e) => { state.area_id = e.target.value; render(); } },
    UI.el('option', { value: '' }, 'All areas'), ...areas.map((a) => UI.el('option', { value: a.id }, a.name))));
  fRow.append(UI.el('select', { onchange: (e) => { state.assigned = e.target.value; render(); } },
    UI.el('option', { value: '' }, 'Any agent'), ...staff.map((s) => UI.el('option', { value: s.id }, s.name))));
  root.append(filters);

  const box = UI.el('div', { class: 'card' });
  root.append(box);

  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/recovery?${qs}`);
    const t = d.totals;
    kpis.replaceChildren();
    const kpi = (lbl, val, cls = '') => kpis.append(UI.el('div', { class: `kpi ${cls}` },
      UI.el('div', { class: 'lbl' }, lbl), UI.el('div', { class: 'val' }, val)));
    kpi('Total Outstanding', UI.money(t.outstanding), 'bad');
    kpi('Overdue', UI.money(t.overdue), 'bad');
    kpi('Bucket 1-7', UI.money(t.buckets['1-7'] || 0));
    kpi('Bucket 8-15', UI.money(t.buckets['8-15'] || 0));
    kpi('Bucket 16+', UI.money(t.buckets['16+'] || 0), 'warn');

    box.replaceChildren(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'name', label: 'Customer', render: (r) => `<b>${UI.esc(r.name)}</b><br><span class="muted small">${UI.esc(r.phone || '')}</span>` },
        { key: 'cstatus', label: 'Status', render: (r) => UI.statusBadge(r.cstatus) },
        { key: 'balance', label: 'Balance', cls: 'num', render: (r) => `<b style="color:var(--bad)">${UI.money(r.balance)}</b>` },
        { key: 'days_overdue', label: 'Days', render: (r) => r.days_overdue > 0 ? `<b style="color:var(--bad)">${r.days_overdue}</b>` : '—' },
        { key: 'bucket', label: 'Bucket', render: (r) => r.bucket ? UI.statusBadge(r.bucket === '1-7' ? 'low' : r.bucket === '8-15' ? 'medium' : 'urgent') : '—' },
        { key: 'assignment', label: 'Agent', render: (r) => r.assignment ? `#${r.assignment.staff_id}` : '—' },
        { key: 'promise', label: 'Promise', render: (r) => r.promise ? `${UI.date(r.promise.promise_date)} (${UI.money(r.promise.amount || 0)})` : '—' },
        { key: 'act', label: '', render: (r) => actRow(r) },
      ],
      rows: d.rows,
      empty: 'No outstanding invoices 🎉',
    })));
  }

  function actRow(r) {
    const w = UI.el('span', { class: 'row' });
    if (r.phone) {
      const wa = `92${String(r.phone).replace(/[^0-9]/g, '').replace(/^0/, '')}`;
      w.append(UI.el('a', { class: 'btn btn-ok btn-xs', target: '_blank', href: `https://wa.me/${wa}?text=${encodeURIComponent(`Dear ${r.name}, Rana Internet reminder: invoice ${r.invoice_no} for ${UI.money(r.balance)} is due (${UI.date(r.due_date)}). Shukriya.`)}` }, 'WhatsApp'));
      w.append(UI.el('a', { class: 'btn btn-cyan btn-xs', target: '_blank', href: `tel:${r.phone}` }, 'Call'));
    }
    w.append(UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => assignModal(r) }, 'Assign'));
    w.append(UI.el('button', { class: 'btn btn-ghost btn-xs', onclick: () => promiseModal(r) }, 'Promise'));
    w.append(UI.el('button', { class: 'btn btn-primary btn-xs', onclick: () => V.recordPaymentModal({ customerId: r.customer_id, customerName: r.name, invoiceId: Number(r.id), balance: r.balance }) }, 'Payment'));
    return w;
  }

  function assignModal(r) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'staff_id', label: 'Assign Collection Agent', type: 'select', options: [[-1, '— none —'], ...staff.map((s) => [s.id, s.name])] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    UI.modal({ title: `Assign — ${r.name}`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api('/api/recovery/assign', { method: 'POST', body: { customer_id: r.customer_id, staff_id: f.staff_id === '-1' ? null : Number(f.staff_id), notes: f.notes } }); UI.toast('Assigned'); close(); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Assign')) });
  }

  function promiseModal(r) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'promise_date', label: 'Promised Date *', type: 'date' },
      { name: 'amount', label: 'Promised Amount (PKR)', type: 'number', value: r.balance / 100 },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    UI.modal({ title: `Record Promise — ${r.name}`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api('/api/promises', { method: 'POST', body: { customer_id: r.customer_id, promise_date: f.promise_date, amount: f.amount, notes: f.notes } }); UI.toast('Promise recorded'); close(); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Save')) });
  }
  await render();
  return root;
};

/* ================= LEDGER ================= */
V.ledger = async function () {
  const root = UI.el('div');
  const box = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Customer Ledger'), UI.el('div', { class: 'sub' }, 'Running balance per customer — every invoice & payment posted once'))));
  const sel = UI.el('select', { style: 'min-width:280px;' });
  root.append(UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'row' }, sel, UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => render() }, 'View Ledger')))));

  (async () => {
    sel.append(UI.el('option', { value: '' }, '— select customer —'));
    let page = 1;
    for (;;) {
      const d = await UI.api(`/api/customers?page=${page}`).catch(() => null);
      if (!d) break;
      d.rows.forEach((c) => sel.append(UI.el('option', { value: c.id }, `${c.customer_code} — ${c.name} (${c.status})`)));
      if (page >= d.pages) break;
      page++;
    }
  })();

  const box2 = UI.el('div', { class: 'card' });
  root.append(box2);
  async function render() {
    if (!sel.value) { box2.replaceChildren(UI.el('div', { class: 'card-bd muted' }, 'Select a customer.')); return; }
    const rows = await UI.api(`/api/ledger?customer_id=${sel.value}`);
    let running = 0;
    box2.replaceChildren(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'at', label: 'Date', render: (r) => UI.dt(r.at) },
        { key: 'entry_type', label: 'Type', render: (r) => UI.statusBadge(r.entry_type === 'invoice' ? 'unpaid' : 'paid') },
        { key: 'memo', label: 'Memo' },
        { key: 'direction', label: 'Debit / Credit', render: (r) => r.direction === 'debit' ? 'Debit' : 'Credit' },
        { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
        { key: 'balance', label: 'Running Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
      ],
      rows: rows.slice().reverse(),
      empty: 'No entries',
    })));
  }
  sel.addEventListener('change', render);
  return root;
};
