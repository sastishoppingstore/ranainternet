/* Owner views — Inventory & Staff */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= INVENTORY ================= */
V.inventory = async function () {
  const root = UI.el('div');
  const tabs = UI.el('div', { class: 'tabs' });
  const box = UI.el('div');
  const tabDefs = [['items', '📦 Items & Stock'], ['movements', 'Movements'], ['valuation', 'Valuation'], ['suppliers', 'Suppliers']];
  let current = 'items';

  const [items, suppliers, val] = await Promise.all([
    UI.api('/api/inventory/items'),
    UI.api('/api/suppliers').catch(() => []),
    UI.api('/api/inventory/valuation').catch(() => ({ rows: [], total: 0 })),
  ]);

  const draw = () => {
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd muted' }, 'Loading…')));
    if (current === 'items') return drawItems();
    if (current === 'movements') return drawMovements();
    if (current === 'valuation') return drawValuation();
    if (current === 'suppliers') return drawSuppliers();
  };
  tabDefs.forEach(([k, l]) => {
    const b = UI.el('button', { class: k === current ? 'active' : '', onclick: () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      current = k;
      draw();
    } }, l);
    tabs.append(b);
  });
  root.append(tabs, box);
  await drawItems();

  function refresh() {
    return UI.api('/api/inventory/items').then((rows) => {
      items.length = 0;
      items.push(...rows);
      draw();
    });
  }

  async function drawItems() {
    const low = items.filter((i) => i.low);
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Stock Items'),
        UI.el('div', { class: 'row' },
          UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => itemForm(null) }, '+ New Item'),
          low.length ? UI.el('span', { class: 'badge red' }, `${low.length} low stock`) : null)));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Item', render: (r) => `<b>${UI.esc(r.name)}</b><br><span class="muted small">${UI.esc(r.category)}</span>` },
        { key: 'stock', label: 'Stock', cls: 'num', render: (r) => r.low ? `<b style="color:var(--bad)">${r.stock}</b>` : String(r.stock) },
        { key: 'unit', label: 'Unit' },
        { key: 'reorder_level', label: 'Reorder At' },
        { key: 'unit_cost', label: 'Unit Cost', cls: 'num', render: (r) => UI.money(r.unit_cost) },
        { key: 'value', label: 'Stock Value', cls: 'num', render: (r) => UI.money(r.value) },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => purchaseForm(r) }, 'Purchase'),
          UI.el('button', { class: 'btn btn-warn btn-xs', onclick: () => issueForm(r) }, 'Issue'),
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => adjustForm(r) }, 'Adjust'),
          UI.el('button', { class: 'btn btn-ghost btn-xs', onclick: () => itemForm(r) }, 'Edit')) },
      ],
      rows: items,
      empty: 'No inventory items',
    })));
    box.replaceChildren(card);
  }

  function itemForm(r) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Name *' },
      { name: 'category', label: 'Category', type: 'select', options: [['cable', 'Cable'], ['device', 'Device'], ['component', 'Component'], ['accessory', 'Accessory'], ['other', 'Other']] },
      { name: 'unit', label: 'Unit', placeholder: 'pcs / meter / box' },
      { name: 'reorder_level', label: 'Reorder Level', type: 'number', value: 10 },
      { name: 'unit_cost', label: 'Unit Cost (PKR)', type: 'number' },
    ], r ? { ...r, unit_cost: r.unit_cost / 100 } : {});
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        if (r) { await UI.api(`/api/inventory-items/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
        else { await UI.api('/api/inventory-items', { method: 'POST', body: f }); UI.toast('Item created'); }
        refresh();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, r ? 'Save' : 'Create');
    const m = UI.modal({ title: r ? `Edit — ${r.name}` : 'New Inventory Item', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  function purchaseForm(item) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'qty', label: `Quantity * (${item.stock} in stock)`, type: 'number', value: 1 },
      { name: 'unit_cost', label: 'Unit Cost (PKR) — updates item cost', type: 'number', value: item.unit_cost / 100 },
      { name: 'supplier_id', label: 'Supplier', type: 'select', options: [[-1, '— none —'], ...suppliers.map((s) => [s.id, s.name])] },
      { name: 'invoice_no', label: 'Supplier Invoice #', placeholder: 'SUP-INV-123' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    const paidChk = UI.el('input', { type: 'checkbox' });
    const acctSel = UI.el('select', { style: 'border:1.5px solid var(--line-2); border-radius:8px; padding:8px;' });
    acctSel.append(UI.el('option', { value: '' }, '— cash (default) —'));
    UI.api('/api/cash-accounts').then((accs) => accs.forEach((a) => acctSel.append(UI.el('option', { value: a.id }, `${a.name} (${a.kind})`))));
    const paidRow = UI.el('div', { class: 'row' }, paidChk, UI.el('span', { class: 'small' }, 'Paid now'), acctSel);
    body.append(paidRow);
    body.append(UI.el('div', { class: 'hint mt' }, 'Unpaid purchases create a supplier payable (posted to books). Pay it later from the Suppliers tab.'));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        await UI.api('/api/inventory/purchase', { method: 'POST', body: {
          item_id: item.id, qty: f.qty, unit_cost: f.unit_cost,
          supplier_id: f.supplier_id === '-1' ? null : Number(f.supplier_id),
          invoice_no: f.invoice_no || null, notes: f.notes || null,
          paid: paidChk.checked, account_id: paidChk.checked && acctSel.value ? Number(acctSel.value) : null,
        } });
        UI.toast('Purchase recorded'); m.close(); refresh();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Record Purchase');
    const m = UI.modal({ title: `Purchase — ${item.name}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  function issueForm(item) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'qty', label: `Quantity * (${item.stock} available)`, type: 'number', value: 1 },
      { name: 'notes', label: 'Notes (e.g. installation for customer)', type: 'textarea' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-warn', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        await UI.api('/api/inventory/issue', { method: 'POST', body: { item_id: item.id, qty: f.qty, notes: f.notes || null } });
        UI.toast('Stock issued'); m.close(); refresh();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Issue Stock');
    const m = UI.modal({ title: `Issue — ${item.name}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  function adjustForm(item) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'qty', label: 'Adjustment (+ / -) *', type: 'number', value: 0, hint: 'Positive = found stock, negative = lost/damaged' },
      { name: 'reason', label: 'Reason (audited)', type: 'textarea' },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        await UI.api('/api/inventory/adjust', { method: 'POST', body: { item_id: item.id, qty: f.qty, reason: f.reason || null } });
        UI.toast('Adjusted'); m.close(); refresh();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Adjust');
    const m = UI.modal({ title: `Adjust Stock — ${item.name}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  async function drawMovements() {
    const rows = await UI.api('/api/inventory/movements');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Stock Movements')),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'at', label: 'Date', render: (r) => UI.dt(r.created_at || r.at) },
          { key: 'mtype', label: 'Type', render: (r) => UI.statusBadge(r.mtype === 'purchase' ? 'approved' : r.mtype === 'issue' ? 'rejected' : 'pending') },
          { key: 'item_name', label: 'Item' },
          { key: 'qty', label: 'Qty', cls: 'num', render: (r) => (r.mtype === 'issue' || r.mtype === 'adjust_out' ? '−' : '+') + r.qty },
          { key: 'unit_cost', label: 'Unit Cost', cls: 'num', render: (r) => r.unit_cost ? UI.money(r.unit_cost) : '—' },
          { key: 'notes', label: 'Notes' },
        ],
        rows: rows.rows || rows,
        empty: 'No movements',
      }))));
  }

  async function drawValuation() {
    const d = await UI.api('/api/inventory/valuation');
    const kpis = UI.el('div', { class: 'kpi-grid' });
    kpis.append(UI.el('div', { class: 'kpi accent' }, UI.el('div', { class: 'lbl' }, 'Total Stock Value'), UI.el('div', { class: 'val' }, UI.money(d.total))));
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Valuation by Item')),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'name', label: 'Item' },
          { key: 'unit', label: 'Unit' },
          { key: 'stock', label: 'Stock', cls: 'num' },
          { key: 'unit_cost', label: 'Unit Cost', cls: 'num', render: (r) => UI.money(r.unit_cost) },
          { key: 'value', label: 'Value', cls: 'num', render: (r) => `<b>${UI.money(r.unit_cost * r.stock)}</b>` },
        ],
        rows: d.rows,
      })));
    box.replaceChildren(UI.el('div', {}, kpis, UI.el('div', { class: 'mb' }), card));
  }

  async function drawSuppliers() {
    const [rows, payables, accounts] = await Promise.all([
      UI.api('/api/suppliers'),
      UI.api('/api/supplier-payables').catch(() => []),
      UI.api('/api/cash-accounts').catch(() => []),
    ]);
    const card = UI.el('div', { class: 'card mb' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Suppliers'), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => supplierForm(null) }, '+ Supplier')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Supplier' },
        { key: 'phone', label: 'Phone' },
        { key: 'address', label: 'Address' },
        { key: 'is_active', label: 'Active', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('disabled') },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => supplierForm(r) }, 'Edit'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete supplier "${r.name}"?`))) return;
            try { await UI.api(`/api/suppliers/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); drawSuppliers(); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Del')) },
      ],
      rows,
      empty: 'No suppliers',
    })));

    const card2 = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Supplier Payables (unpaid purchases)')));
    card2.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'item', label: 'Item' },
        { key: 'qty', label: 'Qty', cls: 'num' },
        { key: 'total', label: 'Total', cls: 'num', render: (r) => UI.money(r.total) },
        { key: 'paid', label: 'Paid', cls: 'num', render: (r) => UI.money(r.paid) },
        { key: 'outstanding', label: 'Outstanding', cls: 'num', render: (r) => `<b style="color:var(--bad)">${UI.money(r.total - r.paid)}</b>` },
        { key: 'act', label: '', render: (r) => UI.el('button', { class: 'btn btn-ok btn-xs', onclick: () => paySupplier(r, accounts) }, 'Pay') },
      ],
      rows: payables,
      empty: 'No outstanding supplier payments 🎉',
    })));
    box.replaceChildren(card, card2);

    function supplierForm(r) {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'name', label: 'Name *' },
        { name: 'phone', label: 'Phone' },
        { name: 'address', label: 'Address' },
        { name: 'account_no', label: 'Account # (for transfers)' },
        { name: 'notes', label: 'Notes' },
      ], r ? r : {});
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          if (r) { await UI.api(`/api/suppliers/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
          else { await UI.api('/api/suppliers', { method: 'POST', body: f }); UI.toast('Supplier added'); }
          m.close(); drawSuppliers();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, r ? 'Save' : 'Add');
      const m = UI.modal({ title: r ? `Edit ${r.name}` : 'New Supplier', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    }

    function paySupplier(p, accounts) {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'amount', label: `Amount (PKR) — outstanding ${UI.money(p.total - p.paid)}`, type: 'number', value: (p.total - p.paid) / 100 },
        { name: 'account_id', label: 'Pay From', type: 'select', options: [[-1, 'Cash (default)'], ...accounts.map((a) => [a.id, `${a.name} (${a.kind})`])] },
        { name: 'transaction_ref', label: 'Transaction Ref' },
      ]);
      const btn = UI.el('button', { class: 'btn btn-ok', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          await UI.api('/api/supplier-pay', { method: 'POST', body: { purchase_id: p.id, amount: f.amount, account_id: f.account_id === '-1' ? null : Number(f.account_id), transaction_ref: f.transaction_ref || null } });
          UI.toast('Supplier payment posted'); m.close(); drawSuppliers();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Pay Supplier');
      const m = UI.modal({ title: `Pay — ${p.supplier}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    }
  }
  return root;
};

