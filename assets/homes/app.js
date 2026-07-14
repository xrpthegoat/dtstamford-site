/* ============================================================
   dtstamford.com — Mini-Zillow search app
   Vanilla ES module. Reads /data/listings.json (written by idx-sync).
   No framework, no build step — matches the static site.
   ============================================================ */

const DATA_URL = 'data/listings.json';
const PHONE = '2038833399';
const EMAIL = 'John@dtstamford.com';

const HOME_TYPES = ['Single Family', 'Condo', 'Multi-Family', 'Townhouse', 'Co-op', 'Land'];
const SALE_STEPS = [0, 200000, 300000, 400000, 500000, 600000, 750000, 900000, 1000000, 1250000, 1500000, 2000000, 3000000, 5000000];
const RENT_STEPS = [0, 1500, 1800, 2000, 2250, 2500, 3000, 3500, 4000, 5000, 7500, 10000];

/* Commute copy kept consistent with the published numbers on living-in-stamford.html /
   stamford-to-nyc-commute.html: express Metro-North trains run ~50 min to Grand Central,
   peak trains 50-60 min, off-peak/local 60-70 min. This is informational, not live transit data. */
const COMMUTE_INFO = {
  'Downtown': 'Walk to the train · ~50 min express to GCT',
  'South End': 'Shuttle to the train · ~50 min express to GCT',
  'Harbor Point': 'Shuttle to the train · ~50 min express to GCT',
  'Shippan': 'Short drive to the train · ~50 min express to GCT',
  'Cove': 'Short drive to the train · ~50 min express to GCT',
  'Waterside': 'Short drive to the train · ~50 min express to GCT',
  'Springdale': 'New Canaan branch / short drive to main line · ~55-60 min to GCT',
  'Glenbrook': 'New Canaan branch / short drive to main line · ~55-60 min to GCT',
  'North Stamford': 'Drive to the train · ~50 min express to GCT',
  'Westover': 'Short drive to the train · ~50 min express to GCT',
  'Turn of River': 'Short drive to the train · ~50 min express to GCT',
  'Belltown': 'Short drive to the train · ~50 min express to GCT',
  'Newfield': 'Short drive to the train · ~50 min express to GCT',
  'Ridgeway': 'Short drive to the train · ~50 min express to GCT',
};
const COMMUTE_DEFAULT = 'Drive to Stamford Transportation Center · ~50 min express to GCT';
function commuteFor(l) {
  const hood = l.address && l.address.neighborhood;
  return (hood && COMMUTE_INFO[hood]) || COMMUTE_DEFAULT;
}

const state = {
  all: [], meta: null,
  type: 'sale', q: '', priceMin: 0, priceMax: 0,
  beds: 0, baths: 0, types: [], sort: 'new',
  view: 'split', bounds: null, savedOnly: false,
  favs: new Set(JSON.parse(localStorage.getItem('dts_favs') || '[]')),
  cardIndex: {},        // mls -> current photo index
};

let map, markerLayer, markers = {};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const priceLabel = l => l.listingType === 'rent'
  ? `${money(l.price)}<span class="per">/mo</span>`
  : money(l.price);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bathStr = b => (b % 1 === 0 ? b : b.toFixed(1));

function badgeFor(l) {
  const s = (l.status || '').toLowerCase();
  if (s.includes('coming')) return { cls: 'soon', txt: 'Coming Soon' };
  if (s.includes('under') || s.includes('pending')) return { cls: 'uc', txt: 'Under Contract' };
  if (l.daysOnMarket != null && l.daysOnMarket <= 7) return { cls: 'new', txt: 'New' };
  return null;
}

/* ---------- data load ---------- */
async function load() {
  showSkeleton();
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.listings || []).filter(l => l && l.geo && Number.isFinite(l.geo.lat));
    state.meta = data.meta || {};
  } catch (err) {
    state.all = [];
    state.meta = { error: String(err) };
    console.warn('listings load failed:', err);
  }
  // default price ceiling stays "Any"; nothing preset
  buildTypeChecks();
  buildPriceSelects();
  initMap();
  readURL();
  render();
  const note = $('#sampleNote');
  if (state.meta && state.meta.source && state.meta.source !== 'reso' && state.meta.source !== 'rets') note.hidden = false;
  else note.hidden = true;
  renderLegal();
}

