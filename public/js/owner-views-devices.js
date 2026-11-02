/* Owner views — Devices & Settings */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= DEVICES ================= */
V.devices = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Devices'), UI.el('div', { class: 'sub' }, 'RouterOS (MikroTik) / OLT integration — pluggable drivers, mock-first, safe mode, never fake success'))));
  const [devices, safe] = await Promise.all([
    UI.api('/api/devices'),
    UI.api('/api/settings').catch(() => ({})),
  ]);
  const globalSafe = !!(safe.devices && safe.devices.global_safe_mode);
  const demo = devices.every((d) => d.driver === 'mock');

  const banner = UI.el('div', { class: 'alert ' + (demo ? 'warn' : 'ok') + ' mb' },
    demo
      ? '🔌 <b>MATCH A (demo/standalone) MODE</b> — all devices run the <b>mock driver</b>. Commands return clearly-labeled simulated results; billing never depends on them. Add a real MikroTik device below (API port 8729) and enable it to go live.'
      : '🔌 Live device integration active. Commands are queued, retried, and status-synced; safe mode blocks destructive actions globally.');
  root.append(banner);

  const tabs = UI.el('div', { class: 'tabs' });
  const box = UI.el('div');
  const tabDefs = [['list', '🖥 Devices'], ['commands', 'Command Queue'], ['history', 'Status History']];
  let current = 'list';
  const draw = () => {
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd muted' }, 'Loading…')));
    if (current === 'list') drawList();
    else if (current === 'commands') drawCommands();
    else drawHistory();
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

  const safeRow = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd row' },
    UI.el('span', {}, '🛡 Global Safe Mode'),
    UI.el('span', { class: 'badge ' + (globalSafe ? 'yellow' : 'green') }, globalSafe ? 'ON — destructive actions blocked' : 'OFF'),
    UI.el('button', { class: 'btn btn-outline btn-sm', onclick: async () => {
      try { await UI.api('/api/devices/safe-mode', { method: 'POST', body: { enabled: !globalSafe } }); UI.toast('Safe mode ' + (!globalSafe ? 'ON' : 'OFF')); location.reload(); }
      catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, globalSafe ? 'Disable Safe Mode' : 'Enable Safe Mode')));
  root.append(safeRow);

  async function drawList() {
    const rows = await UI.api('/api/devices');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Configured Devices'), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => deviceForm(null) }, '+ Add Device')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Device', render: (r) => `<b>${UI.esc(r.name)}</b><br><span class="muted small">${UI.esc(r.vendor || '')} ${UI.esc(r.model || '')}</span>` },
        { key: 'kind', label: 'Kind' },
        { key: 'driver', label: 'Driver', render: (r) => UI.statusBadge(r.driver === 'mock' ? 'framework' : r.driver === 'mikrotik' ? 'connected' : 'pending') },
        { key: 'host', label: 'Host', render: (r) => `${r.host || '—'}${r.port ? ':' + r.port : ''}` },
        { key: 'status', label: 'State', render: (r) => UI.statusBadge(r.status) },
        { key: 'last_sync_at', label: 'Last Sync', render: (r) => UI.dt(r.last_sync_at) },
        { key: 'identity', label: 'Identity', render: (r) => r.identity ? `<span class="muted small">${UI.esc(r.identity.identity || r.identity.model || '—')}</span>` : '—' },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => testDevice(r) }, 'Test'),
          UI.el('button', { class: 'btn btn-ghost btn-xs', onclick: () => commandModal(r) }, 'Command'),
          r.status === 'enabled'
            ? UI.el('button', { class: 'btn btn-warn btn-xs', onclick: async () => {
              if (!(await UI.confirm(`Disable ${r.name}?`))) return;
              try { await UI.api(`/api/devices/${r.id}/disable`, { method: 'POST', body: {} }); UI.toast('Disabled'); drawList(); }
              catch (e) { UI.toast(e.error || e.message, 'err'); }
            } }, 'Disable')
            : UI.el('button', { class: 'btn btn-ok btn-xs', onclick: async () => {
              try { await UI.api(`/api/devices/${r.id}/enable`, { method: 'POST', body: {} }); UI.toast('Enabled'); drawList(); }
              catch (e) { UI.toast(e.error || e.message, 'err'); }
            } }, 'Enable'),
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => deviceForm(r) }, 'Edit')) },
      ],
      rows,
      empty: 'No devices configured',
    })));
    box.replaceChildren(card);
  }

  function deviceForm(r) {
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Real MikroTik: driver <b>mikrotik</b>, protocol <b>api</b>, port <b>8729</b>, host = router IP, plus API username/password. Until you test & enable, the system keeps working in mock mode.'));
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Name *' },
      { name: 'vendor', label: 'Vendor', placeholder: 'MikroTik / Huawei / …' },
      { name: 'model', label: 'Model' },
      { name: 'kind', label: 'Kind', type: 'select', options: [['router', 'Router'], ['olt', 'OLT'], ['other', 'Other']] },
      { name: 'driver', label: 'Driver', type: 'select', options: [['mock', 'Mock (simulated — demo)'], ['mikrotik', 'MikroTik RouterOS API'], ['snmp', 'SNMP']] },
      { name: 'host', label: 'Host / IP', placeholder: '192.168.88.1' },
      { name: 'port', label: 'Port', type: 'number', value: r ? r.port || 8729 : 8729 },
      { name: 'username', label: 'API Username' },
      { name: 'password', label: 'API Password (encrypted at rest, never shown again)', type: 'password' },
      { name: 'safe_mode', label: 'Device-level Safe Mode (block destructive actions)', type: 'checkbox', value: r ? !!r.safe_mode : false },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ], r ? r : {});
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      try {
        if (r) { await UI.api(`/api/devices/${r.id}`, { method: 'PUT', body: f }); UI.toast('Device updated'); }
        else { const resp = await UI.api('/api/devices', { method: 'POST', body: f }); UI.toast(resp.note || 'Device added (disabled — test then enable)'); }
        m.close(); drawList();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, r ? 'Save' : 'Add Device');
    const m = UI.modal({ title: r ? `Edit — ${r.name}` : 'Add Device', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  async function testDevice(r) {
    UI.toast('Testing connection…', 'ok', 1500);
    try {
      const res = await UI.api(`/api/devices/${r.id}/test`, { method: 'POST', body: {} });
      UI.modal({ title: `Test Result — ${r.name}`, wide: true, body:
        `<div class="alert ${res.ok ? 'ok' : 'err'}">${res.ok ? '✅ Connection OK' : '❌ Connection failed'}${res.simulated ? ' <span class="badge yellow">SIMULATED (mock driver)</span>' : ''}</div>
         <pre style="background:var(--bg); padding:12px; border-radius:9px; font-size:.78rem; overflow-x:auto;">${UI.esc(JSON.stringify(res, null, 2))}</pre>` });
      drawList();
    } catch (e) {
      UI.modal({ title: `Test Failed — ${r.name}`, body: `<div class="alert err">${UI.esc(e.error || e.message)}</div>` });
    }
  }

  function commandModal(r) {
    const body = UI.el('div');
    const actions = [
      ['test_connection', 'Test connection', false],
      ['info', 'Router info / uptime', false],
      ['list_sessions', 'List active PPPoE sessions', false],
      ['list_onus', 'List ONUs (GPON)', false],
      ['enable_user', 'Enable PPPoE user', false],
      ['disable_user', 'Disable PPPoE user (keeps account)', true],
      ['disconnect_session', 'Disconnect active session', true],
      ['add_secret', 'Add PPPoE secret (new activation)', false],
      ['remove_secret', 'Remove PPPoE secret (deactivation)', true],
      ['set_profile', 'Set queueing profile', false],
      ['onu_enable', 'Enable ONU', false],
      ['onu_disable', 'Disable ONU', true],
      ['onu_reboot', 'Reboot ONU', true],
    ];
    const sel = UI.el('select', { style: 'width:100%; border:1.5px solid var(--line-2); border-radius:9px; padding:9px 12px; margin-bottom:10px;' });
    actions.forEach(([v, l]) => sel.append(UI.el('option', { value: v }, l + (actions.find((a) => a[0] === v)[2] ? ' ⚠ destructive' : ''))));
    const payloadTa = UI.el('textarea', { rows: 4, style: 'width:100%; font-family:monospace; font-size:.8rem; border:1.5px solid var(--line-2); border-radius:9px; padding:10px; margin-bottom:8px;', placeholder: '{} e.g. {"username":"rana1001"}' });
    const custInp = UI.el('input', { placeholder: 'customer_id (optional, for logs)', type: 'number', style: 'width:100%; border:1.5px solid var(--line-2); border-radius:9px; padding:9px 12px; margin-bottom:8px;' });
    body.append(UI.el('label', { class: 'small' }, 'Action'), sel,
      UI.el('label', { class: 'small' }, 'JSON Payload'), payloadTa,
      UI.el('label', { class: 'small' }, 'Customer ID'), custInp);
    const confirmChk = UI.el('input', { type: 'checkbox' });
    const confirmRow = UI.el('div', { class: 'row mb' }, confirmChk, UI.el('span', { class: 'small' }, 'I confirm this destructive action'));
    body.append(confirmRow);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      let payload = {};
      try { payload = JSON.parse(payloadTa.value || '{}'); } catch { return UI.toast('Payload must be valid JSON', 'err'); }
      const destructive = actions.find((a) => a[0] === sel.value)[2];
      try {
        const res = await UI.api(`/api/devices/${r.id}/command`, { method: 'POST', body: {
          action: sel.value, payload,
          customer_id: custInp.value ? Number(custInp.value) : null,
          confirm: destructive ? confirmChk.checked : false,
        } });
        UI.toast(`Command queued (${res.command.id}) — worker will process it`);
        m.close(); current = 'commands';
        tabs.querySelectorAll('button')[1].click();
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Queue Command');
    const m = UI.modal({ title: `Send Command — ${r.name}`, body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
  }

  async function drawCommands() {
    const d = await UI.api('/api/device-commands?limit=30');
    box.replaceChildren(UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Command Queue / Log'), UI.el('button', { class: 'btn btn-ghost btn-sm', onclick: () => drawCommands() }, '↻ Refresh')),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'id', label: '#' },
          { key: 'device_name', label: 'Device' },
          { key: 'action', label: 'Action', render: (r) => `<b>${UI.esc(r.action)}</b>` },
          { key: 'customer_name', label: 'Customer', render: (r) => UI.esc(r.customer_name || (r.cname || '')) },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
          { key: 'attempts', label: 'Tries', cls: 'num' },
          { key: 'last_error', label: 'Error / Notes', render: (r) => r.last_error ? `<span class="small" style="color:var(--bad)">${UI.esc(r.last_error)}</span>` : (r.response && r.response.simulated ? '<span class="badge yellow">simulated</span>' : '') },
          { key: 'at', label: 'When', render: (r) => UI.dt(r.created_at || r.at) },
        ],
        rows: d.rows,
        empty: 'No commands yet',
      }))));
  }

  async function drawHistory() {
    const rows = await UI.api('/api/device-status-history');
    box.replaceChildren(UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Status History (polls & syncs)')),
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'at', label: 'When', render: (r) => UI.dt(r.at) },
          { key: 'device_name', label: 'Device' },
          { key: 'scope', label: 'Scope' },
          { key: 'summary', label: 'Summary', render: (r) => {
            try {
              const d = r.data || {};
              if (d.sessions) return `${d.sessions.length} sessions ${d.simulated ? '(simulated)' : ''}`;
              if (d.onus) return `${d.onus.online}/${d.onus.total} ONUs online`;
              if (d.identity) return UI.esc(d.identity);
              return UI.esc(JSON.stringify(d).slice(0, 120));
            } catch { return '—'; }
          } },
        ],
        rows,
        empty: 'No history yet',
      }))));
  }

  drawList();
  return root;
};

