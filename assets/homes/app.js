/* ============================================================
   dtstamford.com — Mini-Zillow search app
   Vanilla ES module. Reads /data/listings.json (written by idx-sync).
   No framework, no build step — matches the static site.
   ============================================================ */

// Prefer the light index (grid+map payload: primaryPhoto only, no photos[]/remarks) and fall back to
// the full listings.json if the index 404s, so the page never blanks during a migration/partial deploy.
const INDEX_URL = 'data/listings-index.json';
const DATA_URL = 'data/listings.json';
// Per-listing detail file, lazy-fetched on drawer open to hydrate photos[] + remarks the index omits.
const detailURL = slug => `data/listings/${encodeURIComponent(slug)}.json`;
const PHONE = '2038833399';
const EMAIL = 'John@dtstamford.com';
const PAGE_SIZE = 24;      // cards rendered per IntersectionObserver page
const PLACEHOLDER_PHOTO = 'assets/stamford-ct-single-family-home-exterior.jpg';

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

/* ---------- nearest train station (walk-time filter) ----------
   Metro-North New Haven Line + New Canaan/Danbury branch stops near Stamford, INLINED here (not a
   window global) so there is zero dependency on inline-script load order on this static page. Straight-
   line (haversine) distance -> walking minutes at ~5 km/h (83.33 m/min). Deliberately as-the-crow-flies
   (real walks run longer) — good enough to filter "roughly within an X-minute walk of a train". */
const STATIONS = [
  {name:'Greenwich', lat:41.0217, lng:-73.6262},
  {name:'Cos Cob', lat:41.0313, lng:-73.5987},
  {name:'Riverside', lat:41.0353, lng:-73.5817},
  {name:'Old Greenwich', lat:41.0369, lng:-73.5658},
  {name:'Stamford', lat:41.0466, lng:-73.5420},
  {name:'Noroton Heights', lat:41.0637, lng:-73.4977},
  {name:'Darien', lat:41.0776, lng:-73.4693},
  {name:'Rowayton', lat:41.0897, lng:-73.4438},
  {name:'South Norwalk', lat:41.0965, lng:-73.4222},
  {name:'East Norwalk', lat:41.1004, lng:-73.4025},
  {name:'Westport', lat:41.1189, lng:-73.3703},
  {name:"Green's Farms", lat:41.1233, lng:-73.3154},
  {name:'Glenbrook', lat:41.0578, lng:-73.5257},
  {name:'Springdale', lat:41.0722, lng:-73.5236},
  {name:'Talmadge Hill', lat:41.1160, lng:-73.4981},
  {name:'New Canaan', lat:41.1463, lng:-73.4956},
  {name:'Merritt 7', lat:41.1480, lng:-73.4277},
  {name:'Wilton', lat:41.1959, lng:-73.4321},
  {name:'Cannondale', lat:41.2167, lng:-73.4267},
  {name:'Branchville', lat:41.2667, lng:-73.4409},
];
const WALK_M_PER_MIN = 83.33;   // 5 km/h / 60 min, in meters

// Great-circle distance in METERS (haversine). R = 6371000 matches Leaflet's L.CRS.Earth, so this is
// ALSO the exact cutoff for the drawn-circle area filter (state.circle) — the two features share it.
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Nearest-station walk minutes for a listing, MEMOIZED (l._trainMin) so the ~20-station sweep runs
// ONCE per listing, not per keystroke over ~1,700 rows. Infinity when uncomputable.
function trainMinFor(l) {
  if (l._trainMin !== undefined) return l._trainMin;
  if (!STATIONS.length || !l.geo || !Number.isFinite(l.geo.lat)) { l._trainMin = Infinity; l._trainStation = null; return Infinity; }
  let best = Infinity, bestSt = null;
  for (const st of STATIONS) {
    const m = haversineM(l.geo.lat, l.geo.lng, st.lat, st.lng);
    if (m < best) { best = m; bestSt = st; }
  }
  l._trainMin = Math.round(best / WALK_M_PER_MIN);
  l._trainStation = bestSt;
  return l._trainMin;
}

const state = {
  all: [], meta: null,
  type: 'sale', q: '', priceMin: 0, priceMax: 0,
  beds: 0, baths: 0, types: [], cities: [], maxTrainMin: 0, sort: 'new',
  view: 'split', bounds: null, circle: null, savedOnly: false,
  favs: new Set(JSON.parse(localStorage.getItem('dts_favs') || '[]')),
  cardIndex: {},        // mls -> current photo index
  byMls: {},            // mls -> listing, for delegated card events
};

let map, markerLayer, markers = {};
let drawMode = false, drawnCircle = null, _drawStart = null;

/* ---------- accounts: "Sign in with Google" + save listings forever (Supabase Auth) ----------
   INERT until ACCOUNTS_ENABLED = true. Flip to true AFTER the one-time Supabase setup (enable the
   Google provider, add the redirect URLs, run the saved_listings table SQL — see ACCOUNTS-SETUP.md).
   Until then the site saves to THIS device via localStorage exactly as before; turning accounts on
   layers "saved forever, on any device" on top without changing anything else. Reuses the SAME
   Supabase project + publishable anon key that track.js already ships; per-user Row-Level Security
   guards the saved_listings table so a signed-in visitor can only ever read/write their own saves. */
const ACCOUNTS_ENABLED = false;
const SB_URL = 'https://ltihgxyzmgrikonlcrhy.supabase.co';
const SB_KEY = 'sb_publishable_BBpnL4fstiTa_NozI9AWeA_aftyztov';   // publishable — safe to ship
const GOOGLE_G = '<svg class="g-g" viewBox="0 0 48 48" width="15" height="15" aria-hidden="true">' +
  '<path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.600000000000001v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.1z"/>' +
  '<path fill="#34A853" d="M24 46c6 0 11-2 14.7-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.6 2.1-5.8 0-10.7-3.9-12.5-9.2H4.2v5.7C7.9 41.1 15.4 46 24 46z"/>' +
  '<path fill="#FBBC05" d="M11.5 27.9c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1V14H4.2A21.9 21.9 0 0 0 2 23.8c0 3.6.9 6.9 2.2 9.8l7.3-5.7z"/>' +
  '<path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.2 14l7.3 5.7c1.8-5.3 6.7-8.9 12.5-8.9z"/></svg>';
let _sb = null, _acctUser = null;

// Lazy-load the Supabase SDK + wire auth state. No cost when ACCOUNTS_ENABLED is false (returns early,
// the SDK is never fetched). A load failure degrades gracefully — local saving keeps working.
async function initAccounts() {
  if (!ACCOUNTS_ENABLED) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    _sb = createClient(SB_URL, SB_KEY);
    _sb.auth.onAuthStateChange((_e, session) => onAuthChange(session && session.user));
    const { data } = await _sb.auth.getSession();
    onAuthChange(data && data.session && data.session.user);
  } catch (err) {
    console.warn('accounts init failed (saving still works on this device):', err);
    _sb = null;
  }
}

function onAuthChange(user) {
  const was = _acctUser;
  _acctUser = user || null;
  renderAcct();
  if (_acctUser && !was) mergeCloudSaves();   // just signed in -> pull + merge the account's saves
}

