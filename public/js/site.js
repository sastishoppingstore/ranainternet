/* Rana Internet — customer site shared logic + landing page */
const I18N = {
  en: {
    brand_sub: 'FIBER INTERNET • LAHORE',
    nav_packages: 'Packages', nav_areas: 'Coverage', nav_how: 'How It Works', nav_faq: 'FAQ', nav_track: 'Track', nav_apply: 'Apply Now',
    hero_t1: 'Fiber Internet', hero_t2: 'for Every Home in Lahore',
    hero_sub: 'Ultra-fast FTTH connection with 24/7 support, stable signal and transparent pricing.',
    cta_apply: 'Apply for Connection', cta_view: 'View Packages',
    stat_pkg: 'Speed Packages', stat_support: 'Technical Support', stat_inst: '48 hrs', stat_inst_sub: 'Installation',
    card_speeds: 'Available Speeds',
    pkg_kicker: 'Our Packages', pkg_title: 'Choose Your Speed',
    pkg_sub: 'From browsing to gaming and business — a plan for every need.',
    pkg_month: '/month', pkg_install: 'One-time installation', pkg_apply: 'Apply for this package',
    area_kicker: 'Coverage', area_title: 'Where We Serve', area_sub: 'Select your area and apply — we handle the rest.',
    how_kicker: 'Simple Process', how_title: 'How It Works', how_sub: 'Only 4 steps — from application to connection.',
    s1_t: 'Apply Online', s1_p: 'Fill the form with your CNIC, phone number and address.',
    s2_t: 'Site Survey', s2_p: 'Our team calls you and checks the route to your home for feasibility.',
    s3_t: 'Installation', s3_p: 'Technician installs fiber, ONU/router and tests your speed — usually within 48 hours.',
    s4_t: 'Enjoy Internet', s4_p: 'Connection active! Monthly bill on your chosen date. 24/7 support on WhatsApp.',
    why_kicker: 'Why Rana Internet', why_title: 'Local. Reliable. Fast.',
    w1_t: 'True Fiber to Home', w1_p: 'Real FTTH — no shared copper, no throttling.',
    w2_t: 'Fast Local Support', w2_p: 'Call or WhatsApp — our team is in your area.',
    w3_t: 'Transparent Billing', w3_p: 'Clear monthly bill via cash, JazzCash, Easypaisa, Raast or bank.',
    w4_t: 'Stable Signal', w4_p: 'Monitored network with quick fault detection.',
    w5_t: 'Homes & Business', w5_p: 'From 10 Mbps browsing to 50 Mbps business plans.',
    w6_t: '24/7 Availability', w6_p: 'Network and support never sleep.',
    faq_kicker: 'FAQ', faq_title: 'Common Questions',
    q1: 'Is there an installation charge?', a1: 'Yes — a one-time installation fee applies with each package (shown on the package page).',
    q2: 'How do I pay my bill?', a2: 'Cash, JazzCash, Easypaisa, Raast QR code, or bank transfer — always mention your invoice number.',
    q3: 'Internet is not working, what do I do?', a3: 'Call our helpline or send a WhatsApp ticket. Our technical team responds quickly.',
    q4: 'Can I change my package?', a4: 'Yes, anytime. The new speed starts next billing cycle (prorate adjustment available on request).',
    q5: 'Is there a lock-in period?', a5: 'No long-term contracts on monthly plans — you can leave any time.',
    ct_kicker: 'Contact', ct_title: 'Visit or Call Us',
    ct_office: 'Main Office', ct_hours: 'Office Hours',
    ct_apply_link: 'Apply online for a new connection', ct_track_link: 'Track your application status',
    ft_about: 'Fiber internet service provider for homes and businesses in Lahore.',
    ft_links: 'Quick Links', ft_apply: 'Apply for Connection', ft_track: 'Track Application', ft_pkg: 'Packages',
    ft_contact: 'Contact', ft_tag: 'Fiber to Home • Lahore',
  },
  ur: {
    brand_sub: 'FIBER INTERNET • LAHORE',
    nav_packages: 'Packages', nav_areas: 'Areas', nav_how: 'Kaise Kaam Karta Hai', nav_faq: 'FAQ', nav_track: 'Track', nav_apply: 'Apply Karein',
    hero_t1: 'Fiber Internet', hero_t2: 'Har Ghar Ke Liye — Lahore',
    hero_sub: 'Bohot tez FTTH connection, 24/7 support, stable signal aur saaf pakki pricing. Naya connection aaj hi apply karein!',
    cta_apply: 'Connection Apply Karein', cta_view: 'Packages Dekhein',
    stat_pkg: 'Speed Packages', stat_support: 'Technical Support', stat_inst: '48 ghante', stat_inst_sub: 'Installation',
    card_speeds: 'Available Speeds',
    pkg_kicker: 'Hamare Packages', pkg_title: 'Apni Speed Chunein',
    pkg_sub: 'Browsing se le kar gaming aur business tak — har zaroorat ka plan.',
    pkg_month: '/mahina', pkg_install: 'Ek baar ki installation fee', pkg_apply: 'Is package ke liye apply karein',
    area_kicker: 'Coverage', area_title: 'Hamare Areas', area_sub: 'Apna area select karein aur apply karein — baqi hum karein ge.',
    how_kicker: 'Aasan Process', how_title: 'Kaise Kaam Karta Hai', how_sub: 'Sirf 4 qadam — apply se le kar connection tak.',
    s1_t: 'Online Apply', s1_p: 'Form bharein — CNIC, phone number aur address ke sath.',
    s2_t: 'Site Survey', s2_p: 'Hamari team aap ko call kar ke route check karti hai.',
    s3_t: 'Installation', s3_p: 'Technician fiber aur router lagata hai, speed test karta hai — aam tor par 48 ghanton ke andar.',
    s4_t: 'Internet Isteamal Karein', s4_p: 'Connection active! Mahanota bill apni tay tareekh par. WhatsApp par 24/7 support.',
    why_kicker: 'Kyun Rana Internet', why_title: 'Local. Bishwas-pasand. Tez.',
    w1_t: 'Asli Fiber to Home', w1_p: 'Haqiqi FTTH — koi shared copper nahi, koi throttling nahi.',
    w2_t: 'Tez Local Support', w2_p: 'Call ya WhatsApp karein — hamari team aapke area mein hai.',
    w3_t: 'Saaf Billing', w3_p: 'Mahana bill — cash, JazzCash, Easypaisa, Raast ya bank transfer.',
    w4_t: 'Stable Signal', w4_p: 'Monitor kiya hua network, fault jald pakra jata hai.',
    w5_t: 'Ghar aur Business', w5_p: '10 Mbps browsing se le kar 50 Mbps business plans tak.',
    w6_t: '24/7 Availability', w6_p: 'Network aur support kabhi band nahi hote.',
    faq_kicker: 'FAQ', faq_title: 'Aam Sawalaat',
    q1: 'Installation charge hota hai?', a1: 'Haan, har package ke sath ek one-time installation fee hoti hai (package page par likhi hai).',
    q2: 'Bill kaise doon?', a2: 'Cash, JazzCash, Easypaisa, Raast QR ya bank transfer — invoice number zaroor batayein.',
    q3: 'Internet nahi aa raha?', a3: 'Helpline par call karein ya WhatsApp par ticket bhejein. Technical team jald jawab deti hai.',
    q4: 'Package badal sakta hoon?', a4: 'Haan, kabhi bhi. Nayi speed agle billing cycle se shuru hoti hai (prorate adjustment bhi available).',
    q5: 'Koi lock-in period hai?', a5: 'Monthly plans par koi lamba contract nahi — aap chahein to chhor sakte hain.',
    ct_kicker: 'Rabta', ct_title: 'Aayein ya Call Karein',
    ct_office: 'Main Office', ct_hours: 'Office Timing',
    ct_apply_link: 'Naye connection ke liye online apply karein', ct_track_link: 'Apni application track karein',
    ft_about: 'Lahore ke gharon aur businesses ke liye fiber internet service provider.',
    ft_links: 'Quick Links', ft_apply: 'Connection Apply Karein', ft_track: 'Application Track Karein', ft_pkg: 'Packages',
    ft_contact: 'Rabta', ft_tag: 'Fiber to Home • Lahore',
  },
};