/* ================= SETTINGS ================= */
V.settings = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Settings'), UI.el('div', { class: 'sub' }, 'Company, billing, payments, notifications, automation, backup & security'))));
  const S = await UI.api('/api/settings');
  const tabs = UI.el('div', { class: 'tabs' });
  const box = UI.el('div');
  const tabDefs = [
    ['company', '🏢 Company & Logo'],
    ['billing', '🧾 Billing Rules'],
    ['payments', '💳 Payment Methods'],
    ['notifications', '🔔 Notifications & Templates'],
    ['devices', '🔌 Devices'],
    ['automation', '⚙️ Automation'],
    ['backup', '💾 Backup'],
    ['security', '🔐 Security & 2FA'],
    ['map', '🗺 Map'],
  ];
  let current = 'company';
  const save = async (group, payload) => {
    try {
      await UI.api(`/api/settings/${group}`, { method: 'PUT', body: payload });
      UI.toast('Settings saved');
      return true;
    } catch (e) { UI.toast(e.error || e.message, 'err'); return false; }
  };
  const tabDefs2 = tabDefs;
  tabDefs2.forEach(([k, l]) => {
    const b = UI.el('button', { class: k === current ? 'active' : '', onclick: () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      current = k;
      drawTab(k);
    } }, l);
    tabs.append(b);
  });
  root.append(tabs, box);
  drawTab('company');

  function groupForm(group, defs, vals, extraLabel) {
    const body = UI.el('div');
    const inputs = UI.fields(body, defs, vals || {});
    if (extraLabel) body.append(extraLabel);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      if (await save(group, UI.readFields(inputs))) m.close();
    } }, 'Save');
    const m = UI.modal({ title: `Settings — ${group}`, body, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    return inputs;
  }

  function drawTab(k) {
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd muted' }, 'Loading…')));
    if (k === 'company') return drawCompany();
    if (k === 'billing') return drawBilling();
    if (k === 'payments') return drawPayments();
    if (k === 'notifications') return drawNotifications();
    if (k === 'devices') return drawDeviceSettings();
    if (k === 'automation') return drawAutomation();
    if (k === 'backup') return drawBackup();
    if (k === 'security') return drawSecurity();
    if (k === 'map') return drawMap();
  }

  function drawCompany() {
    const c = S.company || {};
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'name', label: 'Company Name *', value: c.name || 'Rana Internet' },
      { name: 'tagline', label: 'Tagline', value: c.tagline || '' },
      { name: 'address', label: 'Address', value: c.address || '' },
      { name: 'phone', label: 'Phone', value: c.phone || '' },
      { name: 'whatsapp', label: 'WhatsApp', value: c.whatsapp || '' },
      { name: 'email', label: 'Email', value: c.email || '' },
      { name: 'hours', label: 'Business Hours', value: c.hours || '' },
      { name: 'currency', label: 'Currency', value: c.currency || 'PKR' },
      { name: 'invoice_footer', label: 'Invoice Footer', type: 'textarea', value: c.invoice_footer || '' },
    ]);
    // logo
    const logoInp = UI.el('input', { type: 'file', accept: 'image/*' });
    const logoPrev = c.logo_path ? UI.el('img', { src: `/api/files/public/${c.logo_path.split('/').pop()}`, style: 'height:48px; border-radius:8px; border:1px solid var(--line); margin-right:8px;' }) : null;
    const logoRow = UI.el('div', { class: 'row mt' }, logoPrev, logoInp,
      UI.el('button', { class: 'btn btn-outline btn-sm', onclick: async () => {
        const f = logoInp.files[0];
        if (!f) return UI.toast('Choose an image first', 'err');
        const fd = new FormData();
        fd.append('file', f);
        try {
          const res = await fetch('/api/settings/logo', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': UI.csrf } });
          const j = await res.json();
          if (!res.ok) return UI.toast(j.error || 'Upload failed', 'err');
          UI.toast('Logo updated — used on invoice PDF'); location.reload();
        } catch (e) { UI.toast(e.message, 'err'); }
      } }, '⬆ Upload Logo'));
    body.append(UI.el('div', { class: 'field' }, UI.el('label', {}, 'Logo (shows on invoice PDF)'), logoRow));
    body.append(UI.el('div', { class: 'hint' }, 'These details render on the customer website and the invoice PDF automatically.'));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => { if (await save('company', UI.readFields(inputs))) UI.toast('Saved'); } }, 'Save Company');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn))));
  }

  function drawBilling() {
    const b = S.billing || {};
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'default_grace_days', label: 'Default Grace Days (after due date)', type: 'number', value: b.default_grace_days ?? 3 },
      { name: 'due_days_after_invoice', label: 'Due Days After Invoice', type: 'number', value: b.due_days_after_invoice ?? 10 },
      { name: 'late_fee_per_day', label: 'Late Fee per Day (PKR, after grace)', type: 'number', value: (b.late_fee_per_day ?? 0) / 100 },
      { name: 'aging_bucket1_days', label: 'Aging Bucket 1 (days)', type: 'number', value: b.aging_bucket1_days ?? 7 },
      { name: 'aging_bucket2_days', label: 'Aging Bucket 2 (days)', type: 'number', value: b.aging_bucket2_days ?? 15 },
    ]);
    body.append(UI.el('div', { class: 'hint mt' }, 'Package change is always prorate-chargeable; the adjustment posts as a line item on the next invoice. Late fee is added automatically when grace expires.'));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const f = UI.readFields(inputs);
      f.late_fee_per_day = Math.round(Number(f.late_fee_per_day || 0) * 100);
      if (await save('billing', f)) UI.toast('Billing rules saved');
    } }, 'Save Billing Rules');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn))));
  }

  async function drawPayments() {
    const p = S.payments || {};
    const methods = p.methods || ['cash', 'bank_transfer', 'jazzcash', 'easypaisa', 'raast', 'other'];
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Enabled methods appear in the payment form and on the customer site. Duplicate transaction references are always flagged for confirmation.'));
    const list = UI.el('div');
    methods.forEach((mth) => {
      const chk = UI.el('input', { type: 'checkbox', checked: methods.includes(mth) ? '' : null, value: mth });
      list.append(UI.el('label', { class: 'row', style: 'padding:5px 0;' }, chk, UI.el('span', {}, mth.replace('_', ' '))));
    });
    body.append(list);
    const accounts = await UI.api('/api/cash-accounts').catch(() => []);
    const body2 = UI.el('div');
    const inputs = UI.fields(body2, [
      { name: 'default_account_id', label: 'Default Receive Account', type: 'select', options: [[-1, 'Auto'], ...accounts.map((a) => [a.id, `${a.name} (${a.kind})`])], value: String(p.default_account_id ?? -1) },
    ]);
    body.append(UI.el('div', { class: 'mt' }, UI.el('b', { class: 'small' }, 'Default account'), body2));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      const enabled = [...list.querySelectorAll('input')].filter((c) => c.checked).map((c) => c.value);
      if (!enabled.length) return UI.toast('Keep at least one method enabled', 'err');
      const f = UI.readFields(inputs);
      const payload = { methods: enabled, default_account_id: f.default_account_id === '-1' ? null : Number(f.default_account_id) };
      if (await save('payments', payload)) UI.toast('Payment settings saved');
    } }, 'Save Payment Settings');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn))));
  }

  async function drawNotifications() {
    const n = S.notifications || {};
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert warn' }, '📬 <b>No external delivery gateway is configured.</b> Notifications are generated from editable templates below, recorded in the notification log, and surfaced here. When a WhatsApp/SMS gateway is added later, the same log becomes the delivery record — the UI will never claim a send that did not happen.'));
    const templates = await UI.api('/api/notification-templates').catch(() => []);
    const log = await UI.api('/api/notification-logs').catch(() => []);
    const list = UI.el('div');
    templates.forEach((t) => {
      const ta = UI.el('textarea', { rows: 3, style: 'width:100%; font-size:.8rem; border:1.5px solid var(--line-2); border-radius:9px; padding:9px; margin-top:4px;', placeholder: 'Message body — {customer}, {invoice}, {amount}, {due_date} are replaced' }, t.body);
      list.append(UI.el('div', { class: 'field' },
        UI.el('label', {}, `${UI.esc(t.tkey)} ${t.is_active ? '' : '(inactive)'}`),
        ta,
        UI.el('button', { class: 'btn btn-outline btn-xs mt', onclick: async () => {
          try { await UI.api(`/api/notification-templates/${t.id}`, { method: 'PUT', body: { body: ta.value } }); UI.toast(`Template ${t.tkey} saved`); }
          catch (e) { UI.toast(e.error || e.message, 'err'); }
        } }, 'Save Template')));
    });
    body.append(list);
    if (log.length) {
      body.append(UI.el('b', { class: 'small mt' }, 'Recent notification log'));
      body.append(UI.table({
        columns: [
          { key: 'at', label: 'When', render: (r) => UI.dt(r.at) },
          { key: 'customer_name', label: 'Customer' },
          { key: 'template', label: 'Template', render: (r) => UI.esc(r.template || r.tkey || '—') },
          { key: 'channel', label: 'Channel' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status === 'sent' ? 'sent' : r.status === 'logged' ? 'pending_sync' : r.status) },
        ],
        rows: log.slice(0, 10),
      }));
    }
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Notification Templates & Log')), UI.el('div', { class: 'card-bd' }, body)));
  }

  function drawDeviceSettings() {
    const d = S.devices || {};
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'poll_enabled', label: 'Enable background polling (sessions/ONUs/bandwidth)', type: 'checkbox', value: d.poll_enabled ?? true },
      { name: 'poll_interval_sec', label: 'Poll Interval (seconds)', type: 'number', value: d.poll_interval_sec ?? 300 },
      { name: 'global_safe_mode', label: 'Global Safe Mode (block all destructive device actions)', type: 'checkbox', value: !!d.global_safe_mode },
    ]);
    body.append(UI.el('div', { class: 'hint mt' }, 'With no real devices, the mock driver keeps billing fully functional (Mode A). Enable polling only once a real device is connected.'));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => { if (await save('devices', UI.readFields(inputs))) UI.toast('Device settings saved'); } }, 'Save');
    body.append(UI.el('div', { class: 'row mt' }, btn, UI.el('a', { class: 'btn btn-outline', href: '#/devices' }, 'Manage Devices →')));
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body)));
  }

  function drawAutomation() {
    const a = S.automation || {};
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'auto_suspension_enabled', label: 'Auto-suspend after grace + late-fee window', type: 'checkbox', value: a.auto_suspension_enabled ?? false },
      { name: 'auto_suspension_days', label: 'Days overdue to suspend', type: 'number', value: a.auto_suspension_days ?? 15 },
      { name: 'reactivate_on_payment', label: 'Auto-reactivate when dues clear', type: 'checkbox', value: a.reactivate_on_payment ?? true },
      { name: 'invoice_generation_enabled', label: 'Scheduled invoice generation (nightly)', type: 'checkbox', value: a.invoice_generation_enabled ?? true },
      { name: 'backup_daily', label: 'Automatic daily backup', type: 'checkbox', value: a.backup_daily ?? true },
    ]);
    body.append(UI.el('div', { class: 'hint mt' }, 'Automation is conservative by default: suspensions always carry a reason, and reactivation only happens when total dues reach zero.'));
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => { if (await save('automation', UI.readFields(inputs))) UI.toast('Automation saved'); } }, 'Save');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn))));
  }

  async function drawBackup() {
    const list = await UI.api('/api/backups');
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Full SQLite backups (data + uploaded files). Take one before big operations; restore = swap the file. Keep copies off-box for real DR.'));
    const rows = UI.el('div');
    list.forEach((b) => {
      rows.append(UI.el('div', { class: 'file-item' },
        UI.el('span', {}, `${UI.esc(b.name)} <span class="doc-badge">${(b.size / 1024).toFixed(0)} KB</span>`),
        UI.el('span', { class: 'row' },
          UI.el('span', { class: 'muted small' }, UI.dt(b.at)),
          UI.el('a', { class: 'btn btn-outline btn-xs', href: `/api/backups/${encodeURIComponent(b.name)}`, download: b.name }, 'Download'))));
    });
    if (!list.length) rows.append(UI.el('p', { class: 'muted small' }, 'No backups yet.'));
    body.append(rows);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
      UI.toast('Creating backup…', 'ok', 1200);
      try {
        const r = await UI.api('/api/backups', { method: 'POST', body: {} });
        UI.toast(r.name ? `Backup ${r.name} created` : 'Backup created');
        drawTab('backup');
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, '📦 Create Backup Now');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Backups')), UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn))));
  }

  function drawSecurity() {
    const body = UI.el('div');
    // password
    const pw = UI.fields(UI.el('div'), [
      { name: 'current', label: 'Current Password', type: 'password' },
      { name: 'new', label: 'New Password (min 8)', type: 'password' },
    ]);
    body.append(UI.el('b', { class: 'small' }, 'Change Password'), pw.c,
      UI.el('button', { class: 'btn btn-outline btn-sm', onclick: async () => {
        const f = UI.readFields(pw);
        try { await UI.api('/api/password', { method: 'POST', body: f }); UI.toast('Password changed'); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Change Password'));
    // 2FA
    const auth = S._auth || {};
    body.append(UI.el('div', { class: 'mt' }, UI.el('b', { class: 'small' }, 'Two-Factor Authentication (TOTP)'),
      UI.el('div', { class: 'alert ' + (auth.totpEnabled ? 'ok' : 'warn'), style: 'margin:8px 0;' },
        auth.totpEnabled ? '✅ 2FA is enabled — required at login.' : '⚠️ 2FA is not enabled. Recommended for owner access.'),
      UI.el('div', { class: 'row' },
        UI.el('button', { class: 'btn btn-primary btn-sm', onclick: totpSetup }, auth.totpEnabled ? 'Reshare Setup Code' : 'Enable 2FA'),
        auth.totpEnabled ? UI.el('button', { class: 'btn btn-danger btn-sm', onclick: totpDisable }, 'Disable 2FA') : null)));
    // throttle note
    body.append(UI.el('div', { class: 'alert info mt' }, '🔒 Login is rate-limited: 5 failed attempts per IP locks for 15 minutes (audited). Sessions use HttpOnly cookies + CSRF tokens on all mutations.'));
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Security')), UI.el('div', { class: 'card-bd' }, body)));
  }

  async function totpSetup() {
    const s = await UI.api('/api/totp/setup');
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'alert info' }, 'Add this secret to Google Authenticator / any TOTP app, then enter the 6-digit code.'));
    body.append(UI.el('pre', { style: 'background:var(--bg); padding:12px; border-radius:9px; font-size:.9rem; letter-spacing:.08em;' }, UI.esc(s.secret)));
    body.append(UI.el('a', { class: 'btn btn-outline btn-sm mt', href: s.otpauth_url }, 'Open otpauth:// URI'));
    const codeInp = UI.el('input', { maxlength: 6, placeholder: '6-digit code', style: 'width:140px; border:1.5px solid var(--line-2); border-radius:9px; padding:9px 12px; margin-top:10px; text-align:center; font-size:1rem; letter-spacing:.2em;' });
    body.append(codeInp);
    UI.modal({ title: 'Enable 2FA', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-ok', onclick: async () => {
        try { await UI.api('/api/totp/enable', { method: 'POST', body: { code: codeInp.value } }); UI.toast('2FA enabled'); close(); drawTab('security'); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Verify & Enable')) });
  }

  function totpDisable() {
    if (!UI.confirm('Disable 2FA? You will be less secure.')) return;
    const body = UI.el('div');
    UI.fields(body, [
      { name: 'code', label: 'Current 2FA Code', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ]);
    const sel = body.querySelector('input'), pw = body.querySelector('input[type=password]');
    UI.modal({ title: 'Disable 2FA', body, footer: (ft, close) => ft.append(
      UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
      UI.el('button', { class: 'btn btn-danger', onclick: async () => {
        try { await UI.api('/api/totp/disable', { method: 'POST', body: { code: sel.value, password: pw.value } }); UI.toast('2FA disabled'); close(); drawTab('security'); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Disable')) });
  }

  function drawMap() {
    const m = S.map || {};
    const body = UI.el('div');
    const inputs = UI.fields(body, [
      { name: 'lat', label: 'Default Map Center — Lat', type: 'number', value: m.lat ?? 31.52 },
      { name: 'lng', label: 'Default Map Center — Lng', type: 'number', value: m.lng ?? 74.35 },
      { name: 'zoom', label: 'Default Zoom', type: 'number', value: m.zoom ?? 12 },
    ]);
    const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => { if (await save('map', UI.readFields(inputs))) UI.toast('Map settings saved'); } }, 'Save');
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd' }, body, UI.el('div', { class: 'row mt' }, btn, UI.el('a', { class: 'btn btn-outline', href: '#/map' }, 'Open Live Map →')))));
  }
  return root;
};