// On sign-in, UNION the account's cloud saves with this device's local saves so nothing is lost, then
// push any local-only saves up so this shortlist is preserved in the account. Repaint every surface.
async function mergeCloudSaves() {
  if (!_sb || !_acctUser) return;
  let cloud = [];
  try {
    const { data, error } = await _sb.from('saved_listings').select('mls');
    if (error) throw error;
    cloud = (data || []).map(r => String(r.mls));
  } catch (e) { console.warn('cloud saved-list fetch failed:', e); return; }
  const localOnly = [...state.favs].map(String).filter(m => !cloud.includes(m));
  cloud.forEach(m => state.favs.add(m));
  localStorage.setItem('dts_favs', JSON.stringify([...state.favs]));
  if (localOnly.length) {
    try { await _sb.from('saved_listings').upsert(localOnly.map(mls => ({ mls })), { onConflict: 'user_id,mls' }); }
    catch (e) { console.warn('cloud save push failed:', e); }
  }
  render(); syncFilterChrome();
}

// Mirror a single toggle to the cloud (no-op unless signed in). Fire-and-forget: a network hiccup must
// never block the instant local save.
function cloudSave(mls, on) {
  if (!_sb || !_acctUser) return;
  const p = on ? _sb.from('saved_listings').upsert({ mls: String(mls) }, { onConflict: 'user_id,mls' })
               : _sb.from('saved_listings').delete().eq('mls', String(mls));
  Promise.resolve(p).catch(e => console.warn('cloud save sync failed:', e));
}

async function acctSignIn() {
  if (!_sb) return;
  try { await _sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0] } }); }
  catch (e) { console.warn('Google sign-in failed:', e); }
}
async function acctSignOut() {
  if (_sb) { try { await _sb.auth.signOut(); } catch (e) {} }
  _acctUser = null; renderAcct();
}

// Paint the account control in the filter bar. Hidden entirely unless ACCOUNTS_ENABLED, so no broken
// button ever shows before setup.
function renderAcct() {
  const wrap = $('#acctWrap'); if (!wrap) return;
  wrap.hidden = !ACCOUNTS_ENABLED;
  if (!ACCOUNTS_ENABLED) return;
  const btn = $('#acctBtn'), menu = $('#acctMenu');
  if (_acctUser) {
    const email = _acctUser.email || '';
    const meta = _acctUser.user_metadata || {};
    const name = (meta.full_name || meta.name || email || 'You').trim();
    const first = name.split(/\s+/)[0] || 'You';
    btn.innerHTML = `<span class="acct-av">${esc((first[0] || 'Y').toUpperCase())}</span><span class="acct-name">${esc(first)}</span>`;
    btn.classList.add('is-in');
    menu.innerHTML = `<div class="acct-who">Signed in as<br><b>${esc(email || name)}</b></div>` +
      `<div class="acct-note">Your saved homes now follow you to every device.</div>` +
      `<button class="acct-out" type="button" data-acct-out>Sign out</button>`;
  } else {
    btn.innerHTML = `${GOOGLE_G}<span>Sign in</span>`;
    btn.classList.remove('is-in');
    if (menu) { menu.hidden = true; menu.innerHTML = ''; }
    btn.setAttribute('aria-expanded', 'false');
  }
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const priceLabel = l => l.listingType === 'rent'
  ? `${money(l.price)}<span class="per">/mo</span>`
  : money(l.price);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The MLS feed arrives HTML-entity-encoded ("chef&apos;s kitchen") — decode common entities so text
// reads normally. Run BEFORE esc(): deEnt un-encodes, esc re-encodes safely for the DOM.
const deEnt = s => String(s == null ? '' : s)
  .replace(/&apos;/g, "'").replace(/&#0*39;/g, "'").replace(/&rsquo;|&lsquo;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#0*34;/g, '"').replace(/&rdquo;|&ldquo;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const bathStr = b => (b % 1 === 0 ? b : b.toFixed(1));
// The index record carries only `primaryPhoto`; the full record (drawer detail / listings.json) carries
// `photos[]`. Resolve to a non-empty array so cards, the gallery and photo-stepping have something to show.
function photosOf(l) {
  if (l && l.photos && l.photos.length) return l.photos;
  if (l && l.primaryPhoto) return [l.primaryPhoto];
  return [PLACEHOLDER_PHOTO];
}

// SmartMLS §12.2.3 / §12.8 — when a seller withholds the address, the listing still appears but
// the street number+name must NOT render. The sync sets address.line = null and addressWithheld
// = true for those. This helper is the ONE place that decides what an address shows, so no card,
// modal, alt-text, map query or mailto can accidentally leak a withheld street address.
function addrLine(l) {
  const a = (l && l.address) || {};
  return a.line ? deEnt(a.line) : 'Address available on request';
}
function addrFull(l) {
  const a = (l && l.address) || {};
  const head = a.line ? deEnt(a.line) + ', ' : '';
  return head + [a.city, a.state].filter(Boolean).join(' ');
}
// The listing firm + agent contact SmartMLS requires on every card (§12.3.2 / §12.3.4). Attribution
// travels on the record so it can never be dropped by the template.
function mlsAttrib(l) {
  const at = (l && l.attribution) || {};
  if (!at.office) return '';
  const contact = at.agentPhone || at.agentEmail || '';
  const agent = [at.agent, contact].filter(Boolean).join(' · ');
  return `<div class="idx-attrib">Listing courtesy of <strong>${esc(at.office)}</strong>` +
         (agent ? ` — ${esc(agent)}` : '') + `</div>`;
}

// Map a short filter label to the MLS's verbose propertyType string.
function propMatches(label, pt) {
  pt = (pt || '').toLowerCase();
  const l = label.toLowerCase();
  if (l === 'condo') return pt.includes('condo') || pt.includes('co-op');
  if (l === 'co-op') return pt.includes('co-op');
  if (l === 'multi-family') return pt.includes('multi-family') || pt.includes('multi family');
  if (l === 'single family') return pt.includes('single family');
  if (l === 'townhouse') return pt.includes('town');
  if (l === 'land') return pt.includes('land') || pt.includes('lot');
  return pt.includes(l);
}

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
    // Prefer the light index; if it 404s (not yet generated / partial deploy) fall back to the full
    // master feed so the grid+map never blank. Both share the { meta, listings:[…] } envelope.
    let res = await fetch(INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.listings || []).filter(l => l && l.geo && Number.isFinite(l.geo.lat));
    state.meta = data.meta || {};
  } catch (err) {
    state.all = [];
    state.meta = { error: String(err) };
    console.warn('listings load failed:', err);
  }
  // mls -> listing index so delegated card events can resolve the record without a DOM scan
  state.byMls = {};
  state.all.forEach(l => { state.byMls[l.mls] = l; });
  // default price ceiling stays "Any"; nothing preset
  buildTypeChecks();
  buildCityChecks();
  buildPriceSelects();
  initMap();
  readURL();
  render();
  const note = $('#sampleNote');
  // Show the "preview data" banner ONLY when the feed is not real MLS. A real feed's source is
  // "smartmls-rets"/"reso"; "sample"/"none" is placeholder. Test for the real ones, not an exact
  // string — the earlier `!== 'rets'` check left the demo banner up over live SmartMLS data.
  const src = (state.meta && state.meta.source) || 'none';
  const isLive = /rets|reso|smartmls/i.test(src);
  if (note) note.hidden = isLive;
  renderLegal();
}

