/* Hive Mind web tracker — DTStamford.com.
   Captures page views, real clicks (what visitors tap), traffic source (UTM + referrer), device, OS and
   browser into the Supabase `web_events` table. Privacy-light: no cookies, a random session id in
   sessionStorage, no PII beyond what you pass to HiveTrack.signup().

   The anon key below is the PUBLISHABLE key — insert-only by design (RLS blocks reads), safe to ship.

   YOUR OWN VISITS ARE EXCLUDED: open any page once with ?owner=1 to stop counting yourself on this
   browser (persists in localStorage). Use ?owner=0 to start counting again.

   INSTALL: this file is served at /track.js and included before </body> on every page. On a sign-up
   success, call:  HiveTrack.signup({ email, name })
*/
(function () {
  var SUPABASE_URL = 'https://ltihgxyzmgrikonlcrhy.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_BBpnL4fstiTa_NozI9AWeA_aftyztov';   // publishable (insert-only) — NOT the service key
  var SITE = 'dtstamford';

  // ---- owner exclusion: ?owner=1 marks this browser as John's so his own traffic never counts ----
  function isOwner() {
    try {
      var o = new URLSearchParams(location.search).get('owner');
      if (o === '1') localStorage.setItem('ht_owner', '1');
      else if (o === '0') localStorage.removeItem('ht_owner');
      return localStorage.getItem('ht_owner') === '1';
    } catch (e) { return false; }
  }
  var OWNER = isOwner();

  function sid() {
    try {
      var k = 'ht_sid', v = sessionStorage.getItem(k);
      if (!v) { v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); sessionStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'nostore'; }
  }
  function q(name) { try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; } }
  function device() {
    var ua = navigator.userAgent || '';
    if (/ipad|tablet/i.test(ua)) return 'tablet';
    if (/mobile|iphone|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function os() { var ua = navigator.userAgent; return /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : 'other'; }
  function browser() { var ua = navigator.userAgent; return /edg/i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'other'; }
  function source() {
    var s = q('utm_source'); if (s) return s;
    var ref = document.referrer || '';
    if (!ref) return 'direct';
    try { var h = new URL(ref).hostname.replace(/^www\./, ''); return h === location.hostname ? 'internal' : h; } catch (e) { return 'referral'; }
  }

  var REPORTED = false;   // one-shot guard: a broken endpoint logs once, not once per event

  function send(type, extra) {
    if (OWNER) return;   // never count the agent's own visits/clicks
    var body = Object.assign({
      site: SITE, type: type, path: location.pathname + location.search,
      referrer: document.referrer || '', source: source(),
      medium: q('utm_medium') || '', campaign: q('utm_campaign') || '',
      device: device(), os: os(), browser: browser(),
      country: null, city: null,   // filled server-side by an optional geo edge function; null is fine
      session_id: sid()
    }, extra || {});
    try {
      fetch(SUPABASE_URL + '/rest/v1/web_events', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (res.ok) { window.__trackOk = true; return; }
        // A dropped write used to be invisible: the table was never created, so every visit since
        // 2026-07-07 was discarded while the client looked perfectly healthy. Surface it ONCE per
        // page load with the PostgREST code (PGRST205 = relation does not exist).
        if (REPORTED) return; REPORTED = true;
        res.text().then(function (t) { fail(res.status, t); }, function () { fail(res.status, ''); });
      }, function (err) {
        if (REPORTED) return; REPORTED = true;
        fail(0, (err && err.message) ? err.message : String(err));
      });
    } catch (e) { fail(-1, (e && e.message) ? e.message : String(e)); }
  }

  // One-shot, loud, and inspectable. window.__trackError lets a synthetic check assert the
  // FAILURE state, not just the happy path — a check that can't see "silently broken" isn't a check.
  function fail(status, detail) {
    window.__trackError = { status: status, detail: detail || '', at: new Date().toISOString() };
    try {
      console.error('[track] web_events write FAILED — HTTP ' + status + ' — ' + (detail || '(no body)') +
        (String(detail).indexOf('PGRST205') >= 0 ? '  ← the web_events table does not exist' : ''));
    } catch (e) {}
  }

  // ---- click capture: which links/buttons visitors actually tap ("where they click") ----
  // Only meaningful targets (links, buttons, [data-track]) are recorded, so the data stays clean.
  // Throttled to one event / 300ms and capped per page load so a rage-clicker can't flood the table.
  function clickTarget(el) {
    var n = el, hops = 0;
    while (n && hops < 5) {
      if (n.matches && n.matches('a,button,[data-track],[role="button"],input[type="submit"],input[type="button"]')) return n;
      n = n.parentElement; hops++;
    }
    return null;
  }
  var lastClick = 0, clickCount = 0;
  document.addEventListener('click', function (e) {
    if (OWNER) return;
    var now = Date.now();
    if (now - lastClick < 300 || clickCount >= 60) return;   // throttle + per-page cap
    var t = clickTarget(e.target); if (!t) return;
    lastClick = now; clickCount++;
    var label = (t.getAttribute('data-track') || t.getAttribute('aria-label') || (t.textContent || '').trim() || t.getAttribute('href') || t.tagName || 'element');
    label = String(label).replace(/\s+/g, ' ').slice(0, 80);
    // record the clicked label in `path` so the dashboard's group-by-path powers "Top clicks"
    send('click', { path: label });
  }, { passive: true, capture: true });

  window.HiveTrack = {
    pageview: function () { send('pageview'); },
    signup: function (info) { send('signup', { email: (info && info.email) || null, name: (info && info.name) || null }); },
    event: function (name, extra) { send(name, extra); }
  };
  // auto page view on load + on SPA route changes
  window.HiveTrack.pageview();
  var _pp = history.pushState;
  history.pushState = function () { _pp.apply(this, arguments); clickCount = 0; window.HiveTrack.pageview(); };
  window.addEventListener('popstate', function () { clickCount = 0; window.HiveTrack.pageview(); });
})();
