/* Owner views — Accounts, Journal, Finance (TB + P&L), Providers, Reports, Audit */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= ACCOUNTS ================= */
V.accounts = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Accounts & Cash/Bank'), UI.el('div', { class: 'sub' }, 'Chart of accounts, cashbook, transfers and daily close — double-entry, posted exactly once'))));
  const tabs = UI.el('div', { class: 'tabs' });
  const box = UI.el('div');
  const [chart, cash] = await Promise.all([UI.api('/api/accounts'), UI.api('/api/cash-accounts')]);

  const draw = (k) => {
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd muted' }, 'Loading…')));
    if (k === 'chart') return drawChart();
    if (k === 'cash') return drawCash();
    if (k === 'cashbook') return drawCashbook();
    if (k === 'ledger') return drawLedger();
    if (k === 'close') return drawClose();
  };
  const tabDefs = [['chart', '📚 Chart of Accounts'], ['cash', '💵 Cash & Bank Accounts'], ['cashbook', 'Cashbook'], ['ledger', 'Account Ledger'], ['close', 'Daily Close']];
  let current = 'chart';
  tabDefs.forEach(([k, l]) => {
    const b = UI.el('button', { class: k === current ? 'active' : '', onclick: () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      current = k;
      draw(k);
    } }, l);
    tabs.append(b);
  });
  root.append(tabs, box);
  draw('chart');

  function drawChart() {
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Chart of Accounts'), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => accountForm() }, '+ Add Account')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', render: (r) => `<b>${UI.esc(r.name)}</b>${r.is_system ? ' <span class="muted small">(system)</span>' : ''}` },
        { key: 'type', label: 'Type', render: (r) => UI.statusBadge(r.type === 'asset' ? 'active' : r.type === 'liability' ? 'suspended' : r.type === 'equity' ? 'surveyed' : r.type === 'revenue' ? 'paid' : 'rejected') },
        { key: 'category', label: 'Category' },
        { key: 'balance', label: 'Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
      ],
      rows: chart,
    })));
    box.replaceChildren(card);
  }

  function accountForm() {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'code', label: 'Code *', placeholder: 'e.g. 5100' },
      { name: 'name', label: 'Name *' },
      { name: 'type', label: 'Type', type: 'select', options: [['asset', 'Asset'], ['liability', 'Liability'], ['equity', 'Equity'], ['revenue', 'Revenue'], ['expense', 'Expense']] },
      { name: 'category', label: 'Category (system mapping key)', placeholder: 'e.g. rent, salary, misc' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ]);
    UI.modal({ title: 'Add Account', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api('/api/accounts', { method: 'POST', body: f }); UI.toast('Account added'); close(); UI.api('/api/accounts').then((rows) => { chart.length = 0; chart.push(...rows); drawChart(); }); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Add')) });
  }

  async function drawCash() {
    const rows = await UI.api('/api/cash-accounts');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Cash & Bank Accounts'),
        UI.el('div', { class: 'row' },
          UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => newCashAccount() }, '+ New Account'),
          UI.el('button', { class: 'btn btn-cyan btn-sm', onclick: () => transferModal(rows) }, '⇄ Transfer Between'))));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Account', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        { key: 'kind', label: 'Type', render: (r) => UI.statusBadge(r.kind === 'cash' ? 'cash' : 'bank_transfer') },
        { key: 'bank', label: 'Bank' },
        { key: 'account_no', label: 'Account #', render: (r) => UI.esc(r.account_no || '—') },
        { key: 'balance', label: 'Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
        { key: 'is_active', label: 'Active', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('disabled') },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-ok btn-xs', onclick: () => moveModal(r, 'deposit') }, 'Deposit'),
          UI.el('button', { class: 'btn btn-warn btn-xs', onclick: () => moveModal(r, 'withdraw') }, 'Withdraw')) },
      ],
      rows,
      empty: 'No cash/bank accounts',
    })));
    box.replaceChildren(card);
  }

  function newCashAccount() {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Name *', placeholder: 'e.g. UBL Account' },
      { name: 'kind', label: 'Type', type: 'select', options: [['cash', 'Cash Box'], ['bank', 'Bank']] },
      { name: 'bank', label: 'Bank Name' },
      { name: 'account_no', label: 'Account Number' },
      { name: 'opening_balance', label: 'Opening Balance (PKR) — posted to capital', type: 'number', value: 0 },
    ]);
    UI.modal({ title: 'New Cash/Bank Account', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api('/api/cash-accounts', { method: 'POST', body: f }); UI.toast('Account created'); close(); drawCash(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Create')) });
  }

  function moveModal(r, dir) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'amount', label: `Amount to ${dir} (PKR) *`, type: 'number' },
      { name: 'notes', label: 'Memo', type: 'textarea' },
    ]);
    UI.modal({ title: `${dir === 'deposit' ? 'Deposit' : 'Withdraw'} — ${r.name}`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api(`/api/cash-accounts/${r.id}/move`, { method: 'POST', body: { amount: f.amount, direction: dir, notes: f.notes || null } }); UI.toast('Posted'); close(); drawCash(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Post')) });
  }

  function transferModal(rows) {
    const body = UI.el('div');
    const f1 = UI.el('select'), f2 = UI.el('select');
    rows.forEach((r) => { f1.append(UI.el('option', { value: r.id }, r.name)); f2.append(UI.el('option', { value: r.id }, r.name)); });
    if (rows.length > 1) f2.selectedIndex = 1;
    const inputs = UI.fields(body, [
      { name: 'amount', label: 'Amount (PKR) *', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]);
    body.append(UI.el('div', { class: 'grid-2' }));
    const g = body.querySelector('.grid-2');
    g.innerHTML = '';
    g.append(UI.el('div', { class: 'field' }, UI.el('label', {}, 'From'), f1), UI.el('div', { class: 'field' }, UI.el('label', {}, 'To'), f2));
    UI.modal({ title: 'Transfer Between Accounts', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api('/api/transfers', { method: 'POST', body: { from_id: f1.value, to_id: f2.value, amount: f.amount, notes: f.notes || null } }); UI.toast('Transfer posted'); close(); drawCash(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Transfer')) });
  }

  async function drawCashbook() {
    const rows = await UI.api('/api/cash-accounts');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Cashbook'),
        UI.el('div', { class: 'row' },
          UI.el('select', { id: 'cbAcct' }, ...rows.map((r) => UI.el('option', { value: r.id }, r.name))),
          UI.el('input', { type: 'date', id: 'cbFrom' }),
          UI.el('input', { type: 'date', id: 'cbTo' }),
          UI.el('button', { class: 'btn btn-primary btn-sm', onclick: load }, 'Load'))));
    const out = UI.el('div');
    card.append(out);
    box.replaceChildren(card);
    async function load() {
      const qs = new URLSearchParams({ account_id: document.getElementById('cbAcct').value });
      const f = document.getElementById('cbFrom').value, t = document.getElementById('cbTo').value;
      if (f) qs.set('from', f);
      if (t) qs.set('to', t);
      const d = await UI.api(`/api/cashbook?${qs}`);
      out.replaceChildren(UI.el('div', { class: 'tbl-wrap mt' }, UI.table({
        columns: [
          { key: 'at', label: 'Date', render: (r) => UI.dt(r.at || r.entry_date) },
          { key: 'memo', label: 'Memo' },
          { key: 'debit', label: 'In (Dr)', cls: 'num', render: (r) => r.debit ? UI.money(r.debit) : '' },
          { key: 'credit', label: 'Out (Cr)', cls: 'num', render: (r) => r.credit ? UI.money(r.credit) : '' },
          { key: 'balance', label: 'Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
        ],
        rows: d.rows || [],
        empty: d.note || 'No entries',
      })));
    }
    await load();
  }

  async function drawLedger() {
    const rows = await UI.api('/api/accounts');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Account Ledger'),
        UI.el('div', { class: 'row' },
          UI.el('select', { id: 'alAcct' }, ...rows.map((r) => UI.el('option', { value: r.id }, `${r.code} — ${r.name}`))),
          UI.el('button', { class: 'btn btn-primary btn-sm', onclick: load }, 'Load'))));
    const out = UI.el('div');
    card.append(out);
    box.replaceChildren(card);
    async function load() {
      const d = await UI.api(`/api/account-ledger?account_id=${document.getElementById('alAcct').value}`);
      out.replaceChildren(UI.el('div', { class: 'tbl-wrap mt' }, UI.table({
        columns: [
          { key: 'at', label: 'Date', render: (r) => UI.dt(r.at || r.entry_date) },
          { key: 'memo', label: 'Memo' },
          { key: 'debit', label: 'Debit', cls: 'num', render: (r) => r.debit ? UI.money(r.debit) : '' },
          { key: 'credit', label: 'Credit', cls: 'num', render: (r) => r.credit ? UI.money(r.credit) : '' },
          { key: 'balance', label: 'Balance', cls: 'num', render: (r) => `<b>${UI.money(r.balance)}</b>` },
        ],
        rows: d.rows || d || [],
        empty: 'No entries',
      })));
    }
    await load();
  }

  async function drawClose() {
    const d = await UI.api('/api/daily-close');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, `Daily Close — ${d.date || 'today'}`)),
      UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'kv' },
        Object.entries(d).filter(([k]) => k !== 'date').map(([k, v]) => [
          UI.el('div', { class: 'k' }, k.replace(/_/g, ' ')),
          UI.el('div', {}, typeof v === 'number' && v > 100000 ? UI.money(v) : UI.esc(String(v ?? '—'))),
        ]).flat())));
    box.replaceChildren(card);
  }
  return root;
};

