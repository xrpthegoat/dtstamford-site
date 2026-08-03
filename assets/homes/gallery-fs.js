/* gallery-fs.js — full-screen photo viewer for the static /homes/<slug>.html listing pages.
 *
 * WHY THIS FILE EXISTS
 * The search app (search.html + assets/homes/app.js) has had a working `.photo-fs` lightbox since
 * day one — but app.js is the whole mini-Zillow SPA (ES module, ~70KB) and assumes #cards / #scrim /
 * #drawer / Leaflet, none of which exist on a generated listing page. So the viewer functions
 * (ensureFS/setFS/stepFS/openFS/closeFS, app.js:964-1014) are PORTED here as a tiny standalone
 * script. Same `.photo-fs*` class names, so the CSS already shipped in app.css:336-347 — which every
 * listing page already links but never used — styles it, and the viewer looks and behaves EXACTLY
 * like the one on /search.html.
 *
 * WHAT IT ADDS OVER THE app.js ORIGINAL (all of it phone-first / a11y):
 *   · reads the full photo list from <script type="application/json" id="idx-photos"> that
 *     genlistings.py inlines into the page (no fetch → no CORS/offline/race failure mode), with a
 *     fall back to the 5 <img> already in the DOM so a click can never be dead
 *   · opens on the photo that was CLICKED, not always #1
 *   · lazy: nothing beyond the 5 previews is requested until the viewer opens; then only the
 *     neighbours (±1) of the current photo are preloaded
 *   · per-photo loading state + a broken-image message (SmartMLS CDN HD JPEGs are big)
 *   · body scroll lock that survives iOS Safari (position:fixed + restore scrollY), focus trap,
 *     focus returned to the thumbnail that opened it, prefers-reduced-motion
 *   · live-drag swipe (the original was threshold-only) and Android/gesture Back closes the viewer
 *
 * Loaded with `defer` from genlistings.py's detail_page(); it self-initialises and no-ops on any
 * page without an #idxGallery.
 */