/* ---------- filter UI construction ---------- */
function buildTypeChecks() {
  $('#typeCol').innerHTML = HOME_TYPES.map(t =>
    `<label class="chk"><input type="checkbox" value="${t}"> ${t}</label>`).join('');
}
// City multi-select — the distinct towns actually present in the feed (Stamford, Norwalk, …), sorted.
// A buyer open to "Stamford OR Norwalk" checks both and sees the combined results.
function buildCityChecks() {
  const cities = [...new Set(state.all.map(l => l.address && l.address.city).filter(Boolean))].sort();
  $('#cityCol').innerHTML = cities.map(c =>
    `<label class="chk"><input type="checkbox" value="${esc(c)}"> ${esc(c)}</label>`).join('');
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
    // The filter chips are short labels ("Single Family", "Condo"); the MLS propertyType is verbose
    // ("Single Family For Sale", "Condo/Co-Op For Sale"). Match by substring, not equality, or the
    // type filter silently returns nothing against real feed data.
    if (state.types.length && !state.types.some(t => propMatches(t, l.propertyType))) return false;
    if (state.cities.length && !state.cities.includes(l.address && l.address.city)) return false;
    // Max walk-minutes to nearest train. trainMinFor is memoized (l._trainMin) -> O(1) after the first
    // pass, and only evaluated when the filter is active (no cost when maxTrainMin is 0/Any).
    if (state.maxTrainMin && trainMinFor(l) > state.maxTrainMin) return false;
    if (q) {
      const hay = `${l.mls || ''} ${l.address.line || ''} ${l.address.city} ${l.address.neighborhood || ''} ${l.address.zip || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.bounds && !state.bounds.contains([l.geo.lat, l.geo.lng])) return false;
    // Draw-a-circle area filter. Mutually exclusive with state.bounds (setCircle nulls bounds); shares
    // haversineM with the train filter so the cutoff equals the drawn L.circle's edge exactly.
    if (state.circle && haversineM(state.circle.lat, state.circle.lng, l.geo.lat, l.geo.lng) > state.circle.radius) return false;
    if (state.savedOnly && !state.favs.has(l.mls)) return false;
    return true;
  });
  const s = state.sort;
  list.sort((a, b) =>
    s === 'price-asc' ? a.price - b.price :
    s === 'price-desc' ? b.price - a.price :
    s === 'beds' ? (b.beds || 0) - (a.beds || 0) :
    s === 'sqft' ? (b.sqft || 0) - (a.sqft || 0) :
    /* new */ new Date(b.listDate || b.updated || 0) - new Date(a.listDate || a.updated || 0));
  return list;
}

/* ---------- render ---------- */
function render() {
  const list = filtered();
  renderHead(list);
  renderCards(list);
  renderMarkers(list);
  renderSavedActions(list);   // the "Saved" view's action bar: text John, share, get alerts
  syncFilterChrome();
  syncURL();
}

/* ---------- Saved view → next step (text John / share / alerts) ---------- */
const PHONE_SMS = '+1' + PHONE;                                  // sms: wants E.164
const savedList = () => state.all.filter(l => state.favs.has(l.mls));

// A ready-to-send text to John listing the saved addresses + MLS #s — his lead, one tap.
function savedSmsHref(list) {
  const lines = list.slice(0, 25).map(l => `• ${addrFull(l)}${l.mls ? ` (MLS ${l.mls})` : ''}`).join('\n');
  const body = `Hi John, I'd like to schedule tours / ask about these saved Stamford listings:\n${lines}\n\n(sent from dtstamford.com)`;
  return `sms:${PHONE_SMS}?&body=${encodeURIComponent(body)}`;
}

function savedActionsHTML(list) {
  const n = list.length;
  // Account line: prompt sign-in when signed out, confirm sync when signed in. Only when accounts are on.
  const acct = !ACCOUNTS_ENABLED ? '' :
    _acctUser ? `<div class="sa-acct sa-acct-in">✓ Synced to your account — saved on every device.</div>`
              : `<div class="sa-acct"><button class="sa-btn sa-signin" type="button" data-acct-signin>${GOOGLE_G} Sign in to keep these forever</button></div>`;
  return `<div class="sa-head">💛 <b>${n}</b> saved ${n === 1 ? 'home' : 'homes'} — ready when you are.</div>
    ${acct}
    <div class="sa-btns">
      <a class="sa-btn sa-gold" href="${savedSmsHref(list)}">📅 Schedule tours · ask John</a>
      <button class="sa-btn" type="button" data-share-saved>↗ Share</button>
      <a class="sa-btn" href="homes-for-sale-stamford.html#alerts">🔔 Alert me to new ones like these</a>
    </div>`;
}

let _savedWired = false;
function renderSavedActions(list) {
  const el = $('#savedActions');
  if (!el) return;
  if (state.savedOnly && list.length) { el.innerHTML = savedActionsHTML(list); el.hidden = false; }
  else { el.innerHTML = ''; el.hidden = true; }
  if (_savedWired) return;
  _savedWired = true;                                            // delegate once — the bar's HTML is rebuilt each render
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-share-saved]');
    if (b) { e.preventDefault(); shareSaved(b); return; }
    if (e.target.closest('[data-acct-signin]')) { e.preventDefault(); acctSignIn(); }
  });
}

// Share the shortlist — native share sheet on mobile, clipboard fallback on desktop. Uses each listing's
// own indexable page URL so recipients land on a real, shareable page.
function shareSaved(btn) {
  const list = savedList();
  if (!list.length) return;
  const url = l => (l.slug ? `https://dtstamford.com/homes/${l.slug}.html` : 'https://dtstamford.com/search.html');
  const text = `Stamford homes I'm looking at:\n` + list.slice(0, 25).map(l => `${addrFull(l)} — ${url(l)}`).join('\n');
  if (navigator.share) {
    navigator.share({ title: 'Saved Stamford homes', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = '✓ Links copied';
      setTimeout(() => { btn.textContent = old; }, 1800);
    }).catch(() => prompt('Copy these links to share:', text));
  } else {
    prompt('Copy these links to share:', text);
  }
}

// Share ONE listing (the top-of-detail share icon) — native share sheet on mobile, clipboard fallback
// on desktop, using the listing's own indexable /homes/<slug>.html page.
function shareListing(l, btn) {
  const url = l.slug ? `https://dtstamford.com/homes/${l.slug}.html` : 'https://dtstamford.com/search.html';
  const title = `${priceLabel(l).replace(/<[^>]+>/g, '')} · ${addrFull(l)}`;
  if (navigator.share) {
    navigator.share({ title: 'Downtown Stamford', text: title, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1500); }
    }).catch(() => prompt('Copy this link:', url));
  } else {
    prompt('Copy this link:', url);
  }
}

