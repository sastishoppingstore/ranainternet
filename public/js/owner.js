/* Rana Internet — Owner Panel boot */
'use strict';

/* ---------------- login flow ---------------- */
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');

async function boot() {
  let me = null;
  try { me = await UI.api('/api/me'); } catch { /* not logged in */ }
  if (!me || !me.user) { showLogin(); return; }
  UI.csrf = me.csrf || UI.csrf;
  showApp(me);
}

function showLogin() {
  loginView.style.display = 'flex';
  appView.style.display = 'none';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginErrors');
  errBox.style.display = 'none';
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await UI.api('/api/login', { method: 'POST', body: { email, password, code: document.getElementById('login2fa').value || undefined } });
    UI.csrf = r.csrf;
    UI.user = r.user;
    await showApp({ user: r.user });
  } catch (e) {
    if (e && e.two_factor) {
      document.getElementById('login2faField').style.display = 'block';
      errBox.innerHTML = `<div class="alert warn">2FA required — enter your authenticator code.</div>`;
    } else {
      errBox.innerHTML = `<div class="alert err">${UI.esc(e.error || 'Login failed')}</div>`;
    }
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
['loginEmail', 'loginPassword', 'login2fa'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
});

/* ---------------- app shell ---------------- */
const NAV = [
  { group: 'Overview', items: [
    ['dashboard', '📊 Dashboard', '#/dashboard'],
    ['search', '🔍 Quick Search', '#/search'],
  ]},
  { group: 'Customers', items: [
    ['applications', '📝 Applications', '#/applications/open'],
    ['customers', '👥 Customers', '#/customers'],
    ['packages', '📦 Packages', '#/packages'],
  ]},
  { group: 'Billing', items: [
    ['invoices', '🧾 Invoices', '#/invoices'],
    ['payments', '💰 Payments', '#/payments'],
    ['recovery', '⏰ Recovery', '#/recovery'],
    ['ledger', '📒 Ledger', '#/ledger'],
  ]},
  { group: 'Network', items: [
    ['network', '🌐 Network', '#/network/tree'],
    ['map', '🗺 Live Map', '#/map'],
    ['installations', '🛠 Installations', '#/installations'],
    ['tickets', '🎫 Tickets', '#/tickets'],
  ]},
  { group: 'Operations', items: [
    ['inventory', '📦 Inventory', '#/inventory'],
    ['staff', '🧑‍🔧 Staff', '#/staff'],
    ['devices', '🔌 Devices', '#/devices'],
  ]},
  { group: 'Finance', items: [
    ['accounts', '🏦 Accounts & Cash', '#/accounts'],
    ['journal', '📖 Journal', '#/journal'],
    ['finance', '📈 Statements (TB/P&L)', '#/finance'],
    ['providers', '🌐 Upstream Provider', '#/providers'],
    ['reports', '📄 Reports', '#/reports'],
    ['audit', '🕵 Audit Log', '#/audit'],
  ]},
  { group: 'System', items: [
    ['settings', '⚙️ Settings', '#/settings'],
  ]},
];

function buildNav() {
  const nav = document.getElementById('sideNav');
  nav.innerHTML = '';
  NAV.forEach((g) => {
    const wrap = UI.el('div', { class: 'nav-group' }, UI.el('button', {}, g.group.toUpperCase()));
    g.items.forEach(([key, label, hash]) => {
      const b = UI.el('button', {
        class: 'nav-item' + (location.hash.startsWith(hash.split('/').slice(0, 2).join('/')) ? '' : ''),
        onclick: () => { UI.Router.go(hash); closeMobileNav(); },
        html: label,
      });
      b.dataset.hash = hash;
      wrap.append(b);
    });
    nav.append(wrap);
  });
}

function highlightNav() {
  const hash = location.hash || '#/dashboard';
  document.querySelectorAll('.nav-item').forEach((b) => {
    const h = b.dataset.hash;
    const base = h.split('/').slice(0, 2).join('/');
    b.classList.toggle('active', hash.startsWith(base));
  });
}

