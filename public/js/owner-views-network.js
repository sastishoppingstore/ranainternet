/* Owner views — Network inventory, Tree, Map, Installations, Tickets */
'use strict';
window.Views = window.Views || {};
var V = window.Views;

/* ================= NETWORK ================= */
V.network = async function (params) {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Network'), UI.el('div', { class: 'sub' }, 'POP → OLT → PON → Splitter → Fiber Box → Port → ONU hierarchy + fault tracing'))));
  const tabs = UI.el('div', { class: 'tabs' });
  const box = UI.el('div');
  const tabDefs = [
    ['tree', '🌳 Hierarchy Tree'],
    ['areas', 'Areas'],
    ['pops', 'POPs'],
    ['olts', 'OLTs / PON'],
    ['splitters', 'Splitters'],
    ['boxes', 'Fiber Boxes'],
    ['onus', 'ONUs'],
    ['faults', 'Fault Tracing'],
  ];
  const current = tabDefs.some(([k]) => k === params.tab) ? params.tab : 'tree';
  let activeBtn = null;
  tabDefs.forEach(([k, l]) => {
    const b = UI.el('button', { class: k === current ? 'active' : '', onclick: () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderTab(k);
    } }, l);
    tabs.append(b);
    if (k === current) activeBtn = b;
  });
  root.append(tabs, box);
  await renderTab(current);

  async function renderTab(k) {
    box.replaceChildren(UI.el('div', { class: 'card' }, UI.el('div', { class: 'card-bd muted' }, 'Loading…')));
    if (k === 'tree') return renderTree();
    if (k === 'areas') return renderCrud('areas', 'Area', areaFields, 'areas');
    if (k === 'pops') return renderCrud('pops', 'POP', popFields, 'pops');
    if (k === 'olts') return renderOlts();
    if (k === 'splitters') return renderCrud('splitters', 'Splitter', splitterFields, 'splitters');
    if (k === 'boxes') return renderBoxes();
    if (k === 'onus') return renderCrud('onus', 'ONU', onuFields, 'onus');
    if (k === 'faults') return renderFaults();
  }

  async function renderTree() {
    const d = await UI.api('/api/network/tree');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Network Hierarchy'), UI.el('span', { class: 'muted small' }, `${d.onuCount} ONUs registered`)),
      UI.el('div', { class: 'card-bd' }));
    const wrap = card.querySelector('.card-bd');
    const t = UI.el('div', { class: 'treetable' });
    const row = (cls, html) => t.append(UI.el('div', { class: cls, html, style: 'padding:4px 8px; border-bottom:1px dashed var(--line);' }));
    d.tree.forEach((pop) => {
      row('lv0', `🏢 ${UI.esc(pop.pop.name)} <span class="muted small">${UI.esc(pop.pop.address || '')}</span>`);
      pop.olts.forEach(({ olt, pon_ports }) => {
        row('lv1', `└ OLT ${UI.esc(olt.name)} <span class="muted small">(${olt.vendor || 'TBD'} • ${olt.pon_count} PONs • ${olt.driver_status})</span>`);
        pon_ports.forEach(({ pon, splitters, directBoxes }) => {
          row('lv2', `└ PON ${pon.port_no} ${UI.esc(pon.name || '')} <span class="muted small">(${UI.esc(pon.profile || '')})</span>`);
          const renderBox = (b, extra = '') => {
            row('lv3', `${extra}└ 📦 ${UI.esc(b.box.name)} <span class="muted small">${b.usage}/${b.capacity} ports used</span>`);
            b.ports.forEach(({ port, customer }) => {
              if (customer) row('lv4', `└ P${port.port_no} — <b>${UI.esc(customer.name)}</b> (${UI.esc(customer.customer_code)}) ${UI.statusBadge(customer.status)}`);
              else row('lv4', `└ P${port.port_no} — <span class="muted">free</span>`);
            });
          };
          splitters.forEach(({ splitter, boxes }) => {
            row('lv3', `└ 🔀 ${UI.esc(splitter.name)} ${UI.esc(splitter.ratio || '')}`);
            boxes.forEach((b) => renderBox(b, '└ '));
          });
          directBoxes.forEach((b) => renderBox(b, ''));
        });
      });
    });
    if (d.orphanOlts && d.orphanOlts.length) {
      row('lv0', `⚠️ OLTs not assigned to a POP: ${d.orphanOlts.map((x) => UI.esc(x.olt.name)).join(', ')}`);
    }
    if (d.orphanBoxes && d.orphanBoxes.length) {
      row('lv0', `⚠️ Fiber boxes not attached to any PON/splitter: ${d.orphanBoxes.map((x) => UI.esc(x.box.name)).join(', ')}`);
    }
    box.replaceChildren(card);
  }

  async function renderCrud(name, label, fields, path, extraCols = []) {
    const [rows, areas] = await Promise.all([
      UI.api(`/${path}`),
      UI.api('/api/areas').catch(() => []),
    ]);
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, label), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => formModal(null, label) }, `+ New ${label}`)));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Name', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        ...extraCols,
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => formModal(r, label) }, 'Edit'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete ${label.toLowerCase()} "${r.name}"?`))) return;
            try { await UI.api(`/${path}/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); renderCrud(name, label, fields, path, extraCols); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Del')) },
      ],
      rows,
      empty: `No ${label.toLowerCase()}s yet`,
    })));
    box.replaceChildren(card);

    function formModal(r, l2) {
      const body = UI.el('div');
      const defs = fields({ areas });
      const inputs = UI.fields(body, defs, r ? r : {});
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          if (r) { await UI.api(`/${path}/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
          else { await UI.api(`/${path}`, { method: 'POST', body: f }); UI.toast('Created'); }
          m.close(); renderCrud(name, l2, fields, path, extraCols);
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, r ? 'Save' : 'Create');
      const m = UI.modal({ title: r ? `Edit ${l2} — ${r.name}` : `New ${l2}`, body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    }
  }

  function areaFields() {
    return [
      { name: 'name', label: 'Name *' },
      { name: 'zone', label: 'Zone / City' },
      { name: 'description', label: 'Description' },
      { name: 'lat', label: 'Latitude', type: 'number' },
      { name: 'lng', label: 'Longitude', type: 'number' },
      { name: 'is_active', label: 'Active', type: 'checkbox', value: true },
    ];
  }
  function popFields({ areas }) {
    return [
      { name: 'name', label: 'Name *' },
      { name: 'area_id', label: 'Area', type: 'select', options: [[-1, '— select —'], ...areas.map((a) => [a.id, a.name])] },
      { name: 'address', label: 'Address' },
      { name: 'lat', label: 'Latitude', type: 'number' },
      { name: 'lng', label: 'Longitude', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  }
  function splitterFields({ areas }) {
    return [
      { name: 'name', label: 'Name *' },
      { name: 'ratio', label: 'Ratio', placeholder: '1:8' },
      { name: 'capacity', label: 'Capacity (ports)', type: 'number', value: 8 },
      { name: 'pon_port_id', label: 'PON Port ID (from OLTs tab)', type: 'number' },
      { name: 'area_id', label: 'Area', type: 'select', options: [[-1, '— select —'], ...areas.map((a) => [a.id, a.name])] },
      { name: 'lat', label: 'Latitude', type: 'number' },
      { name: 'lng', label: 'Longitude', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  }
  function onuFields() {
    return [
      { name: 'serial', label: 'Serial Number' },
      { name: 'mac', label: 'MAC Address' },
      { name: 'customer_id', label: 'Customer ID', type: 'number' },
      { name: 'box_port_id', label: 'Box Port ID', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', options: [['registered', 'Registered'], ['online', 'Online'], ['offline', 'Offline'], ['faulty', 'Faulty']] },
      { name: 'rx_power', label: 'RX Power (dBm)', type: 'number' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  }

  async function renderOlts() {
    const [olts, pops] = await Promise.all([UI.api('/api/olts'), UI.api('/api/pops').catch(() => [])]);
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'OLTs & PON Ports'), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => oltForm(null) }, '+ New OLT')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'OLT', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        { key: 'vendor', label: 'Vendor' },
        { key: 'model', label: 'Model' },
        { key: 'driver_status', label: 'Driver', render: (r) => UI.statusBadge(r.driver_status === 'connected' ? 'connected' : 'framework') },
        { key: 'pon_count', label: 'PONs' },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => ponList(r) }, 'PON Ports'),
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => oltForm(r) }, 'Edit'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete OLT "${r.name}"?`))) return;
            try { await UI.api(`/api/olts/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); renderOlts(); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Del')) },
      ],
      rows: olts,
    })));
    box.replaceChildren(card);

    function oltForm(r) {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'name', label: 'Name *' },
        { name: 'pop_id', label: 'POP', type: 'select', options: [[-1, '— select —'], ...pops.map((p) => [p.id, p.name])] },
        { name: 'vendor', label: 'Vendor', placeholder: 'e.g. Huawei / ZTE (confirm when hardware chosen)' },
        { name: 'model', label: 'Model' },
        { name: 'pon_count', label: 'PON Port Count', type: 'number', value: 8 },
        { name: 'driver_status', label: 'Driver Status', type: 'select', options: [['framework', 'Framework (pluggable — default)'], ['connected', 'Connected (hardware integrated)']] },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ], r ? r : {});
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          if (r) { await UI.api(`/api/olts/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
          else { await UI.api('/api/olts', { method: 'POST', body: f }); UI.toast('OLT created'); }
          m.close(); renderOlts();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, r ? 'Save' : 'Create');
      const m = UI.modal({ title: r ? `Edit OLT — ${r.name}` : 'New OLT', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    }

    async function ponList(olt) {
      const ports = await UI.api(`/api/olts/${olt.id}/pon-ports`);
      const body = UI.el('div');
      body.append(UI.el('div', { class: 'alert info' }, `OLT ${UI.esc(olt.name)} — add its physical PON ports. Splitters and fiber boxes attach to a PON port.`));
      const tbl = UI.el('div');
      const draw = () => tbl.replaceChildren(UI.table({
        columns: [
          { key: 'port_no', label: 'Port #' },
          { key: 'name', label: 'Name' },
          { key: 'profile', label: 'Profile' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status || 'active') },
          { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
            UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => ponForm(r) }, 'Edit'),
            UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
              if (!(await UI.confirm(`Delete PON ${r.port_no}?`))) return;
              try { await UI.api(`/api/pon-ports/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); draw(); }
              catch (e) { UI.toast(e.error || e.message, 'err'); }
            } }, 'Del')) },
        ],
        rows: ports,
        empty: 'No PON ports yet',
      }));
      draw();
      const pNo = UI.el('input', { type: 'number', placeholder: 'port #', style: 'width:90px; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
      const addBtn = UI.el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        try {
          await UI.api(`/api/olts/${olt.id}/pon-ports`, { method: 'POST', body: { port_no: pNo.value, name: `PON ${pNo.value}`, profile: 'GPON-2.5G' } });
          UI.toast('PON port added'); pNo.value = '';
          const fresh = await UI.api(`/api/olts/${olt.id}/pon-ports`);
          ports.splice(0, ports.length, ...fresh);
          draw();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, '+ Add Port');
      body.append(tbl, UI.el('div', { class: 'row mt' }, pNo, addBtn));
      UI.modal({ title: `PON Ports — ${olt.name}`, body, wide: true });
    }

    function ponForm(r) {
      const body = UI.el('div');
      UI.fields(body, [
        { name: 'port_no', label: 'Port #', type: 'number' },
        { name: 'name', label: 'Name' },
        { name: 'profile', label: 'Profile', placeholder: 'GPON-2.5G' },
        { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['faulty', 'Faulty'], ['disabled', 'Disabled']] },
      ], r);
      const inputs = r ? { port_no: body.querySelector('input[type=number]'), name: body.querySelectorAll('input[type=text]')[0], profile: body.querySelectorAll('input[type=text]')[1], status: body.querySelector('select') } : {};
      UI.modal({ title: `Edit PON ${r.port_no}`, body, footer: (ft, close) => ft.append(
        UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
        UI.el('button', { class: 'btn btn-primary', onclick: async () => {
          try { await UI.api(`/api/pon-ports/${r.id}`, { method: 'PUT', body: { port_no: inputs.port_no.value, name: inputs.name.value, profile: inputs.profile.value, status: inputs.status.value } }); UI.toast('Updated'); close(); ponList(olt); }
          catch (e) { UI.toast(e.error || e.message, 'err'); }
        } }, 'Save')) });
    }
  }

  async function renderBoxes() {
    const [boxes, areas, olts, splitters] = await Promise.all([
      UI.api('/api/fiber-boxes'),
      UI.api('/api/areas').catch(() => []),
      UI.api('/api/olts').catch(() => []),
      UI.api('/api/splitters').catch(() => []),
    ]);
    let pons = [];
    for (const o of olts) {
      const pp = await UI.api(`/api/olts/${o.id}/pon-ports`).catch(() => []);
      pons.push(...pp.map((x) => ({ ...x, _olt: o.name })));
    }
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Fiber Boxes'), UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => boxForm(null) }, '+ New Box')));
    card.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'name', label: 'Box', render: (r) => `<b>${UI.esc(r.name)}</b>` },
        { key: 'capacity', label: 'Capacity' },
        { key: 'pon', label: 'Attached To', render: (r) => {
          const pon = pons.find((p) => p.id === r.pon_port_id);
          const sp = splitters.find((s) => s.id === r.splitter_id);
          return [sp ? `via ${sp.name}` : '', pon ? `${pon._olt} PON ${pon.port_no}` : ''].filter(Boolean).join(' → ') || '—';
        } },
        { key: 'lat', label: 'Location', render: (r) => r.lat ? `${r.lat}, ${r.lng}` : '—' },
        { key: 'act', label: '', render: (r) => UI.el('span', { class: 'row' },
          UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: () => boxPorts(r) }, 'Ports'),
          UI.el('button', { class: 'btn btn-outline btn-xs', onclick: () => boxForm(r) }, 'Edit'),
          UI.el('button', { class: 'btn btn-danger btn-xs', onclick: async () => {
            if (!(await UI.confirm(`Delete box "${r.name}"?`))) return;
            try { await UI.api(`/api/fiber-boxes/${r.id}`, { method: 'DELETE' }); UI.toast('Deleted'); renderBoxes(); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Del')) },
      ],
      rows: boxes,
      empty: 'No fiber boxes yet',
    })));
    box.replaceChildren(card);

    function boxForm(r) {
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'name', label: 'Name *', placeholder: 'e.g. BX-JOH-01' },
        { name: 'area_id', label: 'Area', type: 'select', options: [[-1, '— select —'], ...areas.map((a) => [a.id, a.name])] },
        { name: 'pon_port_id', label: 'Direct PON Port (or use splitter)', type: 'select', options: [[-1, '— none —'], ...pons.map((p) => [p.id, `${p._olt} PON ${p.port_no}`])] },
        { name: 'splitter_id', label: 'Splitter (alternative attachment)', type: 'select', options: [[-1, '— none —'], ...splitters.map((s) => [s.id, s.name])] },
        { name: 'capacity', label: 'Capacity (ports)', type: 'number', value: 8 },
        { name: 'lat', label: 'Latitude', type: 'number' },
        { name: 'lng', label: 'Longitude', type: 'number' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ], r ? r : {});
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        try {
          if (r) { await UI.api(`/api/fiber-boxes/${r.id}`, { method: 'PUT', body: f }); UI.toast('Updated'); }
          else { await UI.api('/api/fiber-boxes', { method: 'POST', body: f }); UI.toast('Box created'); }
          m.close(); renderBoxes();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, r ? 'Save' : 'Create');
      const m = UI.modal({ title: r ? `Edit Box — ${r.name}` : 'New Fiber Box', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    }

    async function boxPorts(b) {
      const ports = await UI.api(`/api/fiber-boxes/${b.id}/ports`);
      const body = UI.el('div');
      body.append(UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'port_no', label: 'Port #' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
          { key: 'customer', label: 'Customer', render: (r) => r.customer ? `<b>${UI.esc(r.customer.name)}</b> (${UI.esc(r.customer.customer_code)})` : '<span class="muted">free</span>' },
          { key: 'act', label: '', render: (r) => UI.el('button', { class: 'btn btn-outline btn-xs', onclick: async () => {
            const st = prompt('New status (free / occupied / faulty):', r.status);
            if (!st) return;
            try { await UI.api(`/api/box-ports/${r.id}`, { method: 'PUT', body: { status: st } }); UI.toast('Updated'); boxPorts(b); }
            catch (e) { UI.toast(e.error || e.message, 'err'); }
          } }, 'Set') },
        ],
        rows: ports,
        empty: 'No ports — add below',
      })));
      const pNo = UI.el('input', { type: 'number', placeholder: 'port #', style: 'width:90px; border:1.5px solid var(--line-2); border-radius:8px; padding:7px 9px;' });
      body.append(UI.el('div', { class: 'row mt' }, pNo,
        UI.el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
          try { await UI.api(`/api/fiber-boxes/${b.id}/ports`, { method: 'POST', body: { port_no: pNo.value } }); UI.toast('Port added'); boxPorts(b); }
          catch (e) { UI.toast(e.error || e.message, 'err'); }
        } }, '+ Add Port')));
      UI.modal({ title: `Ports — ${b.name}`, body, wide: true });
    }
  }

  async function renderFaults() {
    const [boxes, olts] = await Promise.all([UI.api('/api/fiber-boxes').catch(() => []), UI.api('/api/olts').catch(() => [])]);
    const body = UI.el('div');
    const card = UI.el('div', { class: 'card' },
      UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Fault Tracing'), UI.el('span', { class: 'muted small' }, 'Select a fiber box or PON port to list affected customers')));
    const selBox = UI.el('select'), selPon = UI.el('select');
    selBox.append(UI.el('option', { value: '' }, '— select box —'));
    boxes.forEach((b) => selBox.append(UI.el('option', { value: b.id }, b.name)));
    selPon.append(UI.el('option', { value: '' }, '— select PON port —'));
    for (const o of olts) {
      const pp = await UI.api(`/api/olts/${o.id}/pon-ports`).catch(() => []);
      pp.forEach((p) => selPon.append(UI.el('option', { value: p.id }, `${o.name} PON ${p.port_no}`)));
    }
    const out = UI.el('div', { class: 'mt' });
    const trace = async () => {
      out.replaceChildren(UI.el('div', { class: 'muted' }, 'Tracing…'));
      try {
        const r = selBox.value ? await UI.api(`/api/network/faults?box_id=${selBox.value}`) : await UI.api(`/api/network/faults?pon_port_id=${selPon.value}`);
        const rows = r.customers || [];
        out.replaceChildren(
          UI.el('div', { class: 'alert ' + (rows.length ? 'warn' : 'ok') }, `${rows.length} customer(s) affected`),
          UI.el('div', { class: 'tbl-wrap' }, UI.table({
            columns: [
              { key: 'customer_code', label: 'Code' },
              { key: 'name', label: 'Customer' },
              { key: 'phone', label: 'Phone' },
              { key: 'status', label: 'Status', render: (x) => UI.statusBadge(x.status) },
              { key: 'act', label: '', render: (x) => UI.el('a', { class: 'btn btn-ok btn-xs', target: '_blank', href: `https://wa.me/92${String(x.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '')}?text=${encodeURIComponent(`Dear ${x.name}, Rana Internet: we are aware of a network issue affecting your area and are working on it. Shukriya for patience.`)}` }, 'Notify via WhatsApp') },
            ],
            rows,
            empty: 'No customers affected',
          })));
      } catch (e) { out.replaceChildren(UI.el('div', { class: 'alert err' }, e.error || e.message)); }
    };
    card.append(UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'row' }, selBox, selPon, UI.el('button', { class: 'btn btn-primary btn-sm', onclick: trace }, 'Trace Impact'), UI.el('button', { class: 'btn btn-warn btn-sm', onclick: async () => {
      if (!(await UI.confirm('Notify all affected customers via saved templates? (Template engine logs only — no external gateway claimed)'))) return;
      try {
        const r = await UI.api('/api/network/notify-affected', { method: 'POST', body: selBox.value ? { box_id: Number(selBox.value) } : { pon_port_id: Number(selPon.value) } });
        UI.toast((r.notified !== undefined ? `${r.notified} notification(s) logged` : 'Done') + ' — check notification logs');
      } catch (e) { UI.toast(e.error || e.message, 'err'); }
    } }, 'Notify All (log)')), out));
    box.replaceChildren(card);
  }
  return root;
};