function renderHead(list) {
  $('#count').textContent = list.length;
  $('#countLabel').textContent = state.type === 'rent' ? (list.length === 1 ? 'rental' : 'rentals') : (list.length === 1 ? 'home' : 'homes');
  $('#locLabel').textContent = state.q ? `in “${state.q}”` : 'in Stamford & nearby';
  // listings.json uses meta.updatedAt; the light index uses meta.syncedAt/generatedAt — accept any.
  const uRaw = state.meta && (state.meta.updatedAt || state.meta.syncedAt || state.meta.generatedAt);
  const u = uRaw ? new Date(uRaw) : null;
  $('#updated').textContent = u && !isNaN(u) ? `Updated ${u.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
}

function showSkeleton() {
  $('#cards').innerHTML = Array.from({ length: 6 }).map(() =>
    `<div class="sk"><div class="sk-media"></div><div class="sk-line"></div><div class="sk-line s"></div></div>`).join('');
}

// Paginated render. The full filtered list can be ~1,700 rows; painting them all at once froze the
// grid. We render in pages of PAGE_SIZE behind an IntersectionObserver sentinel: the first render
// resets #cards, subsequent pages are APPENDED (never a whole-list innerHTML on scroll) so scroll
// position and already-painted cards are untouched. Card events are delegated on #cards (wireCardsOnce),
// so appended cards need no per-card wiring.
let _io = null;
let _pageList = [];
let _pageShown = 0;

function renderCards(list) {
  const wrap = $('#cards'), empty = $('#empty');
  if (_io) { _io.disconnect(); _io = null; }   // tear down any observer from the previous filter set
  wrap.innerHTML = '';
  wireCardsOnce();                              // delegation lives on the container, wire before/after fill
  if (!list.length) { empty.hidden = false; return; }
  empty.hidden = true;
  _pageList = list;
  _pageShown = 0;
  // No IntersectionObserver (very old browser): paint everything so nothing is hidden.
  if (typeof IntersectionObserver === 'undefined') {
    wrap.insertAdjacentHTML('beforeend', list.map(cardHTML).join(''));
    _pageShown = list.length;
    return;
  }
  appendNextPage();
}

function appendNextPage() {
  const wrap = $('#cards');
  if (!wrap) return;
  const oldSentinel = $('#cardsMore');
  if (oldSentinel) oldSentinel.remove();       // the sentinel always sits at the end; re-add after appending
  const next = _pageList.slice(_pageShown, _pageShown + PAGE_SIZE);
  _pageShown += next.length;
  wrap.insertAdjacentHTML('beforeend', next.map(cardHTML).join(''));
  if (_pageShown < _pageList.length) {
    wrap.insertAdjacentHTML('beforeend',
      `<div id="cardsMore" class="cards-more" aria-hidden="true" style="grid-column:1/-1"></div>`);
    const sentinel = $('#cardsMore');
    if (_io) _io.disconnect();
    _io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) appendNextPage();
    }, { rootMargin: '600px 0px' });           // prefetch the next page before the user reaches the end
    _io.observe(sentinel);
  } else if (_io) {
    _io.disconnect();
    _io = null;                                // whole list rendered — stop observing
  }
}

function ppsf(l) {
  if (!l.sqft || !l.price || l.listingType === 'rent') return null;
  return Math.round(l.price / l.sqft);
}

function cardHTML(l) {
  const b = badgeFor(l);
  const idx = state.cardIndex[l.mls] || 0;
  const photos = photosOf(l);
  const fav = state.favs.has(l.mls);
  const dots = photos.length > 1 ? `<div class="card-dots">${photos.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : '';
  const navs = photos.length > 1 ? `<button class="card-nav prev" data-nav="-1" aria-label="Previous photo">‹</button><button class="card-nav next" data-nav="1" aria-label="Next photo">›</button>` : '';
  return `<article class="card" data-mls="${l.mls}">
    <div class="card-media">
      <img src="${esc(photos[idx])}" alt="${esc(addrFull(l))}" loading="lazy" decoding="async" onerror="this.src='assets/stamford-ct-single-family-home-exterior.jpg'">
      <div class="card-badges">${b ? `<span class="badge ${b.cls}">${b.txt}</span>` : ''}</div>
      <button class="card-fav ${fav ? 'on' : ''}" data-fav aria-label="Save home">${fav ? '♥' : '♡'}</button>
      ${navs}${dots}
    </div>
    <div class="card-body">
      <div class="card-price">${priceLabel(l)}</div>
      <div class="card-specs">${specRow(l)}</div>
      <div class="card-addr">${esc(addrFull(l))}</div>
      <div class="card-meta">${cardMeta(l)}</div>
    </div>
  </article>`;
}

// One clean spec row. Beds/baths/sqft for homes; lot size for land/commercial (where beds are 0).
function specRow(l) {
  const isLand = /land|lot|commercial/i.test(l.propertyType || '');
  const parts = [];
  if (!isLand) {
    parts.push(`<span><b>${l.beds != null ? l.beds : '—'}</b> bd</span>`);
    parts.push(`<span><b>${l.baths != null ? bathStr(l.baths) : '—'}</b> ba</span>`);
  }
  if (l.sqft) parts.push(`<span><b>${l.sqft.toLocaleString()}</b> sqft</span>`);
  else if (l.acres) parts.push(`<span><b>${l.acres}</b> ac</span>`);
  const psf = ppsf(l);
  if (psf) parts.push(`<span class="card-ppsf">$${psf}/sqft</span>`);
  return parts.join('');
}

// One subtle meta line: how long it's been listed + a short NYC-commute hint. Replaces the old
// heavy full-width commute band and the redundant brokerage footer (attribution already shows it).
function cardMeta(l) {
  const bits = [];
  if (l.daysOnMarket != null) bits.push(l.daysOnMarket === 0 ? 'Just listed' : `${l.daysOnMarket} days listed`);
  if (l.yearBuilt) bits.push(`Built ${l.yearBuilt}`);
  bits.push('~50 min to NYC');
  return bits.map(b => `<span>${esc(b)}</span>`).join('<i class="dot">·</i>');
}

// Delegated card events, wired ONCE on the #cards container. Wiring each of ~1,100 cards individually
// meant ~6,600 listeners plus an O(n²) document scan (a $('.card[data-mls=…]') per card right after the
// innerHTML write). One listener set resolves the listing by mls (state.byMls) and keeps working when
// cards are re-rendered, appended, or recycled.
let _cardsWired = false;
function wireCardsOnce() {
  if (_cardsWired) return;
  const wrap = $('#cards');
  if (!wrap) return;
  _cardsWired = true;
  wrap.addEventListener('click', e => {
    const el = e.target.closest('.card');
    if (!el) return;
    const l = state.byMls[el.dataset.mls];
    if (!l) return;
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.stopPropagation(); stepPhoto(l, parseInt(nav.dataset.nav, 10)); return; }
    if (e.target.closest('[data-fav]')) { e.stopPropagation(); toggleFav(l.mls); return; }
    openDetail(l);
  });
  // hover a card -> highlight its map pin. Delegated mouseover/out with a per-card guard reproduces the
  // old mouseenter/leave (fires once per card, not per descendant).
  wrap.addEventListener('mouseover', e => {
    const el = e.target.closest('.card');
    if (!el || el._hov) return;
    el._hov = true;
    highlightMarker(el.dataset.mls, true);
  }, { passive: true });
  wrap.addEventListener('mouseout', e => {
    const el = e.target.closest('.card');
    if (!el || el.contains(e.relatedTarget)) return;
    el._hov = false;
    highlightMarker(el.dataset.mls, false);
  }, { passive: true });
}

