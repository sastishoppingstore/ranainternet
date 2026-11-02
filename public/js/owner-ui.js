/* Rana Internet — Owner Panel UI toolkit */
'use strict';

const UI = {
  csrf: null,
  user: null,

  /* ---------------- API ---------------- */
  async api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (UI.csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((opts.method || 'GET').toUpperCase())) {
      headers['X-CSRF-Token'] = UI.csrf;
    }
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : (opts.rawBody || undefined),
    });
    if (res.status === 401 && !path.includes('/login')) {
      location.reload();
      throw { error: 'Session expired' };
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data ? data : { error: `HTTP ${res.status}` };
      throw err;
    }
    return data;
  },

  /* ---------------- DOM helpers ---------------- */
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  },
  el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  },

  /* ---------------- formatting ---------------- */
  money(paise, cur = 'PKR') {
    const n = (paise || 0) / 100;
    return `${cur} ${n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  },
  date(s) { return s ? String(s).slice(0, 10) : '—'; },
  dt(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : '—'; },

  statusBadge(status) {
    const map = {
      active: ['green', 'Active'], application: ['yellow', 'Application'], pending: ['blue', 'Pending'],
      suspended: ['red', 'Suspended'], disconnected: ['gray', 'Disconnected'], terminated: ['gray', 'Terminated'],
      paid: ['green', 'Paid'], unpaid: ['red', 'Unpaid'], partial: ['yellow', 'Partial'], draft: ['gray', 'Draft'], void: ['gray', 'Void'],
      approved: ['green', 'Approved'], rejected: ['red', 'Rejected'], refunded: ['purple', 'Refunded'], reversed: ['gray', 'Reversed'],
      queued: ['yellow', 'Queued'], running: ['blue', 'Running'], success: ['green', 'Success'], failed: ['red', 'Failed'],
      pending_sync: ['purple', 'Pending Sync'], cancelled: ['gray', 'Cancelled'],
      open: ['red', 'Open'], in_progress: ['blue', 'In Progress'], resolved: ['green', 'Resolved'], closed: ['gray', 'Closed'],
      new: ['yellow', 'New'], surveyed: ['blue', 'Surveyed'], in_installation: ['purple', 'In Installation'],
      completed: ['green', 'Completed'], activated: ['green', 'Activated'],
      scheduled: ['yellow', 'Scheduled'], faulty: ['red', 'Faulty'], free: ['green', 'Free'], occupied: ['blue', 'Occupied'],
      enabled: ['green', 'Enabled'], disabled: ['gray', 'Disabled'], error: ['red', 'Error'],
      online: ['green', 'Online'], offline: ['red', 'Offline'], unknown: ['gray', 'Unknown'],
      registered: ['blue', 'Registered'], available: ['green', 'Available'],
      feasible: ['green', 'Feasible'], not_feasible: ['red', 'Not Feasible'],
      cash: ['green', 'Cash'], bank_transfer: ['blue', 'Bank Transfer'], jazzcash: ['purple', 'JazzCash'],
      easypaisa: ['cyan', 'Easypaisa'], raast: ['blue', 'Raast QR'], other: ['gray', 'Other'],
      high: ['yellow', 'High'], medium: ['blue', 'Medium'], low: ['gray', 'Low'], urgent: ['red', 'Urgent'],
      framework: ['yellow', 'Framework'], connected: ['green', 'Connected'],
    };
    const [cls, label] = map[status] || ['gray', String(status || '—').replace('_', ' ')];
    return `<span class="badge ${cls}">${UI.esc(label)}</span>`;
  },

  toast(msg, type = 'ok', ms = 3800) {
    const zone = document.getElementById('toastZone');
    const t = UI.el('div', { class: `toast ${type}` }, msg);
    zone.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
  },

  /* ---------------- modal ---------------- */
  modal({ title, body, footer, wide = false, onClose = null }) {
    const zone = document.getElementById('modalZone');
    const back = UI.el('div', { class: 'modal-back' });
    const m = UI.el('div', { class: `modal${wide ? ' wide' : ''}` },
      UI.el('div', { class: 'm-hd' },
        UI.el('h3', {}, title),
        UI.el('button', { class: 'm-x', onclick: () => close() }, '✕')),
      UI.el('div', { class: 'm-bd' }),
      footer ? UI.el('div', { class: 'm-bd m-ft', style: 'padding-top:14px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px;' }) : null);
    const bd = m.querySelector('.m-bd');
    if (typeof body === 'string') bd.innerHTML = body;
    else if (body) bd.append(body);
    back.append(m);
    zone.append(back);
    function close() { back.remove(); if (onClose) onClose(); }
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    if (footer) footer(m.querySelector('.m-ft'), close);
    return { el: m, body: bd, close };
  },

  confirm(msg, { danger = true, okLabel = 'Confirm' } = {}) {
    return new Promise((resolve) => {
      const fd = UI.el('div', {},
        UI.el('button', { class: 'btn btn-outline', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        UI.el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { m.close(); resolve(true); } }, okLabel));
      const m = UI.modal({ title: 'Please confirm', body: UI.esc(msg), footer: (ft, close) => ft.append(fd) });
    });
  },

  /* ---------------- forms ---------------- */
  fields(container, defs, values = {}) {
    const inputs = {};
    defs.forEach((d) => {
      const wrap = UI.el('div', { class: d.class || 'field' });
      let input;
      const id = `f_${d.name}`;
      if (d.type === 'select') {
        input = UI.el('select', { id });
        (d.options || []).forEach((o) => {
          const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
          input.append(UI.el('option', { value: v }, l));
        });
      } else if (d.type === 'textarea') {
        input = UI.el('textarea', { id, rows: d.rows || 3 });
      } else if (d.type === 'checkbox') {
        input = UI.el('input', { id, type: 'checkbox' });
      } else {
        input = UI.el('input', { id, type: d.type || 'text', value: '' });
        if (d.min) input.min = d.min;
        if (d.max) input.max = d.max;
        if (d.step) input.step = d.step;
        if (d.placeholder) input.placeholder = d.placeholder;
      }
      input.value = values[d.name] ?? d.value ?? (d.type === 'checkbox' ? (values[d.name] === true || values[d.name] === 1) : input.value);
      if (d.type === 'checkbox') input.checked = values[d.name] === true || values[d.name] === 1 || d.value === true;
      wrap.append(UI.el('label', { for: id }, d.label || d.name));
      wrap.append(input);
      if (d.hint) wrap.append(UI.el('div', { class: 'hint' }, d.hint));
      inputs[d.name] = input;
      container.append(wrap);
    });
    return inputs;
  },

  readFields(inputs) {
    const out = {};
    for (const [k, i] of Object.entries(inputs)) {
      out[k] = i.type === 'checkbox' ? i.checked : i.value;
    }
    return out;
  },

  /* ---------------- table + pagination ---------------- */
  table({ columns, rows, onRow, empty = 'No records found', idKey = 'id' }) {
    const t = UI.el('table', { class: 'tbl' });
    t.append(UI.el('thead', {}, UI.el('tr', {}, columns.map((c) => UI.el('th', { class: c.cls || '' }, c.label)))));
    const tb = UI.el('tbody');
    if (!rows.length) tb.append(UI.el('tr', {}, UI.el('td', { class: 'empty', colspan: String(columns.length) }, empty)));
    for (const r of rows) {
      const tr = UI.el('tr', onRow ? { class: 'click' } : {});
      for (const c of columns) {
        const td = UI.el('td', { class: c.cls || '' });
        if (c.render) {
          const v = c.render(r);
          if (v instanceof Node) td.append(v);
          else if (v != null && v !== false) td.innerHTML = String(v);
        } else {
          td.textContent = r[c.key] ?? '—';
        }
        tr.append(td);
      }
      if (onRow) tr.addEventListener('click', () => onRow(r));
      tb.append(tr);
    }
    t.append(tb);
    const w = UI.el('div', { class: 'tbl-wrap' }, t);
    return w;
  },

  pager(page, pages, onPage) {
    if (pages <= 1) return null;
    return UI.el('div', { class: 'pager' },
      UI.el('button', { onclick: () => onPage(page - 1), disabled: page <= 1 ? '' : null }, '← Prev'),
      UI.el('span', {}, `Page ${page} of ${pages}`),
      UI.el('button', { onclick: () => onPage(page + 1), disabled: page >= pages ? '' : null }, 'Next →'));
  },

  /* ---------------- canvas charts ---------------- */
  _prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, W: rect.width, H: rect.height };
  },
  barChart(canvas, labels, values, { color = '#1d4ed8', money = true } = {}) {
    const { ctx, W, H } = UI._prep(canvas);
    const pad = { l: 52, r: 10, t: 14, b: 26 };
    const max = Math.max(...values, 1);
    const bw = (W - pad.l - pad.r) / values.length;
    ctx.font = '11px Segoe UI';
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#e3e9f2';
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (H - pad.t - pad.b) * g / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      const v = max * (1 - g / 4);
      ctx.textAlign = 'right';
      ctx.fillText(money ? (v / 100 >= 1000 ? (v / 100000).toFixed(1) + 'L' : Math.round(v / 100)) : Math.round(v), pad.l - 6, y + 3);
    }
    values.forEach((v, i) => {
      const h = (H - pad.t - pad.b) * (v / max);
      const x = pad.l + i * bw + bw * 0.18;
      const grad = ctx.createLinearGradient(0, H - pad.b - h, 0, H - pad.b);
      grad.addColorStop(0, color); grad.addColorStop(1, color + '88');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, H - pad.b - h, bw * 0.64, Math.max(h, 2), 4);
      ctx.fill();
      ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
      ctx.fillText(labels[i], pad.l + i * bw + bw / 2, H - 8);
    });
  },
  lineChart(canvas, labels, series, { money = false } = {}) {
    const { ctx, W, H } = UI._prep(canvas);
    const pad = { l: 44, r: 12, t: 14, b: 26 };
    const all = series.flatMap((s) => s.values);
    const max = Math.max(...all, 1);
    ctx.font = '11px Segoe UI';
    ctx.strokeStyle = '#e3e9f2'; ctx.fillStyle = '#64748b';
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (H - pad.t - pad.b) * g / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(money ? Math.round(max * (1 - g / 4) / 100).toLocaleString() : Math.round(max * (1 - g / 4)), pad.l - 6, y + 3);
    }
    const n = labels.length;
    series.forEach((s) => {
      ctx.strokeStyle = s.color || '#1d4ed8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (W - pad.l - pad.r) * i / (n - 1));
        const y = H - pad.b - (H - pad.t - pad.b) * (v / max);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      s.values.forEach((v, i) => {
        const x = pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (W - pad.l - pad.r) * i / (n - 1));
        const y = H - pad.b - (H - pad.t - pad.b) * (v / max);
        ctx.fillStyle = s.color || '#1d4ed8';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
    labels.forEach((l, i) => {
      const x = pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (W - pad.l - pad.r) * i / (n - 1));
      ctx.fillText(l, x, H - 8);
    });
  },
  donutChart(canvas, items) {
    const { ctx, W, H } = UI._prep(canvas);
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const cx = H / 2 + 8, cy = H / 2, R = Math.min(H / 2 - 12, 84), r = R * 0.62;
    let a = -Math.PI / 2;
    items.forEach((it) => {
      const ang = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a, a + ang);
      ctx.arc(cx, cy, r, a + ang, a, true);
      ctx.closePath();
      ctx.fillStyle = it.color;
      ctx.fill();
      a += ang;
    });
    ctx.fillStyle = '#0b1f3f'; ctx.font = '800 18px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(total, cx, cy + 2);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Segoe UI';
    ctx.fillText('total', cx, cy + 16);
    // legend
    let ly = 24;
    const lx = H + 40;
    ctx.textAlign = 'left';
    items.slice(0, 8).forEach((it) => {
      ctx.fillStyle = it.color;
      ctx.fillRect(lx, ly - 8, 10, 10);
      ctx.fillStyle = '#334155'; ctx.font = '11px Segoe UI';
      const label = it.label.length > 18 ? it.label.slice(0, 17) + '…' : it.label;
      ctx.fillText(`${label} (${it.value})`, lx + 16, ly + 1);
      ly += 19;
    });
  },
};

/* ---------------- routing ---------------- */
const Router = {
  routes: [],
  current: null,
  add(pattern, fn) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    this.routes.push({ regex, keys, fn });
  },
  go(hash) { location.hash = hash; },
  resolve() {
    const hash = (location.hash || '#/dashboard').slice(1);
    for (const r of this.routes) {
      const m = hash.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        r.fn(params);
        return;
      }
    }
    this.go('#/dashboard');
  },
};

/* ---------------- boot helpers ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-back').forEach((b) => b.remove());
});