/* ---------- filter UI construction ---------- */
function buildTypeChecks() {
  $('#typeCol').innerHTML = HOME_TYPES.map(t =>
    `<label class="chk"><input type="checkbox" value="${t}"> ${t}</label>`).join('');
}
function buildPriceSelects() {
  const steps = state.type === 'rent' ? RENT_STEPS : SALE_STEPS;
  const opt = (v, isMax) => `<option value="${v}">${v === 0 ? (isMax ? 'Any' : 'No min') : money(v)}${state.type === 'rent' && v !== 0 ? '/mo' : ''}</option>`;
  $('#priceMin').innerHTML = steps.map(v => opt(v, false)).join('');
  $('#priceMax').innerHTML = steps.map(v => opt(v, true)).join('');
  $('#priceMin').value = String(state.priceMin || 0);
  $('#priceMax').value = String(state.priceMax || 0);
}

/* ---------- filtering + sorting ---------- */
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.all.filter(l => {
    if (l.listingType !== state.type) return false;
    if (state.priceMin && l.price < state.priceMin) return false;
    if (state.priceMax && l.price > state.priceMax) return false;
    if (state.beds && (l.beds || 0) < state.beds) return false;
    if (state.baths && (l.baths || 0) < state.baths) return false;
    if (state.types.length && !state.types.includes(l.propertyType)) return false;
    if (q) {
      const hay = `${l.address.line} ${l.address.city} ${l.address.neighborhood || ''} ${l.address.zip || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.bounds && !state.bounds.contains([l.geo.lat, l.geo.lng])) return false;
    if (state.savedOnly && !state.favs.has(l.mls)) return false;
    return true;
  });
  const s = state.sort;
  list.sort((a, b) =>
    s === 'price-asc' ? a.price - b.price :
    s === 'price-desc' ? b.price - a.price :
    s === 'beds' ? (b.beds || 0) - (a.beds || 0) :
    s === 'sqft' ? (b.sqft || 0) - (a.sqft || 0) :
    /* new */ new Date(b.listDate || 0) - new Date(a.listDate || 0));
  return list;
}

/* ---------- render ---------- */
function render() {
  const list = filtered();
  renderHead(list);
  renderCards(list);
  renderMarkers(list);
  syncFilterChrome();
  syncURL();
}

function renderHead(list) {
  $('#count').textContent = list.length;
  $('#countLabel').textContent = state.type === 'rent' ? (list.length === 1 ? 'rental' : 'rentals') : (list.length === 1 ? 'home' : 'homes');
  $('#locLabel').textContent = state.q ? `in “${state.q}”` : 'in Stamford & nearby';
  const u = state.meta && state.meta.updatedAt ? new Date(state.meta.updatedAt) : null;
  $('#updated').textContent = u && !isNaN(u) ? `Updated ${u.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
}

function showSkeleton() {
  $('#cards').innerHTML = Array.from({ length: 6 }).map(() =>
    `<div class="sk"><div class="sk-media"></div><div class="sk-line"></div><div class="sk-line s"></div></div>`).join('');
}

function renderCards(list) {
  const wrap = $('#cards'), empty = $('#empty');
  if (!list.length) { wrap.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  wrap.innerHTML = list.map(cardHTML).join('');
  list.forEach(l => wireCard(l));
}

function ppsf(l) {
  if (!l.sqft || !l.price || l.listingType === 'rent') return null;
  return Math.round(l.price / l.sqft);
}

function cardHTML(l) {
  const b = badgeFor(l);
  const idx = state.cardIndex[l.mls] || 0;
  const photos = (l.photos && l.photos.length) ? l.photos : ['assets/house.jpg'];
  const fav = state.favs.has(l.mls);
  const dots = photos.length > 1 ? `<div class="card-dots">${photos.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : '';
  const navs = photos.length > 1 ? `<button class="card-nav prev" data-nav="-1" aria-label="Previous photo">‹</button><button class="card-nav next" data-nav="1" aria-label="Next photo">›</button>` : '';
  const psf = ppsf(l);
  const commute = commuteFor(l);
  return `<article class="card" data-mls="${l.mls}">
    <div class="card-media">
      <img src="${esc(photos[idx])}" alt="${esc(l.address.line)}, ${esc(l.address.city)}" loading="lazy" onerror="this.src='assets/house.jpg'">
      <div class="card-badges">${b ? `<span class="badge ${b.cls}">${b.txt}</span>` : ''}</div>
      <button class="card-fav ${fav ? 'on' : ''}" data-fav aria-label="Save home">${fav ? '♥' : '♡'}</button>
      ${navs}${dots}
    </div>
    <div class="card-body">
      <div class="card-price">${priceLabel(l)}</div>
      <div class="card-specs">
        <span><b>${l.beds ?? '—'}</b> bd</span>
        <span><b>${l.baths != null ? bathStr(l.baths) : '—'}</b> ba</span>
        <span><b>${l.sqft ? l.sqft.toLocaleString() : '—'}</b> sqft</span>
        ${psf ? `<span class="card-ppsf">$${psf}/sqft</span>` : ''}
      </div>
      <div class="card-addr">${esc(l.address.line)}, ${esc(l.address.city)} ${esc(l.address.state)}</div>
      <div class="card-hoodrow">
        ${l.address.neighborhood ? `<span class="card-hood">${esc(l.address.neighborhood)}</span>` : ''}
        <span class="card-commute" title="Estimated Metro-North commute — see stamford-to-nyc-commute.html">${esc(commute)}</span>
      </div>
      <div class="card-foot">
        <span class="card-dom">${l.daysOnMarket != null ? (l.daysOnMarket === 0 ? 'Just listed' : l.daysOnMarket + ' days on market') : ''}</span>
        <span class="card-broker">${esc((l.listingAgent && l.listingAgent.brokerage) || '')}</span>
      </div>
    </div>
  </article>`;
}

function wireCard(l) {
  const el = $(`.card[data-mls="${cssq(l.mls)}"]`);
  if (!el) return;
  el.addEventListener('click', e => {
    if (e.target.closest('[data-fav]') || e.target.closest('[data-nav]')) return;
    openDetail(l);
  });
  const favBtn = el.querySelector('[data-fav]');
  favBtn && favBtn.addEventListener('click', e => { e.stopPropagation(); toggleFav(l.mls); });
  el.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    stepPhoto(l, parseInt(btn.dataset.nav, 10));
  }));
  el.addEventListener('mouseenter', () => highlightMarker(l.mls, true));
  el.addEventListener('mouseleave', () => highlightMarker(l.mls, false));
}

function stepPhoto(l, dir) {
  const photos = (l.photos && l.photos.length) ? l.photos : ['assets/house.jpg'];
  const n = photos.length;
  const cur = state.cardIndex[l.mls] || 0;
  const next = (cur + dir + n) % n;
  state.cardIndex[l.mls] = next;
  const el = $(`.card[data-mls="${cssq(l.mls)}"]`);
  if (!el) return;
  el.querySelector('img').src = photos[next];
  el.querySelectorAll('.card-dots i').forEach((d, i) => d.classList.toggle('on', i === next));
}

/* ---------- favorites ---------- */
function toggleFav(mls) {
  if (state.favs.has(mls)) state.favs.delete(mls); else state.favs.add(mls);
  localStorage.setItem('dts_favs', JSON.stringify([...state.favs]));
  const on = state.favs.has(mls);
  if (state.savedOnly) { render(); return; }  // list itself changes when viewing "Saved"
  $$(`.card[data-mls="${cssq(mls)}"] [data-fav]`).forEach(b => { b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡'; });
  const m = markers[mls]; if (m) m.getElement() && m.getElement().classList.toggle('fav', on);
  const dfav = $(`#drawer [data-fav="${cssq(mls)}"]`);
  if (dfav) { dfav.classList.toggle('on', on); dfav.textContent = on ? '♥ Saved' : '♡ Save'; }
  syncFilterChrome();
}

/* ---------- map ---------- */
function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
    .setView([41.053, -73.538], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 20,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  let moved = false;
  map.on('movestart', () => { moved = true; });
  map.on('moveend', () => { if (moved) $('#searchHere').hidden = false; });
  $('#searchHere').addEventListener('click', () => {
    state.bounds = map.getBounds();
    $('#searchHere').hidden = true;
    render();
  });
}

function renderMarkers(list) {
  markerLayer.clearLayers();
  markers = {};
  const pts = [];
  list.forEach(l => {
    const compact = l.listingType === 'rent'
      ? '$' + Math.round(l.price / 100) / 10 + 'k'
      : (l.price >= 1e6 ? '$' + (l.price / 1e6).toFixed(l.price >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(l.price / 1000) + 'k');
    const fav = state.favs.has(l.mls) ? ' fav' : '';
    const icon = L.divIcon({
      className: '', html: `<div class="price-pin${fav}" data-mls="${esc(l.mls)}">${l.listingType === 'rent' ? '$' + (l.price >= 1000 ? (l.price / 1000).toFixed(1) + 'k' : l.price) + '/mo' : compact}</div>`,
      iconSize: null,
    });
    const m = L.marker([l.geo.lat, l.geo.lng], { icon, riseOnHover: true }).addTo(markerLayer);
    m.on('click', () => openDetail(l));
    m.on('mouseover', () => highlightCard(l.mls, true));
    m.on('mouseout', () => highlightCard(l.mls, false));
    markers[l.mls] = m;
    pts.push([l.geo.lat, l.geo.lng]);
  });
  if (pts.length && !state.bounds) {
    try { map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 }); } catch (e) {}
  }
  setTimeout(() => map.invalidateSize(), 60);
}

function highlightMarker(mls, on) {
  const m = markers[mls]; if (!m) return;
  const el = m.getElement() && m.getElement().querySelector('.price-pin');
  if (el) el.classList.toggle('hi', on);
  if (on && m._icon) m.setZIndexOffset(1000); else if (m._icon) m.setZIndexOffset(0);
}
function highlightCard(mls, on) {
  const el = $(`.card[data-mls="${cssq(mls)}"]`);
  if (!el) return;
  el.classList.toggle('is-hi', on);
  if (on) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------- detail drawer ---------- */
function openDetail(l) {
  const photos = (l.photos && l.photos.length) ? l.photos : ['assets/house.jpg'];
  let gi = 0;
  const b = badgeFor(l);
  const fav = state.favs.has(l.mls);
  const psf = ppsf(l);
  const facts = [
    ['Property type', l.propertyType],
    ['Status', l.status],
    ['Beds', l.beds], ['Baths', l.baths != null ? bathStr(l.baths) : null],
    ['Interior', l.sqft ? l.sqft.toLocaleString() + ' sqft' : null],
    ['Price / sqft', psf ? '$' + psf : null],
    ['Lot', l.lotSqft ? l.lotSqft.toLocaleString() + ' sqft' : null],
    ['Year built', l.yearBuilt],
    ['Days on market', l.daysOnMarket],
    ['HOA', l.hoa ? money(l.hoa) + '/mo' : null],
    ['Taxes', l.taxAnnual ? money(l.taxAnnual) + '/yr' : null],
    ['MLS #', l.mls],
    ['Neighborhood', l.address.neighborhood],
  ].filter(f => f[1] != null && f[1] !== '');
  const mapsQ = encodeURIComponent(`${l.address.line}, ${l.address.city}, ${l.address.state} ${l.address.zip || ''}`);
  const mailBody = encodeURIComponent(`Hi John, I'm interested in ${l.address.line}, ${l.address.city} (MLS #${l.mls}, ${money(l.price)}). Can we set up a tour?`);

  $('#drawerBody').innerHTML = `
    <div class="d-gallery">
      <img id="dImg" src="${esc(photos[0])}" alt="${esc(l.address.line)}" onerror="this.src='assets/house.jpg'">
      ${photos.length > 1 ? `<button class="d-gnav prev" id="dPrev" aria-label="Previous">‹</button><button class="d-gnav next" id="dNext" aria-label="Next">›</button><div class="d-gcount" id="dCount">1 / ${photos.length}</div>` : ''}
    </div>
    <div class="d-body">
      ${b ? `<div class="d-badges"><span class="badge ${b.cls}">${b.txt}</span></div>` : ''}
      <div class="d-price">${priceLabel(l)}</div>
      <div class="d-specs">
        <div class="d-spec"><b>${l.beds ?? '—'}</b><span>Beds</span></div>
        <div class="d-spec"><b>${l.baths != null ? bathStr(l.baths) : '—'}</b><span>Baths</span></div>
        <div class="d-spec"><b>${l.sqft ? l.sqft.toLocaleString() : '—'}</b><span>Sq Ft</span></div>
        ${l.yearBuilt ? `<div class="d-spec"><b>${l.yearBuilt}</b><span>Built</span></div>` : ''}
      </div>
      <div class="d-addr">${esc(l.address.line)}, ${esc(l.address.city)}, ${esc(l.address.state)} ${esc(l.address.zip || '')}</div>
      ${l.address.neighborhood ? `<div class="d-hood">${esc(l.address.neighborhood)}</div>` : ''}
      <div class="d-commute" title="Estimated Metro-North commute — see stamford-to-nyc-commute.html">${esc(commuteFor(l))}</div>
      <div class="d-cta">
        <a class="btn btn-gold" href="tel:${PHONE}">Call John · 203·883·3399</a>
        <a class="btn btn-act" href="mailto:${EMAIL}?subject=${encodeURIComponent('Tour request: ' + l.address.line)}&body=${mailBody}">Request a tour</a>
        <button class="btn btn-out" data-fav="${esc(l.mls)}">${fav ? '♥ Saved' : '♡ Save'}</button>
      </div>
      ${l.remarks ? `<div class="d-section"><h4>About this home</h4><p class="d-remarks">${esc(l.remarks)}</p></div>` : ''}
      <div class="d-section"><h4>Facts &amp; features</h4>
        <div class="d-facts">${facts.map(f => `<div class="d-fact"><span>${esc(f[0])}</span><b>${esc(f[1])}</b></div>`).join('')}</div>
      </div>
      ${(l.features && l.features.length) ? `<div class="d-section"><h4>Highlights</h4><div class="d-feats">${l.features.map(f => `<span class="d-feat">${esc(f)}</span>`).join('')}</div></div>` : ''}
      <div class="d-section"><h4>Location</h4><div class="d-map" id="dMap"></div></div>
      <div class="d-legal">${esc(l.attribution || '')} ${state.meta && state.meta.attribution ? esc(state.meta.attribution) : ''}
        ${l.slug ? `<br><a class="d-seo-link" href="homes/${esc(l.slug)}.html">View full listing page ↗</a>` : ''}
      </div>
    </div>`;

  // gallery nav
  const setG = () => { $('#dImg').src = photos[gi]; const c = $('#dCount'); if (c) c.textContent = `${gi + 1} / ${photos.length}`; };
  $('#dPrev') && $('#dPrev').addEventListener('click', () => { gi = (gi - 1 + photos.length) % photos.length; setG(); });
  $('#dNext') && $('#dNext').addEventListener('click', () => { gi = (gi + 1) % photos.length; setG(); });
  $('#drawerBody').querySelector('[data-fav]').addEventListener('click', () => toggleFav(l.mls));

  // mini map
  const dm = L.map('dMap', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false })
    .setView([l.geo.lat, l.geo.lng], 14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' }).addTo(dm);
  L.marker([l.geo.lat, l.geo.lng], { icon: L.divIcon({ className: '', html: `<div class="price-pin hi">${esc(l.address.line)}</div>` }) }).addTo(dm);
  setTimeout(() => dm.invalidateSize(), 80);

  $('#scrim').hidden = false;
  requestAnimationFrame(() => { $('#scrim').classList.add('show'); $('#drawer').classList.add('show'); });
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer').focus();
}
function closeDetail() {
  $('#drawer').classList.remove('show');
  $('#scrim').classList.remove('show');
  $('#drawer').setAttribute('aria-hidden', 'true');
  setTimeout(() => { $('#scrim').hidden = true; $('#drawerBody').innerHTML = ''; }, 400);
}

/* ---------- IDX legal ---------- */
function renderLegal() {
  const a = (state.meta && state.meta.attribution) || 'Listing data provided courtesy of SmartMLS. Information deemed reliable but not guaranteed.';
  $('#idxLegal').innerHTML = `<strong>MLS disclosure.</strong> ${esc(a)} Listings are subject to prior sale, change, or withdrawal. © ${new Date().getFullYear()} SmartMLS, Inc. Displayed by John Restrepo, licensed CT real estate agent. Equal Housing Opportunity.`;
}

/* ---------- filter chrome sync + events ---------- */
function syncFilterChrome() {
  // price/beds/type buttons reflect state
  const priceBtn = $('.drop[data-drop="price"] .drop-btn');
  priceBtn.classList.toggle('has-val', !!(state.priceMin || state.priceMax));
  $('.drop[data-drop="price"] .drop-lbl').textContent =
    (state.priceMin || state.priceMax)
      ? `${state.priceMin ? money(state.priceMin) : 'Any'}–${state.priceMax ? money(state.priceMax) : 'Any'}`
      : 'Price';
  const bedsBtn = $('.drop[data-drop="beds"] .drop-btn');
  bedsBtn.classList.toggle('has-val', !!(state.beds || state.baths));
  $('.drop[data-drop="beds"] .drop-lbl').textContent = state.beds ? `${state.beds}+ bd` : (state.baths ? `${state.baths}+ ba` : 'Beds');
  const typeBtn = $('.drop[data-drop="type"] .drop-btn');
  typeBtn.classList.toggle('has-val', state.types.length > 0);
  $('.drop[data-drop="type"] .drop-lbl').textContent = state.types.length ? `${state.types.length} type${state.types.length > 1 ? 's' : ''}` : 'Home type';
  const sortNames = { new: 'Newest', 'price-asc': 'Price ↑', 'price-desc': 'Price ↓', beds: 'Most beds', sqft: 'Largest' };
  $('.drop[data-drop="sort"] .drop-lbl').textContent = 'Sort: ' + sortNames[state.sort];

  // active-filter count badge (search + price + beds/baths + type; sort/view aren't "filters")
  const activeCount = (state.q ? 1 : 0) + ((state.priceMin || state.priceMax) ? 1 : 0) +
    ((state.beds || state.baths) ? 1 : 0) + (state.types.length ? 1 : 0);
  const badge = $('#filterBadge');
  if (badge) {
    badge.hidden = activeCount === 0;
    $('#filterCount').textContent = activeCount;
  }

  // saved button reflects count + active state
  const savedBtn = $('#savedBtn');
  if (savedBtn) {
    savedBtn.classList.toggle('is-on', state.savedOnly);
    savedBtn.setAttribute('aria-pressed', state.savedOnly);
    $('#savedLabel').textContent = state.favs.size ? `Saved (${state.favs.size})` : 'Saved';
  }
}

function wireControls() {
  // search box (debounced)
  let t;
  $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; state.bounds = null; render(); }, 220); });

  // sale/rent segment
  $$('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
    if (state.type === btn.dataset.type) return;
    state.type = btn.dataset.type;
    $$('.seg-btn').forEach(b => { const on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
    state.priceMin = 0; state.priceMax = 0; state.bounds = null;
    buildPriceSelects();
    render();
  }));

  // dropdown open/close (+ right-edge collision detection so a panel near the
  // right edge of the bar, e.g. "Sort", never overflows the viewport)
  $$('.drop').forEach(d => {
    const btn = d.querySelector('.drop-btn');
    const panel = d.querySelector('.drop-panel');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = d.classList.contains('is-active');
      closeDrops();
      if (!open) {
        d.classList.add('is-active');
        btn.setAttribute('aria-expanded', 'true');
        if (panel) {
          panel.classList.remove('align-right');
          const r = panel.getBoundingClientRect();
          if (r.right > window.innerWidth - 8) panel.classList.add('align-right');
        }
      }
    });
    d.querySelectorAll('.drop-panel').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
    const done = d.querySelector('.dp-done'); done && done.addEventListener('click', () => closeDrops());
  });
  document.addEventListener('click', closeDrops);

  // saved / favorites view
  $('#savedBtn').addEventListener('click', () => {
    state.savedOnly = !state.savedOnly;
    render();
  });

  // price selects
  $('#priceMin').addEventListener('change', e => { state.priceMin = +e.target.value; render(); });
  $('#priceMax').addEventListener('change', e => { state.priceMax = +e.target.value; render(); });

  // beds/baths pills
  $$('#bedsRow .pillx').forEach(p => p.addEventListener('click', () => {
    state.beds = +p.dataset.beds;
    $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x === p)); render();
  }));
  $$('#bathsRow .pillx').forEach(p => p.addEventListener('click', () => {
    state.baths = +p.dataset.baths;
    $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x === p)); render();
  }));

  // type checks
  $('#typeCol').addEventListener('change', () => {
    state.types = $$('#typeCol input:checked').map(i => i.value); render();
  });

  // sort radios
  $$('#sortCol .radx').forEach(r => r.addEventListener('click', () => {
    state.sort = r.dataset.sort;
    $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x === r));
    render(); closeDrops();
  }));

  // clear buttons
  $$('[data-clear]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.clear;
    if (k === 'price') { state.priceMin = 0; state.priceMax = 0; buildPriceSelects(); }
    if (k === 'beds') { state.beds = 0; state.baths = 0; $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.beds === '0')); $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.baths === '0')); }
    if (k === 'type') { state.types = []; $$('#typeCol input').forEach(i => i.checked = false); }
    render();
  }));

  // filter badge click = same as reset
  $('#filterBadge').addEventListener('click', () => $('#resetBtn').click());

  // reset (note: intentionally does NOT clear the Saved view — that's a separate lens, not a filter)
  $('#resetBtn').addEventListener('click', () => {
    Object.assign(state, { q: '', priceMin: 0, priceMax: 0, beds: 0, baths: 0, types: [], sort: 'new', bounds: null });
    $('#q').value = '';
    buildPriceSelects();
    $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.beds === '0'));
    $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.baths === '0'));
    $$('#typeCol input').forEach(i => i.checked = false);
    $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.sort === 'new'));
    render();
  });

  // view toggle
  $$('.vt-btn').forEach(v => v.addEventListener('click', () => {
    state.view = v.dataset.view;
    $$('.vt-btn').forEach(x => x.classList.toggle('is-on', x === v));
    $('#app').dataset.view = state.view;
    if (map) setTimeout(() => map.invalidateSize(), 80);
    syncURL();
  }));

  // drawer close
  $('#drawerClose').addEventListener('click', closeDetail);
  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrops(); closeDetail(); } });
}
function closeDrops() { $$('.drop.is-active').forEach(d => { d.classList.remove('is-active'); d.querySelector('.drop-btn').setAttribute('aria-expanded', 'false'); }); }