function stepPhoto(l, dir) {
  const photos = photosOf(l);
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
  cloudSave(mls, on);   // mirror to the signed-in account when accounts are on; no-op otherwise
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
  // Clustered markers. 1,100+ price pins on one screen was an unreadable dark blob; clustering
  // collapses dense areas into one count bubble that satisfyingly breaks apart as you zoom in.
  // Falls back to a plain layer group if the plugin didn't load (offline / CDN blocked).
  markerLayer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        // Below zoom 15, keep a readable 72px clump. At 15+ the radius drops to ~6px so clusters break
        // apart into individual pins as you zoom — and ONLY listings at (near) the same coordinates, i.e.
        // the same building, stay grouped (click the count to fan the units out).
        maxClusterRadius: (zoom) => (zoom >= 15 ? 6 : 72),
        chunkedLoading: true,
        iconCreateFunction: (cluster) => {
          const n = cluster.getChildCount();
          const size = n < 10 ? 34 : n < 50 ? 42 : n < 200 ? 52 : 62;
          return L.divIcon({
            html: `<div class="mk-cluster" style="width:${size}px;height:${size}px">${n}</div>`,
            className: '', iconSize: L.point(size, size),
          });
        },
      }).addTo(map)
    : L.layerGroup().addTo(map);
  let moved = false;
  map.on('movestart', () => { moved = true; });
  map.on('moveend', () => { if (moved) $('#searchHere').hidden = false; });
  $('#searchHere').addEventListener('click', () => {
    state.bounds = map.getBounds();
    // rectangle supersedes any drawn circle - the two area filters are mutually exclusive
    if (state.circle) { state.circle = null; if (drawnCircle) { map.removeLayer(drawnCircle); drawnCircle = null; } }
    $('#searchHere').hidden = true;
    render();
  });

  // ---- Draw-a-circle area tool ----
  const drawBtn = $('#drawArea');
  if (drawBtn) drawBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (drawMode) { exitDrawMode(); if (drawnCircle && !state.circle) { map.removeLayer(drawnCircle); drawnCircle = null; } }
    else enterDrawMode();
  });
  const clearBtn = $('#clearArea');
  if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearCircle(); });

  // Mouse draw (desktop): Leaflet supplies e.latlng on each event.
  map.on('mousedown', (e) => { if (drawMode) { L.DomEvent.preventDefault(e.originalEvent); drawStart(e.latlng); } });
  map.on('mousemove', (e) => { if (drawMode && _drawStart) drawMove(e.latlng); });
  map.on('mouseup',   (e) => { if (drawMode && _drawStart) drawEnd(e.latlng); });

  // Touch draw (mobile map view): Leaflet's synthetic mouse events don't cover a touch-drag, so map raw
  // container touches to latlng ourselves and preventDefault so the page/map doesn't scroll while drawing.
  const mc = map.getContainer();
  mc.addEventListener('touchstart', (e) => { if (!drawMode || !e.touches[0]) return; e.preventDefault(); drawStart(map.mouseEventToLatLng(e.touches[0])); }, { passive: false });
  mc.addEventListener('touchmove', (e) => { if (!drawMode || !_drawStart || !e.touches[0]) return; e.preventDefault(); drawMove(map.mouseEventToLatLng(e.touches[0])); }, { passive: false });
  mc.addEventListener('touchend', (e) => { if (!drawMode || !_drawStart) return; e.preventDefault(); drawEnd(map.mouseEventToLatLng(e.changedTouches[0])); }, { passive: false });
}

/* ---------- draw-a-circle area tool ---------- */
function enterDrawMode() {
  if (!map) return;
  drawMode = true;
  map.dragging.disable(); map.doubleClickZoom.disable();
  L.DomUtil.addClass(map.getContainer(), 'drawing');
  const b = $('#drawArea'); if (b) { b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true'); }
}
function exitDrawMode() {
  drawMode = false;
  if (map) { map.dragging.enable(); map.doubleClickZoom.enable(); L.DomUtil.removeClass(map.getContainer(), 'drawing'); }
  const b = $('#drawArea'); if (b) { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); }
}
function drawStart(latlng) {
  if (!drawMode) return;
  _drawStart = latlng;
  if (drawnCircle) { map.removeLayer(drawnCircle); drawnCircle = null; }
  drawnCircle = L.circle(latlng, { radius: 0, className: 'draw-circle', color: '#cbab68', weight: 2, fillColor: '#cbab68', fillOpacity: .12, interactive: false }).addTo(map);
}
function drawMove(latlng) {
  if (!drawMode || !_drawStart || !drawnCircle) return;
  drawnCircle.setRadius(_drawStart.distanceTo(latlng));   // meters (Leaflet spherical) - matches haversineM
}
function drawEnd(latlng) {
  if (!drawMode || !_drawStart) return;
  const center = _drawStart, r = _drawStart.distanceTo(latlng || _drawStart);
  _drawStart = null;
  exitDrawMode();
  if (r < 30) { if (drawnCircle) { map.removeLayer(drawnCircle); drawnCircle = null; } return; }   // a tap, not a drag -> cancel
  setCircle({ lat: +center.lat.toFixed(6), lng: +center.lng.toFixed(6), radius: Math.round(r) });
}
// Commit a circle filter (fresh draw OR URL restore). Clears the rectangle bounds - mutually exclusive.
function setCircle(c) {
  state.circle = c;
  state.bounds = null;
  const sh = $('#searchHere'); if (sh) sh.hidden = true;
  drawCircleOverlay();
  render();
}
function clearCircle() {
  state.circle = null;
  if (drawnCircle && map) { map.removeLayer(drawnCircle); drawnCircle = null; }
  render();
}
// (Re)paint the persisted overlay from state.circle - after a URL load and to normalize a fresh circle.
function drawCircleOverlay() {
  if (!map) return;
  if (drawnCircle) { map.removeLayer(drawnCircle); drawnCircle = null; }
  if (!state.circle) return;
  drawnCircle = L.circle([state.circle.lat, state.circle.lng], { radius: state.circle.radius, className: 'draw-circle', color: '#cbab68', weight: 2, fillColor: '#cbab68', fillOpacity: .12, interactive: false }).addTo(map);
}