(function () {
  'use strict';

  // helpers — same shape as app.js:219-225
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var gallery = $('#idxGallery');
  if (!gallery) return;                       // not a listing page — nothing to do

  // ---------- photo list ----------------------------------------------------------------
  // Primary source: the JSON island genlistings.py inlines. It is `type="application/json"`, i.e.
  // inert data, never executed — parsed with JSON.parse.
  var photos = [];
  try {
    var island = $('#idx-photos');
    if (island) {
      var parsed = JSON.parse(island.textContent || '[]');
      if (Array.isArray(parsed)) photos = parsed.filter(function (p) { return typeof p === 'string' && p; });
    }
  } catch (e) { photos = []; }               // malformed island → fall through to the DOM

  // Fallback: whatever the preview grid is already showing. Guarantees a click is never dead.
  if (!photos.length) {
    photos = $$('.idx-shot > img', gallery).map(function (im) { return im.currentSrc || im.src; })
      .filter(Boolean);
  }
  if (!photos.length) return;                 // 0-photo listing (placeholder art only) — no viewer

  var altBase = gallery.getAttribute('data-alt') || '';
  var N = photos.length;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- viewer state --------------------------------------------------------------
  var fs = null, fsImg = null, fsCount = null, fsPrev = null, fsNext = null, fsClose = null, fsNote = null;
  var idx = 0, opener = null, scrollY = 0, histOpen = false, loadTok = 0;

  function build() {
    if (fs) return fs;
    fs = document.createElement('div');
    fs.className = 'photo-fs idx-fs';
    fs.setAttribute('role', 'dialog');
    fs.setAttribute('aria-modal', 'true');
    fs.setAttribute('aria-label', altBase ? ('Photos — ' + altBase) : 'Photo viewer');
    fs.innerHTML =
      '<button class="photo-fs-close" type="button" aria-label="Close photos">✕</button>' +
      '<button class="photo-fs-nav prev" type="button" aria-label="Previous photo">‹</button>' +
      '<img alt="" decoding="async">' +
      '<button class="photo-fs-nav next" type="button" aria-label="Next photo">›</button>' +
      '<div class="photo-fs-count" aria-live="polite"></div>' +
      '<div class="idx-fs-note" hidden>Photo unavailable</div>';
    document.body.appendChild(fs);

    fsImg = fs.querySelector('img');
    fsCount = fs.querySelector('.photo-fs-count');
    fsPrev = fs.querySelector('.prev');
    fsNext = fs.querySelector('.next');
    fsClose = fs.querySelector('.photo-fs-close');
    fsNote = fs.querySelector('.idx-fs-note');

    fsClose.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    fsPrev.addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
    fsNext.addEventListener('click', function (e) { e.stopPropagation(); step(1); });
    // click the backdrop (not the photo, not a control) → close
    fs.addEventListener('click', function (e) { if (e.target === fs || e.target === fsNote) close(); });

    // ---- touch: live drag + swipe. The app.js original was threshold-only on touchend; dragging
    // the photo with your thumb is what a phone user expects, so the image tracks the finger and
    // snaps back if the swipe is too small.
    var x0 = null, y0 = null, dx = 0, locked = null;
    fs.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      x0 = t.clientX; y0 = t.clientY; dx = 0; locked = null;
      fs.classList.add('is-drag');
    }, { passive: true });
    fs.addEventListener('touchmove', function (e) {
      if (x0 == null) return;
      var t = e.changedTouches[0];
      dx = t.clientX - x0;
      var dy = t.clientY - y0;
      if (locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (locked === 'x' && N > 1) fsImg.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    fs.addEventListener('touchend', function () {
      if (x0 == null) return;
      fs.classList.remove('is-drag');
      fsImg.style.transform = '';
      // same 45px horizontal-dominant threshold as app.js:988
      if (locked === 'x' && Math.abs(dx) > 45 && N > 1) step(dx < 0 ? 1 : -1);
      x0 = y0 = null; dx = 0; locked = null;
    }, { passive: true });
    fs.addEventListener('touchcancel', function () {
      fs.classList.remove('is-drag');
      fsImg.style.transform = '';
      x0 = y0 = null; dx = 0; locked = null;
    }, { passive: true });

    return fs;
  }

  // ---------- render --------------------------------------------------------------------
  function render() {
    var tok = ++loadTok;
    var src = photos[idx];
    fs.classList.add('is-load');
    fsNote.hidden = true;
    fsImg.alt = altBase ? (altBase + ' photo ' + (idx + 1)) : ('Photo ' + (idx + 1));
    fsImg.src = src;

    var done = function (ok) {
      if (tok !== loadTok) return;                 // a later photo won the race
      fs.classList.remove('is-load');
      fsNote.hidden = !!ok;
    };
    if (fsImg.complete && fsImg.naturalWidth) done(true);
    else {
      fsImg.onload = function () { done(true); };
      fsImg.onerror = function () { done(false); };
    }

    fsCount.textContent = (idx + 1) + ' / ' + N;
    // single-photo listings: no arrows, no counter (mirrors setFS() in app.js:1000-1005)
    var multi = N > 1 ? '' : 'none';
    fsPrev.style.display = multi;
    fsNext.style.display = multi;
    fsCount.style.display = multi;

    preload(idx + 1); preload(idx - 1);           // neighbours only — never all 24
  }

  var warmed = {};
  function preload(i) {
    if (N < 2) return;
    var j = (i + N) % N;
    if (warmed[j]) return;
    warmed[j] = true;
    var im = new Image();
    im.decoding = 'async';
    im.src = photos[j];
  }

  function step(dir) { idx = (idx + dir + N) % N; render(); }   // loop, like app.js:1006

  // ---------- scroll lock (iOS-safe) ----------------------------------------------------
  function lock() {
    scrollY = window.scrollY || window.pageYOffset || 0;
    var b = document.body.style;
    b.position = 'fixed'; b.top = (-scrollY) + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
  }
  function unlock() {
    var b = document.body.style;
    b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
    window.scrollTo(0, scrollY);
  }

  // ---------- open / close --------------------------------------------------------------
  function isOpen() { return !!fs && fs.classList.contains('show'); }

  function open(i, trigger) {
    build();
    opener = trigger || null;
    idx = Math.min(Math.max(i | 0, 0), N - 1);
    render();
    lock();
    if (reduced) fs.classList.add('show');
    else requestAnimationFrame(function () { fs.classList.add('show'); });
    (fsClose || fs).focus();
    // Android hardware Back / iOS back-swipe dismisses the viewer instead of leaving the listing.
    // pushState with no URL keeps the address bar identical. file:// can throw → guarded.
    if (!histOpen) { try { history.pushState({ idxfs: 1 }, ''); histOpen = true; } catch (e) { histOpen = false; } }
  }

  function teardown() {
    if (!isOpen()) return;
    fs.classList.remove('show');
    fsImg.removeAttribute('src');       // stop an in-flight HD download the moment we close
    unlock();
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  function close() {
    if (histOpen) { histOpen = false; try { history.back(); return; } catch (e) { /* fall through */ } }
    teardown();
  }

  window.addEventListener('popstate', function () { histOpen = false; teardown(); });

  // ---------- keyboard: the viewer owns the keys while open (mirrors app.js:1268-1274) ----
  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (N > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); return;
    }
    if (e.key === 'Tab') {                                   // focus trap
      var f = [fsClose, fsPrev, fsNext].filter(function (el) { return el && el.style.display !== 'none'; });
      if (!f.length) return;
      var at = f.indexOf(document.activeElement);
      var next = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at === f.length - 1 ? 0 : at + 1);
      e.preventDefault(); f[next].focus();
    }
  });

  // ---------- triggers ------------------------------------------------------------------
  // Delegated so it survives any future re-render of the grid.
  gallery.addEventListener('click', function (e) {
    var shot = e.target.closest ? e.target.closest('.idx-shot') : null;
    if (shot) { e.preventDefault(); open(parseInt(shot.getAttribute('data-i'), 10) || 0, shot); return; }
    var more = e.target.closest ? e.target.closest('.idx-more') : null;
    if (more) { e.preventDefault(); open(0, more); }
  });
})();