/* ================= LIVE MAP ================= */
V.map = async function () {
  const root = UI.el('div');
  const mpRefs = {};
  const mkMpl = (key, id, label) => { const i = UI.el('input', { type: 'checkbox', id, checked: '' }); i.checked = true; mpRefs[key] = i; return UI.el('label', { class: 'small' }, i, label); };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Network Map'), UI.el('div', { class: 'sub' }, 'Live map of customers, POPs, boxes and OLTs (Leaflet + OpenStreetMap)')),
    UI.el('div', { class: 'page-actions' },
      mkMpl('cust', 'mpCust', ' Customers'),
      mkMpl('pops', 'mpPops', ' POPs'),
      mkMpl('boxes', 'mpBoxes', ' Boxes'),
      mkMpl('olts', 'mpOlts', ' OLTs'),
      mkMpl('splt', 'mpSplt', ' Splitters'),
      UI.el('button', { class: 'btn btn-primary btn-sm', onclick: () => loadMap(true) }, 'Refresh'))));
  const statusSel = UI.el('select', { style: 'border:1.5px solid var(--line-2); border-radius:8px; padding:8px;' });
  statusSel.append(UI.el('option', { value: '' }, 'All statuses'));
  ['active', 'suspended', 'disconnected', 'pending'].forEach((s) => statusSel.append(UI.el('option', { value: s }, s)));
  statusSel.addEventListener('change', () => loadMap(true));
  root.append(statusSel);

  const mapEl = UI.el('div', { id: 'map' });
  root.append(mapEl);
  window.addEventListener('beforeunload', () => { if (window.__ranaMap) { try { window.__ranaMap.remove(); } catch { /* */ } } });

  const colors = { customer: '#1d4ed8', pop: '#dc2626', box: '#d97706', olt: '#7c3aed', splitter: '#06b6d4' };
  async function loadMap(keep = false) {
    const types = [
      mpRefs.cust.checked && 'customers',
      mpRefs.pops.checked && 'pops',
      mpRefs.boxes.checked && 'boxes',
      mpRefs.olts.checked && 'olts',
      mpRefs.splt.checked && 'splitters',
    ].filter(Boolean).join(',');
    const qs = new URLSearchParams({ types });
    const st = statusSel.value;
    if (st) qs.set('status', st);
    const pts = await UI.api(`/api/map/points?${qs}`);
    if (window.__ranaMap) { try { window.__ranaMap.remove(); } catch { /* */ } window.__ranaMap = null; }
    const L = window.L;
    if (!L) { mapEl.innerHTML = '<div style="padding:20px">Leaflet failed to load (offline?).</div>'; return; }
    const map = L.map(mapEl).setView([31.52, 74.35], 12);
    window.__ranaMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    pts.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      L.marker([p.lat, p.lng]).addTo(map)
        .bindPopup(`<b>${p.type}</b><br>${p.name || p.customer_code || ''}<br><small>${p.status ? p.status : (p.customer_code || '')}</small>`);
    });
  }
  await loadMap();
  return root;
};