function renderMarkers(list) {
  markerLayer.clearLayers();
  markers = {};
  const pts = [];
  const batch = [];
  list.forEach(l => {
    const compact = l.listingType === 'rent'
      ? '$' + (l.price >= 1000 ? (l.price / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : l.price)
      : (l.price >= 1e6 ? '$' + (l.price / 1e6).toFixed(l.price >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(l.price / 1000) + 'k');
    const fav = state.favs.has(l.mls) ? ' fav' : '';
    const icon = L.divIcon({
      className: '', html: `<div class="price-pin${fav}" data-mls="${esc(l.mls)}">${compact}</div>`,
      iconSize: null,
    });
    const m = L.marker([l.geo.lat, l.geo.lng], { icon, riseOnHover: true });
    m.on('click', () => openDetail(l));
    m.on('mouseover', () => highlightCard(l.mls, true));
    m.on('mouseout', () => highlightCard(l.mls, false));
    markers[l.mls] = m;
    batch.push(m);
    pts.push([l.geo.lat, l.geo.lng]);
  });
  // One batched add — with a cluster group, per-marker addTo() rebuilds the whole cluster each time.
  if (markerLayer.addLayers) markerLayer.addLayers(batch);
  else batch.forEach(m => m.addTo(markerLayer));
  state._pts = pts;   // stored so fitAllMarkers() can re-fit when the map becomes visible
  // Also skip auto-fit while a circle is active, so drawing one doesn't zoom the viewport away from it.
  if (pts.length && !state.bounds && !state.circle) {
    try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); } catch (e) {}
  }
  setTimeout(() => map.invalidateSize(), 60);
}

// Fit the map to show EVERY filtered listing on one screen. Needed because on mobile the map
// starts hidden (0-size) in List view, so its first fitBounds runs against a broken viewport and
// the map opens zoomed into one random spot. When the user taps Map we resize the container, then
// fit to all current markers so "show me everything under my criteria" actually works.
function fitAllMarkers() {
  if (!map) return;
  setTimeout(() => {
    map.invalidateSize();
    const pts = state._pts || [];
    if (!pts.length) return;
    try { map.fitBounds(pts, { padding: [36, 36], maxZoom: 14 }); } catch (e) {}
  }, 130);   // after the container has actually painted at its new size
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
// A monotonically increasing token guards the async detail fetch: if the drawer is closed or a
// different listing is opened while a fetch is in flight, the stale response is dropped instead of
// rendering into the wrong (or closed) drawer.
let _drawerToken = 0;
let _drawerHistOpen = false;   // one history entry per drawer session, so hardware Back closes the detail

// Public entry. The light index record carries only primaryPhoto + no remarks, so we lazy-fetch the
// per-listing detail JSON, merge it into the record in place (so state.byMls / cards see the richer
// data too), then render. The drawer is shown immediately with a loading state so it never hangs; if
// the fetch fails we fall back to rendering whatever we already have (graceful, never blank).
async function openDetail(l) {
  // Push one poppable history entry (guarded so opening B over A doesn't stack) — hardware/browser
  // Back then pops it and closes the detail instead of navigating away. '' URL keeps the address bar.
  if (!_drawerHistOpen) { _drawerHistOpen = true; history.pushState({ drawer: true }, ''); }
  const token = ++_drawerToken;
  const needsDetail = l && l.slug && !l._detailLoaded &&
    (!(l.photos && l.photos.length) || l.remarks == null);
  if (!needsDetail) { renderDrawer(l); return; }
  openDrawerShell();
  try {
    const res = await fetch(detailURL(l.slug), { cache: 'no-cache' });
    if (res.ok) {
      const full = await res.json();
      Object.assign(l, full);      // hydrate in place; byMls + the card keep pointing at this record
      l._detailLoaded = true;
    } else {
      console.warn('detail load failed: HTTP ' + res.status);
    }
  } catch (err) {
    console.warn('detail load failed:', err);
  }
  if (token !== _drawerToken) return;   // superseded by a newer open/close — don't clobber the drawer
  renderDrawer(l);
}

// Open the drawer chrome immediately with a loading placeholder, before the detail fetch resolves.
function openDrawerShell() {
  $('#drawerBody').innerHTML =
    '<div class="d-loading" role="status" aria-live="polite"><span class="d-spin" aria-hidden="true"></span>Loading listing…</div>';
  $('#scrim').hidden = false;
  requestAnimationFrame(() => { $('#scrim').classList.add('show'); $('#drawer').classList.add('show'); });
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer').focus();
}

function renderDrawer(l) {
  const photos = photosOf(l);
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
  const mapsQ = encodeURIComponent(l.address.line ? `${l.address.line}, ${l.address.city}, ${l.address.state} ${l.address.zip || ''}` : `${l.address.city}, ${l.address.state}`);
  const mailBody = encodeURIComponent(`Hi John, I'm interested in ${addrFull(l)} (MLS #${l.mls}, ${money(l.price)}). Can we set up a tour?`);

  $('#drawerBody').innerHTML = `
    <div class="d-gallery">
      <img id="dImg" src="${esc(photos[0])}" alt="${esc(addrFull(l))}" decoding="async" onerror="this.src='assets/stamford-ct-single-family-home-exterior.jpg'">
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
      <div class="d-addr">${esc(addrFull(l))}${l.address.zip ? ' '+esc(l.address.zip) : ''}</div>
      ${l.address.neighborhood ? `<div class="d-hood">${esc(l.address.neighborhood)}</div>` : ''}
      <div class="d-commute" title="Estimated Metro-North commute — see stamford-to-nyc-commute.html">${esc(commuteFor(l))}</div>
      <div class="d-cta">
        <a class="btn btn-gold" href="tel:${PHONE}">Call John · 203·883·3399</a>
        <a class="btn btn-act" href="mailto:${EMAIL}?subject=${encodeURIComponent('Tour request: ' + addrFull(l))}&body=${mailBody}">Request a tour</a>
        <button class="btn btn-out" data-fav="${esc(l.mls)}">${fav ? '♥ Saved' : '♡ Save'}</button>
        <button class="btn btn-out d-cta-share" id="dShare" aria-label="Share this listing" title="Share this listing"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg></button>
      </div>
      ${l.remarks ? `<div class="d-section"><h4>About this home</h4><p class="d-remarks">${esc(deEnt(l.remarks))}</p></div>` : ''}
      <div class="d-section"><h4>Facts &amp; features</h4>
        <div class="d-facts">${facts.map(f => `<div class="d-fact"><span>${esc(f[0])}</span><b>${esc(f[1])}</b></div>`).join('')}</div>
      </div>
      ${(l.features && l.features.length) ? `<div class="d-section"><h4>Highlights</h4><div class="d-feats">${l.features.map(f => `<span class="d-feat">${esc(f)}</span>`).join('')}</div></div>` : ''}
      <div class="d-section"><h4>Location</h4><div class="d-map" id="dMap"></div>
        ${l.address.line ? `<a class="d-directions" href="https://www.google.com/maps/dir/?api=1&destination=${mapsQ}" target="_blank" rel="noopener">🧭 Get directions · drive by</a>` : ''}
      </div>
      ${mlsAttrib(l)}
      <div class="d-legal">${state.meta && state.meta.disclaimer ? esc(state.meta.disclaimer) : (state.meta && state.meta.attribution ? esc(state.meta.attribution) : '')}
        ${l.slug ? `<br><a class="d-seo-link" href="homes/${esc(l.slug)}.html">View full listing page ↗</a>` : ''}
      </div>
    </div>`;

  // gallery nav
  const setG = () => { $('#dImg').src = photos[gi]; const c = $('#dCount'); if (c) c.textContent = `${gi + 1} / ${photos.length}`; };
  $('#dPrev') && $('#dPrev').addEventListener('click', () => { gi = (gi - 1 + photos.length) % photos.length; setG(); });
  $('#dNext') && $('#dNext').addEventListener('click', () => { gi = (gi + 1) % photos.length; setG(); });
  $('#drawerBody').querySelector('[data-fav]').addEventListener('click', () => toggleFav(l.mls));
  $('#dShare') && $('#dShare').addEventListener('click', () => shareListing(l, $('#dShare')));
  $('#dImg') && $('#dImg').addEventListener('click', () => openFS(photos, gi));   // tap photo → full-screen viewer

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
function teardownDrawer() {
  closeFS();        // dismiss the full-screen photo viewer if it's open (covers every close route)
  _drawerToken++;   // invalidate any in-flight detail fetch so it won't render into a closed drawer
  $('#drawer').classList.remove('show');
  $('#scrim').classList.remove('show');
  $('#drawer').setAttribute('aria-hidden', 'true');
  setTimeout(() => { $('#scrim').hidden = true; $('#drawerBody').innerHTML = ''; }, 400);
}
function closeDetail() {
  if (_drawerHistOpen) { history.back(); }   // symmetric with the pushState on open → popstate tears down
  else { teardownDrawer(); }                 // fallback when no history entry was pushed
}

/* ---------- full-screen photo viewer (lightbox) ---------- */
let _fs = null, _fsPhotos = [], _fsI = 0;
function ensureFS() {
  if (_fs) return _fs;
  _fs = document.createElement('div');
  _fs.className = 'photo-fs';
  _fs.setAttribute('role', 'dialog');
  _fs.setAttribute('aria-modal', 'true');
  _fs.setAttribute('aria-label', 'Photo viewer');
  _fs.innerHTML =
    '<button class="photo-fs-close" aria-label="Close photos">✕</button>' +
    '<button class="photo-fs-nav prev" aria-label="Previous photo">‹</button>' +
    '<img alt="">' +
    '<button class="photo-fs-nav next" aria-label="Next photo">›</button>' +
    '<div class="photo-fs-count"></div>';
  document.body.appendChild(_fs);
  const img = _fs.querySelector('img');
  _fs.querySelector('.photo-fs-close').addEventListener('click', closeFS);
  _fs.querySelector('.prev').addEventListener('click', e => { e.stopPropagation(); stepFS(-1); });
  _fs.querySelector('.next').addEventListener('click', e => { e.stopPropagation(); stepFS(1); });
  _fs.addEventListener('click', e => { if (e.target === _fs) closeFS(); });
  let x0 = null, y0 = null;
  img.addEventListener('touchstart', e => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  img.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) stepFS(dx < 0 ? 1 : -1);
    x0 = y0 = null;
  }, { passive: true });
  return _fs;
}
function setFS() {
  _fs.querySelector('img').src = _fsPhotos[_fsI];
  _fs.querySelector('.photo-fs-count').textContent = `${_fsI + 1} / ${_fsPhotos.length}`;
  const multi = _fsPhotos.length > 1 ? '' : 'none';
  _fs.querySelector('.prev').style.display = multi;
  _fs.querySelector('.next').style.display = multi;
  _fs.querySelector('.photo-fs-count').style.display = multi;
}
function stepFS(dir) { const n = _fsPhotos.length; _fsI = (_fsI + dir + n) % n; setFS(); }
function openFS(photos, i) {
  if (!photos || !photos.length) return;
  ensureFS(); _fsPhotos = photos; _fsI = i || 0; setFS();
  requestAnimationFrame(() => _fs.classList.add('show'));
  document.body.style.overflow = 'hidden';
}
function closeFS() {
  if (!_fs) return;
  _fs.classList.remove('show');
  document.body.style.overflow = '';
}