/* ================= JOURNAL ================= */
V.journal = async function () {
  const root = UI.el('div');
  const state = { page: '1', from: '', to: '', source: '', account_id: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Journal'), UI.el('div', { class: 'sub' }, 'Every financial event posts one balanced double-entry. No hard-deletes ever.')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => manualEntry() }, '+ Manual Entry'))));

  const [accounts] = await Promise.all([UI.api('/api/accounts')]);
  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.from = e.target.value; state.page = '1'; render(); } }));
  fRow.append(UI.el('input', { type: 'date', onchange: (e) => { state.to = e.target.value; state.page = '1'; render(); } }));
  fRow.append(UI.el('select', { onchange: (e) => { state.source = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All sources'], ['invoice', 'Invoice'], ['payment', 'Payment'], ['expense', 'Expense'], ['salary', 'Salary'], ['purchase', 'Purchase'], ['manual', 'Manual'], ['transfer', 'Transfer'], ['opening', 'Opening']].map(([v, l]) => UI.el('option', { value: v }, l))));
  fRow.append(UI.el('select', { onchange: (e) => { state.account_id = e.target.value; state.page = '1'; render(); } },
    UI.el('option', { value: '' }, 'All accounts'), ...accounts.map((a) => UI.el('option', { value: a.id }, `${a.code} — ${a.name}`))));
  root.append(filters);

  const box = UI.el('div', { class: 'card' });
  root.append(box);
  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/journal?${qs}`);
    const rows = UI.el('div');
    d.rows.forEach((e) => {
      const card = UI.el('div', { class: 'card mb' });
      const hd = UI.el('div', { class: 'card-hd' },
        UI.el('div', {}, `${UI.esc(e.entry_no)} <span class="muted small">${UI.esc(e.entry_date)}</span> <span class="badge gray">${UI.esc(e.source)}</span>`),
        UI.el('div', { class: 'muted small' }, UI.esc(e.memo || '')));
      const t = UI.table({
        columns: [
          { key: 'account_name', label: 'Account', render: (r) => `${r.code} — ${UI.esc(r.account_name)}` },
          { key: 'debit', label: 'Debit', cls: 'num', render: (r) => r.debit ? UI.money(r.debit) : '' },
          { key: 'credit', label: 'Credit', cls: 'num', render: (r) => r.credit ? UI.money(r.credit) : '' },
        ],
        rows: e.lines || [],
      });
      card.append(hd, t);
      rows.append(card);
    });
    box.replaceChildren(rows, UI.pager(d.page, d.pages, (pg) => { state.page = String(pg); render(); }));
  }
  await render();

  function manualEntry() {
    const body = UI.el('div');
    UI.fields(body, [
      { name: 'date', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) },
      { name: 'memo', label: 'Memo *', type: 'textarea' },
    ]);
    const linesBox = UI.el('div', { class: 'mt' });
    const lineEls = [];
    const addLine = () => {
      const tr = UI.el('div', { class: 'row', style: 'margin-bottom:6px; align-items:flex-end;' });
      const sel = UI.el('select', { style: 'flex:1; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
      sel.append(UI.el('option', { value: '' }, '— account —'));
      accounts.forEach((a) => sel.append(UI.el('option', { value: a.id }, `${a.code} — ${a.name}`)));
      const dr = UI.el('input', { type: 'number', min: 0, placeholder: 'Dr PKR', style: 'width:120px; text-align:right; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
      const cr = UI.el('input', { type: 'number', min: 0, placeholder: 'Cr PKR', style: 'width:120px; text-align:right; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
      lineEls.push({ sel, dr, cr });
      tr.append(sel, dr, cr);
      linesBox.append(tr);
    };
    addLine(); addLine();
    body.append(linesBox, UI.el('button', { class: 'btn btn-ghost btn-sm', onclick: addLine }, '+ Add Line'),
      UI.el('div', { class: 'hint mt' }, 'Debits must equal credits. Posted immediately and can never be deleted.'));
    UI.modal({ title: 'Manual Journal Entry', body, wide: true, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields({ date: body.querySelector('input[type=date]'), memo: body.querySelector('textarea') });
        const lines = lineEls.map((l) => ({ account_id: l.sel.value, debit: l.dr.value || 0, credit: l.cr.value || 0 })).filter((l) => l.account_id && (l.debit || l.credit));
        if (lines.length < 2) return UI.toast('At least two lines with account required', 'err');
        try {
          const r = await UI.api('/api/journal', { method: 'POST', body: { date: f.date, memo: f.memo, lines } });
          UI.toast(`Posted ${r.entryNo}`); close(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Post Entry')) });
  }
  return root;
};

/* ================= FINANCE: TRIAL BALANCE + P&L ================= */
V.finance = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Financial Statements'), UI.el('div', { class: 'sub' }, 'Trial balance always reconciles. P&L labeled by basis (accrual vs cash).'))));
  const grid = UI.el('div', { style: 'display:grid; grid-template-columns:1fr 1.2fr; gap:14px;' });
  root.append(grid);

  // trial balance
  const tb = await UI.api('/api/trial-balance');
  const tbCard = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Trial Balance')));
  const tbTot = tb.rows.reduce((s, r) => ({ d: s.d + (r.debit || 0), c: s.c + (r.credit || 0) }), { d: 0, c: 0 });
  tbCard.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Account' },
      { key: 'type', label: 'Type' },
      { key: 'debit', label: 'Debit', cls: 'num', render: (r) => r.debit ? UI.money(r.debit) : '' },
      { key: 'credit', label: 'Credit', cls: 'num', render: (r) => r.credit ? UI.money(r.credit) : '' },
    ],
    rows: tb.rows,
  })));
  tbCard.append(UI.el('div', { class: 'card-bd row spread', style: 'font-weight:800;' },
    UI.el('span', {}, 'TOTALS'),
    UI.el('span', {}, `${UI.money(tbTot.d)}  ${UI.money(tbTot.c)}`),
    UI.el('span', { class: `badge ${tbTot.d === tbTot.c ? 'green' : 'red'}` }, tbTot.d === tbTot.c ? '✔ Balanced' : '✖ Out of balance')));
  grid.append(tbCard);

  // P&L
  const month = new Date().toISOString().slice(0, 7);
  const plMonthEl = UI.el('input', { type: 'month', id: 'plMonth', value: month, style: 'border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
  const plCard = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' },
    UI.el('h3', {}, 'Profit & Loss'),
    UI.el('div', { class: 'row' },
      plMonthEl,
      UI.el('button', { class: 'btn btn-primary btn-sm', onclick: loadPl }, 'Load'))));
  const plOut = UI.el('div');
  plCard.append(plOut);
  grid.append(plCard);

  async function loadPl() {
    const m = plMonthEl.value || month; // YYYY-MM
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const from = `${m}-01`;
    const to = `${m}-${String(lastDay).padStart(2, '0')}`;
    const d = await UI.api(`/api/pl?from=${from}&to=${to}`);
    const cur = d.cur, prev = d.prev;
    const line = (label, val, cls = '') => UI.el('div', { class: 'row spread', style: 'padding:7px 0; border-bottom:1px solid var(--line);' },
      UI.el('span', {}, label), UI.el('span', { class: cls }, val));
    const pl = UI.el('div', { class: 'card-bd' });
    pl.append(UI.el('div', { class: 'alert info mb' }, 'ℹ️ Basis: ' + UI.esc(d.basis)));
    const tbl = UI.el('table', { class: 'tbl' });
    tbl.innerHTML = `<thead><tr><th>Item</th><th class="num">This month</th><th class="num">Previous</th></tr></thead><tbody></tbody>`;
    const tb2 = tbl.querySelector('tbody');
    const add = (l, a, b, cls = '') => tb2.append(UI.el('tr', {},
      UI.el('td', {}, l),
      UI.el('td', { class: 'num' + (cls ? ` ${cls}` : '') }, a),
      UI.el('td', { class: 'num' }, b)));
    add('Income', UI.money(cur.income), UI.money(prev.income));
    (cur.incomeByCat || []).forEach((x) => add(`  ${x.name}`, UI.money(x.s), ''));
    add('Expenses', UI.money(cur.expense), UI.money(prev.expense));
    (cur.expenseByCat || []).forEach((x) => add(`  ${x.name}`, UI.money(x.s), ''));
    add('Operating (accrual)', `<b>${UI.money(cur.operating)}</b>`, UI.money(prev.operating), cur.operating >= 0 ? '' : 'bad');
    add('Cash In', UI.money(cur.cashIn), UI.money(prev.cashIn));
    add('Cash Out', UI.money(cur.cashOut), UI.money(prev.cashOut));
    add('Receivable (AR)', UI.money(cur.receivable), UI.money(prev.receivable));
    add('Payable (AP)', UI.money(cur.payable), UI.money(prev.payable));
    pl.append(tbl);
    plOut.replaceChildren(pl);
  }
  await loadPl();
  return root;
};

/* ================= PROVIDERS ================= */
V.providers = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Upstream Provider'), UI.el('div', { class: 'sub' }, 'Bandwidth cost, plans, provider invoices & payments — feeds P&L'))));
  const box = UI.el('div');
  root.append(box);

  const render = async () => {
    const d = await UI.api('/api/providers/summary');
    const card = UI.el('div', { class: 'card mb' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Providers'),
        UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => providerForm(null) }, '+ Provider')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'company', label: 'Company', render: (r) => `<b>${UI.esc(r.company)}</b>` },
        { key: 'contact_name', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'service_description', label: 'Service' },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => planForm(r) }, 'Add Plan'),
          UI.el('button', { class: 'btn btn-ghost btn-xs', onclick: () => providerForm(r) }, 'Edit'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete provider "${r.company}"?`))) return;
            try { await UI.api(`/api/providers/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); render(); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Del')) },
      ],
      rows: d.providers,
      empty: 'No providers',
    })));

    const card2 = UI.el('div', { class: 'card mb' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Bandwidth Plans'), UI.el('button', { class: 'btn btn-outline btn-sm', onclick: () => invoiceForm(d.providers) }, '+ Provider Invoice')));
    card2.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'provider', label: 'Provider' },
        { key: 'capacity_mbps', label: 'Capacity', render: (r) => `${r.capacity_mbps} Mbps` },
        { key: 'monthly_cost', label: 'Monthly Cost', cls: 'num', render: (r) => `<b>${UI.money(r.monthly_cost)}</b>` },
        { key: 'billing_period', label: 'Period' },
        { key: 'started_at', label: 'From' },
        { key: 'is_active', label: 'Status', render: (r) => r.is_active ? UI.statusBadge('active') : UI.statusBadge('disabled') },
      ],
      rows: d.plans,
      empty: 'No plans',
    })));

    const card3 = UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Provider Invoices')));
    card3.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'period', label: 'Period' },
        { key: 'amount', label: 'Amount', cls: 'num', render: (r) => UI.money(r.amount) },
        { key: 'paid', label: 'Paid', cls: 'num', render: (r) => UI.money(r.paid) },
        { key: 'due_date', label: 'Due' },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { key: 'act', label: '', render: (r) => (r.amount > r.paid ? UI.el('button', { class: 'btn btn-ok btn-xs', onclick: () => payForm(r) }, 'Pay') : null) },
      ],
      rows: d.invoices,
      empty: 'No provider invoices',
    })));
    box.replaceChildren(card, card2, card3);
  };

  function providerForm(r) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'company', label: 'Company *' },
      { name: 'contact_name', label: 'Contact Name' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'account_no', label: 'Account # (for payments)' },
      { name: 'service_description', label: 'Service Description' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
      { name: 'is_active', label: 'Active', type: 'checkbox', value: true },
    ], r ? r : {});
    UI.modal({ title: r ? `Edit — ${r.company}` : 'New Upstream Provider', body, wide: true, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          if (r) await UI.api(`/api/providers/${r.id}`, { method: 'PUT', body: f });
          else await UI.api('/api/providers', { method: 'POST', body: f });
          UI.toast('Saved'); close(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Save')) });
  }

  function planForm(p) {
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'capacity_mbps', label: 'Capacity (Mbps) *', type: 'number', value: 1000 },
      { name: 'monthly_cost', label: 'Monthly Cost (PKR) *', type: 'number', value: 150000 },
      { name: 'billing_period', label: 'Billing Period', value: 'monthly' },
      { name: 'started_at', label: 'Started', type: 'date' },
      { name: 'notes', label: 'Notes' },
    ]);
    UI.modal({ title: `Add Plan — ${p.company}`, body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try { await UI.api(`/api/providers/${p.id}/plans`, { method: 'POST', body: f }); UI.toast('Plan added'); close(); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Add Plan')) });
  }

  function invoiceForm(providers) {
    if (!providers.length) return UI.toast('Add a provider first', 'warn');
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'provider_id', label: 'Provider', type: 'select', options: providers.map((p) => [p.id, p.company]) },
      { name: 'period', label: 'Period', placeholder: '2026-11' },
      { name: 'amount', label: 'Amount (PKR) *', type: 'number' },
      { name: 'due_date', label: 'Due Date', type: 'date' },
    ]);
    UI.modal({ title: 'New Provider Invoice', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          await UI.api('/api/providers/invoices', { method: 'POST', body: { ...f, period: f.period || new Date().toISOString().slice(0, 7) } });
          UI.toast('Invoice recorded (payable posted)'); close(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Record Invoice')) });
  }

  function payForm(inv) {
    UI.api('/api/cash-accounts').then((accounts) => {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'amount', label: `Amount (PKR) — outstanding ${UI.money(inv.amount - inv.paid)}`, type: 'number', value: (inv.amount - inv.paid) / 100 },
        { name: 'account_id', label: 'Pay From', type: 'select', options: [[-1, 'Cash (default)'], ...accounts.map((a) => [a.id, `${a.name} (${a.kind})`])] },
        { name: 'transaction_ref', label: 'Transaction Ref' },
      ]);
      UI.modal({ title: `Pay Provider Invoice ${inv.invoice_no}`, body, footer: (ft, close) => ft.append(
        UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
        UI.el('button', { class: 'btn btn-ok', onclick: async () => {
          const f = UI.readFields(inputs);
          try {
            await UI.api('/api/providers/pay', { method: 'POST', body: { provider_invoice_id: inv.id, amount: f.amount, account_id: f.account_id === '-1' ? null : Number(f.account_id), transaction_ref: f.transaction_ref || null } });
            UI.toast('Provider paid — expense posted'); close(); render();
          } catch (e) { UI.toast(e.error || e.message, 'err'); }
        } }, 'Pay')) });
    });
  }
  await render();
  return root;
};

/* ================= REPORTS ================= */
V.reports = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Reports & Exports'), UI.el('div', { class: 'sub' }, 'Date-range reports with CSV export'))));
  const reports = [
    ['collections', 'Collections', ['from', 'to']],
    ['invoices', 'Invoices', ['from', 'to']],
    ['dues_aging', 'Outstanding Dues (Aging)', []],
    ['customers', 'Customers', ['area', 'status']],
    ['expenses', 'Expenses', ['from', 'to']],
    ['provider_payables', 'Provider Payables', []],
    ['tickets', 'Tickets', ['from']],
    ['inventory', 'Inventory Valuation', []],
    ['bandwidth', 'Bandwidth / Sessions (device polls)', []],
  ];
  const body = UI.el('div', { class: 'card' },
    UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Report')),
    UI.el('div', { class: 'card-bd' }));
  const inner = body.querySelector('.card-bd');
  const sel = UI.el('select');
  reports.forEach(([id, label]) => sel.append(UI.el('option', { value: id }, label)));
  const fromD = UI.el('input', { type: 'date' });
  const toD = UI.el('input', { type: 'date' });
  const areaS = UI.el('select');
  areaS.append(UI.el('option', { value: '' }, 'All areas'));
  UI.api('/api/areas').then((as) => as.forEach((a) => areaS.append(UI.el('option', { value: a.name }, a.name)))).catch(() => {});
  const statusS = UI.el('select');
  statusS.append(UI.el('option', { value: '' }, 'All statuses'));
  ['active', 'pending', 'suspended', 'disconnected'].forEach((s) => statusS.append(UI.el('option', { value: s }, s)));
  const out = UI.el('div', { class: 'mt' });
  inner.append(UI.el('div', { class: 'row' }, sel, fromD, toD, areaS, statusS,
    UI.el('button', { class: 'btn btn-primary', onclick: load }, 'Run'),
    UI.el('button', { class: 'btn btn-outline', id: 'csvBtn', onclick: exportCsv }, '⬇ CSV')));
  root.append(body, out);

  let last = null;
  async function load() {
    const def = reports.find((r) => r[0] === sel.value) || reports[0];
    const id = def[0];
    const qs = new URLSearchParams();
    if (def[2].includes('from')) { fromD.style.display = ''; toD.style.display = def[2].includes('to') ? '' : 'none'; }
    else { fromD.style.display = 'none'; toD.style.display = 'none'; }
    if (def[2].includes('area')) areaS.style.display = '';
    else areaS.style.display = 'none';
    if (def[2].includes('status')) statusS.style.display = '';
    else statusS.style.display = 'none';
    if (fromD.style.display !== 'none' && fromD.value) qs.set('from', fromD.value);
    if (toD.style.display !== 'none' && toD.value) qs.set('to', toD.value);
    if (areaS.style.display !== 'none' && areaS.value) qs.set('area', areaS.value);
    if (statusS.style.display !== 'none' && statusS.value) qs.set('status', statusS.value);
    const d = await UI.api(`/api/reports/${id}?${qs}`);
    last = d;
    const cols = d.rows.length ? Object.keys(d.rows[0]) : [];
    out.replaceChildren(UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, `${UI.esc(d.title)} — ${d.rows.length} rows`)),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: cols.map((c) => ({ key: c, label: c, render: (r) => (typeof r[c] === 'number' && c !== 'days_overdue' && c !== 'stock' && c !== 'qty' ? UI.money(r[c]) : UI.esc(r[c] == null ? '—' : String(r[c]))) })),
        rows: d.rows,
        empty: 'No rows',
      }))));
  }

  function exportCsv() {
    if (!last) return UI.toast('Run a report first', 'warn');
    const cols = last.rows.length ? Object.keys(last.rows[0]) : [];
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(','), ...last.rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sel.value}-report.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  await load();
  return root;
};

/* ================= AUDIT ================= */
V.audit = async function () {
  const root = UI.el('div');
  const state = { page: '1', q: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Audit Log'), UI.el('div', { class: 'sub' }, 'Immutable — who did what, when, from where. Never editable or deletable.')),
    UI.el('div', { class: 'page-actions' },
      UI.el('button', { class: 'btn btn-outline', onclick: () => {
        const a = document.createElement('a');
        a.href = '/api/audit?csv=1';
        a.download = 'audit.csv';
        a.click();
      } }, '⬇ Export CSV'))));
  const box = UI.el('div', { class: 'card' });
  root.append(box);
  const render = async () => {
    const d = await UI.api(`/api/audit?limit=200`);
    let rows = d.rows || [];
    if (state.q) {
      const q = state.q.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    }
    box.replaceChildren(
      UI.el('div', { class: 'card-bd' }, UI.el('input', { placeholder: 'Filter (user, action, entity, details)…', value: state.q, oninput: (e) => { state.q = e.target.value; render(); }, style: 'width:100%; border:1.5px solid var(--line-2); border-radius:9px; padding:9px 12px; margin-bottom:12px;' })),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'at', label: 'When', render: (r) => UI.dt(r.at) },
          { key: 'user_name', label: 'User' },
          { key: 'action', label: 'Action', render: (r) => `<b>${UI.esc(r.action)}</b>` },
          { key: 'entity', label: 'Entity' },
          { key: 'details', label: 'Details', render: (r) => r.details ? UI.esc(JSON.stringify(r.details)).slice(0, 140) : '—' },
          { key: 'ip', label: 'IP' },
        ],
        rows,
        empty: 'No audit entries',
      })));
  };
  await render();
  return root;
};
