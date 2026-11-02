/* Owner views — Dashboard */
'use strict';
const Views = window.Views = window.Views || {};

Views.dashboard = async function () {
  const root = UI.el('div');
  root.append(
    UI.el('div', { class: 'page-hd' },
      UI.el('div', {}, UI.el('h1', {}, 'Dashboard'), UI.el('div', { class: 'sub' }, new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
      UI.el('div', { class: 'page-actions' },
        UI.el('button', { class: 'btn btn-primary', onclick: () => UI.Router.go('#/invoices') }, '⚡ Generate Due Invoices'),
        UI.el('button', { class: 'btn btn-outline', onclick: () => UI.Router.go('#/payments') }, 'Record Payment'))));

  const box = UI.el('div');
  root.append(box);
  let d;
  try { d = await UI.api('/api/dashboard'); }
  catch (e) { box.append(UI.el('div', { class: 'alert err' }, 'Failed to load dashboard: ' + (e.error || e.message))); return root; }

  const t = d.totals, f = d.finance, c = d.counts;
  const kpis = UI.el('div', { class: 'kpi-grid' });
  const kpi = (lbl, val, sub, cls = '', ic = '📊') => kpis.append(UI.el('div', { class: `kpi ${cls}` },
    UI.el('div', { class: 'lbl' }, lbl), UI.el('div', { class: 'val' }, val), sub ? UI.el('div', { class: 'sub' }, sub) : null, UI.el('div', { class: 'ic' }, ic)));
  kpi('Total Customers', String(t.total), `${t.active} active • ${t.application + t.pending} in pipeline`, 'accent', '👥');
  kpi("Today's Collections", UI.money(f.todayCollections), `${UI.money(f.monthCollections)} this month`, 'good', '💰');
  kpi('Outstanding', UI.money(f.outstanding), `${c.overdue} invoice(s) overdue`, c.overdue ? 'bad' : '', '⏳');
  kpi('Pending Payments', String(c.pendingPayments), 'awaiting approval', c.pendingPayments ? 'warn' : '', '🧾');
  kpi('New Applications', String(c.newApps), 'awaiting survey', c.newApps ? 'warn' : '', '📝');
  kpi('Open Tickets', String(c.openTickets), 'customer support', c.openTickets ? 'warn' : '', '🎫');
  root.append(kpis);

  if (d.alerts && d.alerts.length) {
    const ab = UI.el('div', { class: 'mb' });
    d.alerts.slice(0, 6).forEach((a) => ab.append(UI.el('div', { class: 'alert ' + (a.type === 'overdue' ? 'err' : 'info') }, '⚠️ ' + a.text)));
    root.append(ab);
  }

  const charts = UI.el('div', { class: 'charts-2 mb' });
  charts.append(UI.el('div', { class: 'card' },
    UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Collections — Last 6 Months')),
    UI.el('div', { class: 'card-bd' }, UI.el('canvas', { class: 'chart', id: 'chCol' }))));
  charts.append(UI.el('div', { class: 'card' },
    UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Customer Growth')),
    UI.el('div', { class: 'card-bd' }, UI.el('canvas', { class: 'chart', id: 'chGrow' }))));
  root.append(charts);

  const lower = UI.el('div', { class: 'charts-2' });
  lower.append(UI.el('div', { class: 'card' },
    UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Customers by Package')),
    UI.el('div', { class: 'card-bd' }, UI.el('canvas', { class: 'chart', id: 'chPkg' }))));

  // devices overview
  const devCard = UI.el('div', { class: 'card' });
  const dv = d.devices;
  const devBody = UI.el('div', { class: 'card-bd' });
  devBody.append(UI.el('div', { class: 'alert ' + (dv.demoMode ? 'warn' : 'ok') },
    dv.demoMode ? '🔌 Device integration: MOCK mode — simulated responses only. Configure real devices in Settings → Devices.' : '🔌 Device integration: LIVE'));
  devBody.append(UI.el('div', { class: 'kv' },
    UI.el('div', { class: 'k' }, 'Devices'), UI.el('div', {}, (dv.devices || []).map((x) => `${x.name} — ${x.status}${x.safe_mode ? ' (safe)' : ''}`).join(', ') || 'none'),
    UI.el('div', { class: 'k' }, 'Online Sessions'), UI.el('div', {}, String(dv.onlineSessions ?? 0) + (dv.bandwidth && dv.bandwidth.simulated ? ' (simulated)' : '')),
    UI.el('div', { class: 'k' }, 'ONUs'), UI.el('div', {}, `${dv.onus.online}/${dv.onus.total} online`),
    UI.el('div', { class: 'k' }, 'Polling'), UI.el('div', {}, dv.pollEnabled ? 'enabled' : 'disabled')));
  devBody.append(UI.el('div', { class: 'mt row' }, UI.el('a', { class: 'btn btn-outline btn-sm', href: '#/devices' }, 'Manage Devices')));
  devCard.append(UI.el('div', { class: 'card-hd' }, UI.el('h3', {}, 'Network Devices')), devBody);
  lower.append(devCard);
  root.append(lower);

  requestAnimationFrame(() => {
    const c1 = document.getElementById('chCol');
    if (c1) UI.barChart(c1, d.charts.collections.map((x) => x.month.slice(2)), d.charts.collections.map((x) => x.amount), { money: true });
    const c2 = document.getElementById('chGrow');
    if (c2) UI.lineChart(c2, d.charts.growth.map((x) => x.month.slice(2)), [{ values: d.charts.growth.map((x) => x.customers), color: '#06b6d4' }]);
    const c3 = document.getElementById('chPkg');
    const palette = ['#1d4ed8', '#06b6d4', '#7c3aed', '#16a34a', '#d97706', '#dc2626'];
    if (c3) UI.donutChart(c3, d.charts.pkgDist.map((x, i) => ({ label: x.name, value: x.c, color: palette[i % palette.length] })));
  });
  return root;
};