/* ---------- URL state ---------- */
function syncURL() {
  const p = new URLSearchParams();
  if (state.type !== 'sale') p.set('t', state.type);
  if (state.q) p.set('q', state.q);
  if (state.priceMin) p.set('pmin', state.priceMin);
  if (state.priceMax) p.set('pmax', state.priceMax);
  if (state.beds) p.set('bd', state.beds);
  if (state.baths) p.set('ba', state.baths);
  if (state.types.length) p.set('ty', state.types.join(','));
  if (state.sort !== 'new') p.set('s', state.sort);
  if (state.view !== 'split') p.set('v', state.view);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}
function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.get('t') === 'rent') { state.type = 'rent'; $$('.seg-btn').forEach(b => { const on = b.dataset.type === 'rent'; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); }); buildPriceSelects(); }
  if (p.get('q')) { state.q = p.get('q'); $('#q').value = state.q; }
  if (p.get('pmin')) { state.priceMin = +p.get('pmin'); $('#priceMin').value = p.get('pmin'); }
  if (p.get('pmax')) { state.priceMax = +p.get('pmax'); $('#priceMax').value = p.get('pmax'); }
  if (p.get('bd')) { state.beds = +p.get('bd'); $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.beds === p.get('bd'))); }
  if (p.get('ba')) { state.baths = +p.get('ba'); $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.baths === p.get('ba'))); }
  if (p.get('ty')) { state.types = p.get('ty').split(','); $$('#typeCol input').forEach(i => i.checked = state.types.includes(i.value)); }
  if (p.get('s')) { state.sort = p.get('s'); $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.sort === state.sort)); }
  if (p.get('v')) { state.view = p.get('v'); $$('.vt-btn').forEach(x => x.classList.toggle('is-on', x.dataset.view === state.view)); $('#app').dataset.view = state.view; }
}

/* CSS.escape shim for attribute selectors (MLS ids are alnum, but be safe) */
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* ---------- boot ---------- */
wireControls();
load();