/* ---------- IDX legal ---------- */
function renderLegal() {
  // Only claim MLS provenance when MLS data is actually on the page. Crediting SmartMLS with
  // zero listings displayed is a false attribution — and the hardcoded fallback below used to
  // fire even when listings.json was empty.
  const el = $('#idxLegal');
  if (!el) return;
  if (!(state.all && state.all.length)) { el.innerHTML = ''; return; }
  const a = (state.meta && state.meta.attribution) || 'Listing data provided courtesy of SmartMLS. Information deemed reliable but not guaranteed.';
  el.innerHTML = `<strong>MLS disclosure.</strong> ${esc(a)} Listings are subject to prior sale, change, or withdrawal. © ${new Date().getFullYear()} SmartMLS, Inc. Displayed by John Restrepo, licensed CT real estate agent. Equal Housing Opportunity.`;
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
  const cityBtn = $('.drop[data-drop="city"] .drop-btn');
  if (cityBtn) {
    cityBtn.classList.toggle('has-val', state.cities.length > 0);
    $('.drop[data-drop="city"] .drop-lbl').textContent = state.cities.length ? `${state.cities.length} cit${state.cities.length > 1 ? 'ies' : 'y'}` : 'City';
  }
  const trainBtn = $('.drop[data-drop="train"] .drop-btn');
  if (trainBtn) {
    trainBtn.classList.toggle('has-val', !!state.maxTrainMin);
    $('.drop[data-drop="train"] .drop-lbl').textContent = state.maxTrainMin ? `≤ ${state.maxTrainMin} min` : 'Train';
  }
  // circle area filter: the map's Clear-area button tracks state.circle each render (folded in here
  // instead of a separate syncAreaChrome()/render() edit).
  const clearAreaBtn = $('#clearArea'); if (clearAreaBtn) clearAreaBtn.hidden = !state.circle;
  const sortNames = { new: 'Newest', 'price-asc': 'Price ↑', 'price-desc': 'Price ↓', beds: 'Most beds', sqft: 'Largest' };
  $('.drop[data-drop="sort"] .drop-lbl').textContent = 'Sort: ' + sortNames[state.sort];

  // active-filter count badge (search + price + beds/baths + type + city + train + area circle)
  const activeCount = (state.q ? 1 : 0) + ((state.priceMin || state.priceMax) ? 1 : 0) +
    ((state.beds || state.baths) ? 1 : 0) + (state.types.length ? 1 : 0) + (state.cities.length ? 1 : 0) +
    (state.maxTrainMin ? 1 : 0) + (state.circle ? 1 : 0);
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
  // Place a fixed-position dropdown under its button, clamped so no edge runs off-screen.
  // The panel is position:fixed, but the filter bar's backdrop-filter makes .fb-inner the CONTAINING
  // BLOCK for fixed descendants — so "fixed" coords are relative to that box, not the viewport, and the
  // panel drifted ~90px below/right of its button. Find the nearest such ancestor and subtract its
  // offset so the panel lands exactly under the button.
  function fixedCB(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none' ||
          s.backdropFilter !== 'none' || /transform|filter/.test(s.willChange)) return p.getBoundingClientRect();
    }
    return null;
  }
  function positionPanel(btn, panel) {
    const b = btn.getBoundingClientRect();
    const cb = fixedCB(panel);
    const ox = cb ? cb.left : 0, oy = cb ? cb.top : 0;
    panel.style.top = Math.round(b.bottom + 10 - oy) + 'px';
    // measure width with left temporarily set, then clamp horizontally
    panel.style.left = '0px';
    const pw = panel.offsetWidth;
    const left = Math.max(10, Math.min(b.left, window.innerWidth - pw - 10));
    panel.style.left = Math.round(left - ox) + 'px';
  }
  // keep an open panel glued to its button on resize/scroll
  window.addEventListener('resize', () => {
    const d = document.querySelector('.drop.is-active');
    if (d) positionPanel(d.querySelector('.drop-btn'), d.querySelector('.drop-panel'));
  });

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
        if (panel) positionPanel(btn, panel);
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

  // account control (Sign in with Google). Signed out: click signs in. Signed in: click toggles a
  // small menu holding "Sign out". Harmless when accounts are off — #acctWrap stays hidden.
  const acctBtn = $('#acctBtn'), acctMenu = $('#acctMenu');
  if (acctBtn) {
    acctBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!_acctUser) { acctSignIn(); return; }
      const open = acctMenu && !acctMenu.hidden;
      if (acctMenu) acctMenu.hidden = open;
      acctBtn.setAttribute('aria-expanded', String(!open));
    });
  }
  if (acctMenu) {
    acctMenu.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('[data-acct-out]')) { acctSignOut(); acctMenu.hidden = true; }
    });
    document.addEventListener('click', () => { acctMenu.hidden = true; if (acctBtn) acctBtn.setAttribute('aria-expanded', 'false'); });
  }

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
  $('#cityCol').addEventListener('change', () => {
    state.cities = $$('#cityCol input:checked').map(i => i.value); render();
  });

  // sort radios
  $$('#sortCol .radx').forEach(r => r.addEventListener('click', () => {
    state.sort = r.dataset.sort;
    $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x === r));
    render(); closeDrops();
  }));
  // train walk-time radios (mirrors the sort radios: pick one, re-render, close)
  $$('#trainCol .radx').forEach(r => r.addEventListener('click', () => {
    state.maxTrainMin = +r.dataset.train;
    $$('#trainCol .radx').forEach(x => x.classList.toggle('is-on', x === r));
    render(); closeDrops();
  }));

  // clear buttons
  $$('[data-clear]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.clear;
    if (k === 'price') { state.priceMin = 0; state.priceMax = 0; buildPriceSelects(); }
    if (k === 'beds') { state.beds = 0; state.baths = 0; $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.beds === '0')); $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.baths === '0')); }
    if (k === 'type') { state.types = []; $$('#typeCol input').forEach(i => i.checked = false); }
    if (k === 'city') { state.cities = []; $$('#cityCol input').forEach(i => i.checked = false); }
    render();
  }));

  // filter badge click = same as reset
  $('#filterBadge').addEventListener('click', () => $('#resetBtn').click());

  // reset (note: intentionally does NOT clear the Saved view — that's a separate lens, not a filter)
  $('#resetBtn').addEventListener('click', () => {
    Object.assign(state, { q: '', priceMin: 0, priceMax: 0, beds: 0, baths: 0, types: [], cities: [], maxTrainMin: 0, sort: 'new', bounds: null, circle: null });
    if (drawnCircle && map) { map.removeLayer(drawnCircle); drawnCircle = null; }
    $('#q').value = '';
    buildPriceSelects();
    $$('#bedsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.beds === '0'));
    $$('#bathsRow .pillx').forEach(x => x.classList.toggle('is-on', x.dataset.baths === '0'));
    $$('#typeCol input').forEach(i => i.checked = false);
    $$('#cityCol input').forEach(i => i.checked = false);
    $$('#trainCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.train === '0'));
    $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.sort === 'new'));
    render();
  });

  // view toggle
  $$('.vt-btn').forEach(v => v.addEventListener('click', () => {
    state.view = v.dataset.view;
    $$('.vt-btn').forEach(x => x.classList.toggle('is-on', x === v));
    $('#app').dataset.view = state.view;
    if (state.view === 'map') {
      // "Show me all my listings on one map." Clear any previously-panned bounds and re-render so
      // the full filtered set is on the map, then fit to all of them once the container is sized.
      state.bounds = null;
      const sh = $('#searchHere'); if (sh) sh.hidden = true;
      render();
      fitAllMarkers();
    } else if (map) {
      setTimeout(() => map.invalidateSize(), 80);
    }
    syncURL();
  }));

  // On a phone, "Split" (map + list side by side) has no room — fall back to List so the whole
  // screen is homes, with Map as its own full-screen mode. Only converts the default 'split';
  // an explicit Map/List choice is left alone.
  function applyMobileView() {
    if (window.innerWidth <= 760 && state.view === 'split') {
      state.view = 'list';
      $$('.vt-btn').forEach(x => x.classList.toggle('is-on', x.dataset.view === 'list'));
      $('#app').dataset.view = 'list';
      if (map) setTimeout(() => map.invalidateSize(), 80);
    }
  }
  applyMobileView();
  window.addEventListener('resize', applyMobileView);

  // drawer close
  $('#drawerClose').addEventListener('click', closeDetail);
  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => {
    if (_fs && _fs.classList.contains('show')) {                  // lightbox open → it owns the keys
      if (e.key === 'Escape') { closeFS(); return; }
      if (e.key === 'ArrowLeft') { stepFS(-1); return; }
      if (e.key === 'ArrowRight') { stepFS(1); return; }
      return;
    }
    if (e.key === 'Escape' && drawMode) { exitDrawMode(); if (drawnCircle && !state.circle) { map.removeLayer(drawnCircle); drawnCircle = null; } return; }
    if (e.key === 'Escape') { closeDrops(); closeDetail(); }
  });
  // hardware/browser Back (or the history.back() from closeDetail) pops our entry → tear the drawer down,
  // page stays put. Flag cleared so the next open pushes a fresh entry.
  window.addEventListener('popstate', () => {
    if (_drawerHistOpen) { _drawerHistOpen = false; teardownDrawer(); }
  });
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
  if (state.cities.length) p.set('ci', state.cities.join(','));
  if (state.maxTrainMin) p.set('train', state.maxTrainMin);
  if (state.sort !== 'new') p.set('s', state.sort);
  if (state.view !== 'split') p.set('v', state.view);
  if (state.circle) p.set('circle', `${state.circle.lat},${state.circle.lng},${state.circle.radius}`);
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
  if (p.get('ci')) { state.cities = p.get('ci').split(','); $$('#cityCol input').forEach(i => i.checked = state.cities.includes(i.value)); }
  if (p.get('train')) { state.maxTrainMin = +p.get('train'); $$('#trainCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.train === p.get('train'))); }
  if (p.get('s')) { state.sort = p.get('s'); $$('#sortCol .radx').forEach(x => x.classList.toggle('is-on', x.dataset.sort === state.sort)); }
  if (p.get('v')) { state.view = p.get('v'); $$('.vt-btn').forEach(x => x.classList.toggle('is-on', x.dataset.view === state.view)); $('#app').dataset.view = state.view; }
  if (p.get('circle')) {
    const c = p.get('circle').split(',').map(Number);
    if (c.length === 3 && c.every(Number.isFinite) && c[2] > 0) { state.circle = { lat: c[0], lng: c[1], radius: c[2] }; drawCircleOverlay(); }
  }
}

/* CSS.escape shim for attribute selectors (MLS ids are alnum, but be safe) */
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* ---------- boot ---------- */
wireControls();
load();
initAccounts();   // lazy Supabase auth; no-op + zero network unless ACCOUNTS_ENABLED