/* ================= STAFF ================= */
V.staff = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Staff'), UI.el('div', { class: 'sub' }, 'Technicians & collection agents — salaries, advances, payments (all posted to books)')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => staffForm(null) }, '+ Add Staff'))));
  const box = UI.el('div', { class: 'card' });
  root.append(box);
  const render = async () => {
    const rows = await UI.api('/api/staff');
    box.replaceChildren(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Name', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        { key: 'role', label: 'Role' },
        { key: 'phone', label: 'Phone' },
        { key: 'joined_at', label: 'Joined' },
        { key: 'base_salary', label: 'Base Salary', cls: 'num', render: (r) => UI.money(r.base_salary) },
        { key: 'advance_balance', label: 'Advance Balance', cls: 'num', render: (r) => r.advance_balance ? UI.money(r.advance_balance) : '—' },
        { key: 'is_active', label: 'Active', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('disabled') },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => payModal(r) }, 'Pay'),
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => historyModal(r) }, 'History'),
          UI.el('button', { class: 'btn btn-ghost btn-xs', onclick: () => staffForm(r) }, 'Edit')) },
      ],
      rows,
      empty: 'No staff',
    })));
  };
  await render();

  function staffForm(r) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Name *' },
      { name: 'role', label: 'Role', type: 'select', options: [['Installation Technician', 'Installation Technician'], ['Collection Agent', 'Collection Agent'], ['Network Engineer', 'Network Engineer'], ['Support', 'Support'], ['Other', 'Other']] },
      { name: 'phone', label: 'Phone' },
      { name: 'joined_at', label: 'Joined', type: 'date' },
      { name: 'base_salary', label: 'Base Salary (PKR)', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
      { name: 'is_active', label: 'Active', type: 'checkbox', value: r ? !!r.is_active : true },
    ], r ? { ...r, base_salary: r.base_salary / 100 } : {});
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        if (r) { await UI.api(`/api/staff/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
        else { await UI.api('/api/staff', { method: 'POST', body: f }); UI.toast('Staff added'); }
        m.close(); render();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, r ? 'Save' : 'Add');
    const m = UI.modal({ title: r ? `Edit — ${r.name}` : 'Add Staff', body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  function payModal(s) {
    UI.api('/api/cash-accounts').then((accounts) => {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'type', label: 'Type', type: 'select', options: [['salary', 'Salary'], ['advance', 'Advance (added to balance)'], ['deduction', 'Deduction'], ['advance_refund', 'Advance Refund']] },
        { name: 'amount', label: 'Amount (PKR) *', type: 'number', value: s.base_salary / 100 },
        { name: 'account_id', label: 'Pay From', type: 'select', options: [[-1, 'Cash (default)'], ...accounts.map((a) => [a.id, `${a.name} (${a.kind})`])] },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]);
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          await UI.api(`/api/staff/${s.id}/pay`, { method: 'POST', body: { type: f.type, amount: f.amount, account_id: f.account_id === '-1' ? null : Number(f.account_id), notes: f.notes || null } });
          UI.toast('Payment posted'); m.close(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Post Payment');
      const m = UI.modal({ title: `Pay — ${s.name}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    });
  }

  async function historyModal(s) {
    const d = await UI.api(`/api/staff/${s.id}`).catch(() => null);
    const rows = (d && d.transactions) || [];
    const body = UI.el('div');
    body.append(UI.table({
      columns: [
        { key: 'at', label: 'Date', render: (r) => UI.dt(r.created_at || r.at) },
        { key: 'stype', label: 'Type', render: (r) => UI.statusBadge(r.stype === 'salary' ? 'approved' : r.stype === 'advance' ? 'pending' : r.stype === 'deduction' ? 'rejected' : 'refunded') },
        { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
        { key: 'notes', label: 'Notes' },
      ],
      rows,
      empty: 'No transactions',
    }));
    UI.modal({ title: `History — ${s.name}`, body, wide: true });
  }
  return root;
};