let LANG = localStorage.getItem('rana_lang') || 'en';

function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
}
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.documentElement.lang = LANG === 'ur' ? 'ur' : 'en';
  const btn = document.getElementById('langToggle');
  if (btn) btn.textContent = LANG === 'ur' ? 'English' : 'اردو';
}
function toggleLang() {
  LANG = LANG === 'ur' ? 'en' : 'ur';
  localStorage.setItem('rana_lang', LANG);
  applyI18n();
  if (window.renderDynamic) window.renderDynamic();
}
document.getElementById('langToggle')?.addEventListener('click', toggleLang);

function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), ms);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw { status: res.status, ...(data || { error: 'Request failed' }) };
  return data;
}

const PKG_ICONS = ['📱', '🏠', '👨‍👩‍👧', '💼'];

async function renderLanding() {
  try {
    const [company, pkgs, areas] = await Promise.all([
      api('/api/public/company'),
      api('/api/public/packages'),
      api('/api/public/areas'),
    ]);
    // hero speeds
    const hs = document.getElementById('heroSpeeds');
    if (hs) hs.innerHTML = pkgs.slice(0, 4).map((p) =>
      `<div class="speed-row"><span class="s">${p.download} <small>Mbps</small></span><span class="p">${p.priceText}</span></div>`).join('');
    const st = document.getElementById('statPkg');
    if (st) st.textContent = pkgs.length + '+';
    // packages
    const grid = document.getElementById('pkgGrid');
    if (grid) {
      grid.innerHTML = pkgs.map((p, i) => `
        <div class="pkg-card">
          ${i === 1 ? '<span class="pop">POPULAR</span>' : ''}
          <div class="name">${p.name}</div>
          <div class="speed">${p.download} <small>Mbps</small></div>
          <div class="up">↑ ${p.upload} Mbps • ${p.dataLimit === 'Unlimited' ? t('data_unl') || 'Unlimited data' : p.dataLimit}</div>
          <div class="price">${p.priceText} <small>${t('pkg_month')}</small></div>
          <div class="feat">${p.description || ''}<br><small>${t('pkg_install')}: ${p.installFee.toLocaleString()} PKR</small></div>
          <a class="btn btn-primary" href="/apply?package=${encodeURIComponent(p.name)}">${t('pkg_apply')}</a>
        </div>`).join('');
    }
    // areas
    const ag = document.getElementById('areaGrid');
    if (ag) {
      ag.innerHTML = areas.map((a) => `
        <div class="area-card"><div class="ic">📍</div><b>${a.name}</b><span>${a.zone || ''}</span></div>`).join('');
    }
    // contact
    const set = (id, v, tel = false) => { const el = document.getElementById(id); if (!el) return; el.textContent = v || '—'; if (tel && v) el.href = v.startsWith('http') ? v : `https://wa.me/${v.replace(/\D/g, '')}`; };
    set('cAddress', company.address);
    set('cPhone', company.phone);
    set('cWhatsapp', company.whatsapp, true);
    set('cEmail', company.email);
    set('cHours', company.hours);
    set('ftPhone', company.phone);
    set('ftWhatsapp', company.whatsapp);
    applyI18n();
  } catch (e) {
    console.error(e);
    toast('Could not load site data — is the server running?');
  }
}

if (document.getElementById('pkgGrid')) {
  window.renderDynamic = renderLanding;
  renderLanding();
}