async function showApp(me) {
  UI.user = (me && me.user) || UI.user;
  loginView.style.display = 'none';
  appView.style.display = 'block';
  document.getElementById('sideUser').textContent = UI.user.name;
  document.getElementById('avatar').textContent = (UI.user.name || 'O').slice(0, 1).toUpperCase();
  buildNav();
  registerRoutes();
  window.addEventListener('hashchange', onHash);
  onHash();
  // demo data banner
  try {
    const s = await UI.api('/api/settings');
    if (s.system && s.system.demo_data) document.getElementById('demoBanner').style.display = 'block';
  } catch { /* ignore */ }
  // global search
  const gs = document.getElementById('globalSearch');
  const drop = document.getElementById('searchDrop');
  let t = null;
  gs.addEventListener('input', () => {
    clearTimeout(t);
    const q = gs.value.trim();
    if (q.length < 2) { drop.style.display = 'none'; return; }
    t = setTimeout(async () => {
      try {
        const r = await UI.api(`/api/search?q=${encodeURIComponent(q)}`);
        const results = r.results || {};
        let html = '';
        const sec = (title, items, render) => {
          if (!items || !items.length) return;
          html += `<div class="hd">${title}</div>`;
          items.forEach((x) => { html += `<div class="it" data-href="${render(x).href}"><b>${render(x).t}</b> <small>${render(x).s || ''}</small></div>`; });
        };
        sec('Customers', results.customers, (x) => ({ href: `#/customers/${x.id}`, t: `${x.name}`, s: `${x.customer_code} • ${x.phone || ''} • ${x.status}` }));
        sec('Invoices', results.invoices, (x) => ({ href: `#/invoices/${x.id}`, t: x.invoice_no, s: `${x.customer_name || ''} • ${UI.money(x.balance)} due • ${x.status}` }));
        sec('Tickets', results.tickets, (x) => ({ href: `#/tickets`, t: x.ticket_no, s: x.summary || '' }));
        sec('ONUs', results.onus, (x) => ({ href: `#/network/onus`, t: x.serial || x.mac, s: x.model || '' }));
        if (!html) html = '<div class="hd">No matches</div>';
        drop.innerHTML = html;
        drop.style.display = 'block';
        drop.querySelectorAll('.it').forEach((el) => el.addEventListener('click', () => {
          UI.Router.go(el.dataset.href);
          drop.style.display = 'none';
          gs.value = '';
        }));
      } catch { /* ignore */ }
    }, 300);
  });
  gs.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 250));

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await UI.api('/api/logout', { method: 'POST', body: {} }); } catch { /* */ }
    location.reload();
  });
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
}

function closeMobileNav() { document.getElementById('sidebar').classList.remove('open'); }

/* ---------------- routes ---------------- */
let routesRegistered = false;
function registerRoutes() {
  if (routesRegistered) return;
  routesRegistered = true;
  const r = Router;
  r.add('/dashboard', () => V.dashboard());
  r.add('/search', () => { document.getElementById('globalSearch').focus(); });
  r.add('/applications', () => V.applications({}));
  r.add('/applications/:id', async (p) => {
    const id = Number(p.id);
    if (Number.isInteger(id)) return V.applicationDetail({ id });
    return V.applications({ status: p.id });
  });
  r.add('/customers', () => V.customers());
  r.add('/customers/:id', () => V.customerDetail({ id: p4() }));
  r.add('/packages', () => V.packages());
  r.add('/invoices', () => V.invoices());
  r.add('/invoices/:id', () => V.invoiceDetail({ id: Number(p4()) }));
  r.add('/payments', () => V.payments());
  r.add('/recovery', () => V.recovery());
  r.add('/ledger', () => V.ledger());
  r.add('/network', () => V.network({}));
  r.add('/network/:tab', () => V.network({ tab: p4() }));
  r.add('/map', () => V.map());
  r.add('/installations', () => V.installations());
  r.add('/tickets', () => V.tickets());
  r.add('/inventory', () => V.inventory());
  r.add('/staff', () => V.staff());
  r.add('/devices', () => V.devices());
  r.add('/accounts', () => V.accounts());
  r.add('/journal', () => V.journal());
  r.add('/finance', () => V.finance());
  r.add('/providers', () => V.providers());
  r.add('/reports', () => V.reports());
  r.add('/audit', () => V.audit());
  r.add('/settings', () => V.settings());
}
function p4() { return (location.hash || '').split('/').pop(); }

function onHash() {
  if (!UI.user) return;
  highlightNav();
  const content = document.getElementById('content');
  content.replaceChildren(UI.el('div', { class: 'muted', style: 'padding:40px; text-align:center;' }, 'Loading…'));
  const hash = (location.hash || '#/dashboard').slice(1);
  const keys = [];
  let matched = null;
  for (const rt of Router.routes) {
    const m = hash.match(rt.regex);
    if (m) {
      const params = {};
      rt.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      matched = { fn: rt.fn, params };
      break;
    }
  }
  if (!matched) { location.hash = '#/dashboard'; return; }
  Promise.resolve(matched.fn(matched.params)).then((el) => {
    content.replaceChildren(el || UI.el('div'));
    window.scrollTo(0, 0);
  }).catch((e) => {
    content.replaceChildren(UI.el('div', { class: 'alert err' }, 'Failed to load: ' + UI.esc(e.message || String(e))));
  });
}

boot();