/* ================= INSTALLATIONS ================= */
V.installations = async function () {
  const root = UI.el('div');
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Installations'), UI.el('div', { class: 'sub' }, 'Scheduled jobs → completion with materials issue, ONU mapping and double-assignment protection'))));
  const box = UI.el('div', { class: 'card' });
  root.append(box);
  const render = async () => {
    const rows = await UI.api('/api/installations');
    box.replaceChildren(UI.el('div', { class: 'tbl-wrap' }, UI.table({
      columns: [
        { key: 'id', label: '#' },
        { key: 'customer_name', label: 'Customer', render: (r) => `<b>${UI.esc(r.customer_name)}</b> <span class="muted small">${UI.esc(r.customer_code || '')}</span>` },
        { key: 'staff_name', label: 'Technician' },
        { key: 'scheduled_at', label: 'Scheduled' },
        { key: 'completed_at', label: 'Completed' },
        { key: 'cable_meters', label: 'Cable (m)', cls: 'num' },
        { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
        { key: 'act', label: '', render: (r) => actRow(r) },
      ],
      rows,
      empty: 'No installations',
    })));
  };

  function actRow(r) {
    const w = UI.el('span', { class: 'row' });
    if (['scheduled', 'in_progress'].includes(r.status)) {
      const to = r.status === 'scheduled' ? 'in_progress' : 'completed';
      w.append(UI.el('button', { class: 'btn btn-cyan btn-xs', onclick: async () => {
        if (to === 'completed') return completeModal(r);
        try { await UI.api(`/api/installations/${r.id}/status`, { method: 'POST', body: { status: 'in_progress' } }); UI.toast('Marked in progress'); render(); }
        catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, to === 'completed' ? 'Complete' : 'Start'));
    }
    return w;
  }

  function completeModal(r) {
    Promise.all([UI.api('/api/inventory/items').catch(() => []), UI.api('/api/customers').catch(() => ({}))]).then(([items, custPage]) => {
      const custs = custPage.rows || [];
      const body = UI.el('div');
      body.append(UI.el('div', { class: 'alert info' }, 'Completing issues stock for materials, maps the ONU/box port (prevents double assignment) and sets the PPPoE username. A "not feasible" application requires an override reason.'));
      UI.fields(body, [
        { name: 'cable_meters', label: 'Cable Meters Used', type: 'number', value: 0 },
        { name: 'box_id', label: 'Fiber Box', type: 'select', options: [[-1, '— select —']] },
        { name: 'box_port_no', label: 'Box Port #', type: 'number' },
        { name: 'onu_serial', label: 'ONU Serial' },
        { name: 'onu_mac', label: 'ONU MAC' },
        { name: 'pppoe_username', label: 'PPPoE Username', placeholder: 'auto if blank' },
        { name: 'override_reason', label: 'Override Reason (only if survey was NOT feasible)', type: 'textarea' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]);
      // load boxes
      UI.api('/api/fiber-boxes').catch(() => []).then((boxes) => {
        const sel = body.querySelector('select');
        boxes.forEach((b) => sel.append(UI.el('option', { value: b.id }, b.name)));
      });
      const materials = UI.el('div', { class: 'mt' });
      materials.append(UI.el('b', { class: 'small' }, 'Materials to issue (stock will be decremented):'));
      const mRows = [];
      items.slice(0, 6).forEach((it) => {
        const qty = UI.el('input', { type: 'number', min: 0, style: 'width:80px; border:1.5px solid var(--line-2); border-radius:8px; padding:6px 8px; text-align:right;', placeholder: `${it.stock} in stock` });
        mRows.push({ item: it, qty });
        materials.append(UI.el('div', { class: 'row', style: 'margin:6px 0;' }, UI.el('span', {}, `${it.name} <span class="muted small">(${it.unit})</span>`), qty));
      });
      body.append(materials);
      const fEls = body.querySelectorAll('input, textarea');
      UI.modal({ title: `Complete Installation — ${r.customer_name}`, body, wide: true, footer: (ft, close) => ft.append(
        UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'),
        UI.el('button', { class: 'btn btn-ok', onclick: async () => {
          const g = (i) => fEls[i].value;
          const payload = {
            cable_meters: g(0),
            box_id: g(1),
            box_port_no: g(2),
            onu_serial: g(3),
            onu_mac: g(4),
            pppoe_username: g(5),
            override_reason: g(6),
            notes: g(7),
            materials: mRows.filter((m) => Number(m.qty.value) > 0).map((m) => ({ item_id: m.item.id, qty: m.qty.value })),
          };
          try {
            const res = await UI.api(`/api/installations/${r.id}/complete`, { method: 'POST', body: payload });
            UI.toast('Installation completed'); close(); render();
          } catch (e) { UI.toast(e.error || e.message, 'err'); }
        } }, 'Complete Installation')) });
    });
  }
  await render();
  return root;
};

/* ================= TICKETS ================= */
V.tickets = async function () {
  const root = UI.el('div');
  const state = { page: '1', status: '', category: '' };
  root.append(UI.el('div', { class: 'page-hd' },
    UI.el('div', {}, UI.el('h1', {}, 'Tickets / Complaints'), UI.el('div', { class: 'sub' }, 'Category, priority, assignment and status history per ticket')),
    UI.el('div', { class: 'page-actions' }, UI.el('button', { class: 'btn btn-primary', onclick: () => newTicket() }, '+ New Ticket'))));

  const filters = UI.el('div', { class: 'card mb' }, UI.el('div', { class: 'card-bd' }, UI.el('div', { class: 'filters' })));
  const fRow = filters.querySelector('.filters');
  fRow.append(UI.el('select', { onchange: (e) => { state.status = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All statuses'], ['open', 'Open'], ['in_progress', 'In Progress'], ['resolved', 'Resolved'], ['closed', 'Closed']].map(([v, l]) => UI.el('option', { value: v }, l))));
  fRow.append(UI.el('select', { onchange: (e) => { state.category = e.target.value; state.page = '1'; render(); } },
    ...[['', 'All categories'], ['no_internet', 'No Internet'], ['slow_speed', 'Slow Speed'], ['onu_issue', 'ONU'], ['fiber_damage', 'Fiber Damage'], ['router_issue', 'Router'], ['billing', 'Billing'], ['shifting', 'Shifting'], ['other', 'Other']].map(([v, l]) => UI.el('option', { value: v }, l))));
  root.append(filters);

  const box = UI.el('div', { class: 'card' });
  root.append(box);
  async function render() {
    const qs = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const d = await UI.api(`/api/tickets?${qs}`);
    box.replaceChildren(
      UI.el('div', { class: 'tbl-wrap' }, UI.table({
        columns: [
          { key: 'ticket_no', label: 'Ticket' },
          { key: 'customer_name', label: 'Customer', render: (r) => `${UI.esc(r.customer_name || '—')} <span class="muted small">${UI.esc(r.phone || '')}</span>` },
          { key: 'category', label: 'Category' },
          { key: 'priority', label: 'Priority', render: (r) => UI.statusBadge(r.priority) },
          { key: 'summary', label: 'Summary' },
          { key: 'assigned_name', label: 'Assigned' },
          { key: 'status', label: 'Status', render: (r) => UI.statusBadge(r.status) },
          { key: 'created_at', label: 'Created', render: (r) => UI.date(r.created_at) },
        ],
        rows: d.rows,
        onRow: (r) => ticketDetail(r.id),
      })),
      UI.pager(d.page, d.pages, (pg) => { state.page = String(pg); render(); }));
  }

  function newTicket() {
    (async () => {
      let page = 1;
      const custs = [];
      for (;;) {
        const d = await UI.api(`/api/customers?page=${page}`).catch(() => null);
        if (!d) break;
        custs.push(...d.rows);
        if (page >= d.pages) break;
        page++;
      }
      const staff = await UI.api('/api/staff').catch(() => []);
      const body = UI.el('div');
      const inputs = UI.fields(body, [
        { name: 'customer_id', label: 'Customer', type: 'select', options: [[-1, '— walk-in / no customer —'], ...custs.map((c) => [c.id, `${c.customer_code} — ${c.name}`])] },
        { name: 'category', label: 'Category', type: 'select', options: [['no_internet', 'No Internet'], ['slow_speed', 'Slow Speed'], ['onu_issue', 'ONU Issue'], ['fiber_damage', 'Fiber Damage'], ['router_issue', 'Router Issue'], ['billing', 'Billing'], ['shifting', 'Shifting'], ['other', 'Other']] },
        { name: 'priority', label: 'Priority', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
        { name: 'summary', label: 'Summary *' },
        { name: 'details', label: 'Details', type: 'textarea' },
        { name: 'assigned_to', label: 'Assign To', type: 'select', options: [[-1, '— unassigned —'], ...staff.map((s) => [s.id, s.name])] },
      ]);
      const btn = UI.el('button', { class: 'btn btn-primary', onclick: async () => {
        const f = UI.readFields(inputs);
        if (!f.summary.trim()) return UI.toast('Summary required', 'err');
        try {
          const r = await UI.api('/api/tickets', { method: 'POST', body: { ...f, customer_id: f.customer_id === '-1' ? null : Number(f.customer_id), assigned_to: f.assigned_to === '-1' ? null : Number(f.assigned_to) } });
          UI.toast(`Ticket ${r.no} created`); m.close(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Create Ticket');
      const m = UI.modal({ title: 'New Ticket', body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Cancel'), btn) });
    })();
  }

  async function ticketDetail(id) {
    const d = await UI.api(`/api/tickets`);
    const t = d.rows.find((x) => x.id === id);
    if (!t) return;
    const staff = await UI.api('/api/staff').catch(() => []);
    const body = UI.el('div');
    body.append(UI.el('div', { class: 'kv' },
      UI.el('div', { class: 'k' }, 'Ticket'), UI.el('div', {}, `${t.ticket_no} — ${UI.statusBadge(t.status)}`),
      UI.el('div', { class: 'k' }, 'Customer'), UI.el('div', {}, `${t.customer_name || '—'} (${t.phone || '—'})`),
      UI.el('div', { class: 'k' }, 'Category'), UI.el('div', {}, `${t.category} • ${UI.statusBadge(t.priority)}`),
      UI.el('div', { class: 'k' }, 'Summary'), UI.el('div', {}, UI.esc(t.summary)),
      UI.el('div', { class: 'k' }, 'Details'), UI.el('div', {}, UI.esc(t.details || '—')),
      UI.el('div', { class: 'k' }, 'Created'), UI.el('div', {}, UI.dt(t.created_at)),
      UI.el('div', { class: 'k' }, 'Resolved'), UI.el('div', {}, t.resolved_at ? UI.dt(t.resolved_at) : '—')));
    const upd = UI.el('div', { class: 'mt' });
    const note = UI.el('textarea', { rows: 2, style: 'width:100%; border:1.5px solid var(--line-2); border-radius:9px; padding:9px;' , placeholder: 'Update note…' });
    const stSel = UI.el('select', { style: 'border:1.5px solid var(--line-2); border-radius:9px; padding:8px;' });
    ['open', 'in_progress', 'resolved', 'closed'].forEach((s) => stSel.append(UI.el('option', { value: s, selected: s === t.status ? '' : null }, s)));
    const asgSel = UI.el('select', { style: 'border:1.5px solid var(--line-2); border-radius:9px; padding:8px;' });
    asgSel.append(UI.el('option', { value: '' }, '— unassigned —'));
    staff.forEach((s) => asgSel.append(UI.el('option', { value: s.id, selected: t.assigned_to === s.id ? '' : null }, s.name)));
    upd.append(note, UI.el('div', { class: 'row mt' }, stSel, asgSel,
      UI.el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        try {
          await UI.api(`/api/tickets/${t.id}`, { method: 'PUT', body: { status: stSel.value, note: note.value || undefined, assigned_to: asgSel.value || null } });
          UI.toast('Ticket updated'); close2(); render();
        } catch (e) { UI.toast(e.error || e.message, 'err'); }
      } }, 'Save Update')));
    body.append(upd);
    const mm = UI.modal({ title: t.ticket_no, body, wide: true, footer: (ft, close) => ft.append(UI.el('button', { class: 'btn btn-outline', onclick: () => close() }, 'Close')) });
    function close2() { mm.close(); }
  }
  await render();
  return root;
};
