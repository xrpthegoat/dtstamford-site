/* ============================================================================
   filters-sheet.js — the phone filter sheet
   ============================================================================
   WHY A SHEET AND NOT THE CHIP CAROUSEL
     On a phone the filters were one horizontally-scrolling strip. A swipe strip hides most of its
     own options: you cannot weigh a filter you have not scrolled to, and there is no affordance
     telling you more exist. The sheet lays all of them out at once, under the thumb.

   THE ONE DESIGN RULE HERE
     There is no second filter implementation. This module MOVES the real `.fb-drops` element into
     the sheet and moves it back on resize — so every listener app.js bound (price selects, bed
     pills, city/type checkboxes, train + sort radios) keeps working on the very same nodes, and
     no state can drift between a "mobile" and a "desktop" copy. This module never reads or writes
     filter state itself; it only relocates DOM and reflects counts.

   It talks to app.js through the public surface app.js already publishes (window.DTSSearch), the
   same seam ai-search.js uses.
   ============================================================================ */
const MOBILE = () => window.matchMedia('(max-width:760px)').matches;

const $ = s => document.querySelector(s);
const btn = $('#filtersBtn');
const sheet = $('#filterSheet');
const scrim = $('#filterScrim');
const body = $('#fsheetBody');
  let lockedScrollY = 0;      // where the results were when the panel opened

  /* Flash the Filters button once, for someone who has never opened it — the custom search is the
     best thing on this page and it looked like furniture. Killed permanently on the first tap, and
     remembered, so a returning visitor is never nagged. Anyone who arrives with filters already in the
     URL clearly knows about them, so they never see it either. localStorage can throw in private mode,
     hence the guards — a storage failure must not cost the flash OR break the page. */
  /* "Seen" EXPIRES (John, 2026-08-19: "the filters button isn't flashing anymore" — it had remembered
     his own first tap forever). A first-time visitor gets the flash; someone who tapped it and comes back
     within a week does not (that would be nagging); after a week they get one more nudge, because a
     returning visitor a month later is a fresh visit. ?flash=1 forces it regardless, for checking. */
  const FLASH_SEEN = 'dts_filters_seen';
  const FLASH_TTL_MS = 7 * 24 * 3600 * 1000;
  function stopFlash(remember) {
    btn.classList.remove('is-flashing');
    if (remember) { try { localStorage.setItem(FLASH_SEEN, String(Date.now())); } catch (_) {} }
  }
  function maybeFlash() {
    if (/[?&]flash=1\b/.test(location.search)) { btn.classList.add('is-flashing'); return; }
    let seenAt = 0;
    try { const v = localStorage.getItem(FLASH_SEEN); seenAt = v === '1' ? Date.now() : (parseInt(v, 10) || 0); } catch (_) {}
    if (seenAt && Date.now() - seenAt < FLASH_TTL_MS) return;
    if (/[?&](ci|bd|ba|pmin|pmax|ht)=/.test(location.search)) return;   // already filtering — no hint needed
    btn.classList.add('is-flashing');
  }
const bar = document.querySelector('.fb-group-filters');

if (btn && sheet && scrim && body && bar) {
  const drops = () => document.querySelector('.fb-drops');
  let open = false;

  /* ---- relocate the REAL controls, never clone them ----
     Sold and Saved ride along so the phone bar is just search + Buy/Rent + Filters. They are
     lenses rather than filters, so they land in their own strip above the filter list. Their
     home in the bar is .fb-group-view, and they must be put back in their original order. */
  const lenses = $('#fsheetLenses');
  /* Bottom lens slot (John, 2026-08-19: "include sold at the bottom, just saved up top"). It is created
     INSIDE the scroll body, after the filters, so it scrolls with them — a static div under the body was
     a second pinned footer that ate panel height and never actually sat "at the bottom of the filters".
     Saved (everyday) leads at the top; Include sold (expert) is the last thing you reach. */
  let lensesTail = null;
  function tailSlot() {
    if (lensesTail && lensesTail.isConnected) return lensesTail;
    lensesTail = document.createElement('div');
    lensesTail.className = 'fsheet-lenses fsheet-lenses-tail';
    lensesTail.id = 'fsheetLensesTail';
    // its caption travels WITH the button (John): the sold sentence used to sit at the top, three
    // scrolls away from the thing it described
    const cap = document.createElement('div');
    cap.className = 'fsheet-tail-cap';
    cap.textContent = 'Add homes that already closed to the results — what\u2019s live stays, side by side.';
    lensesTail.appendChild(cap);
    body.appendChild(lensesTail);
    return lensesTail;
  }
  const viewGroup = document.querySelector('.fb-group-view');
  const soldBtn = $('#soldBtn');
  const savedBtn = $('#savedBtn');
  const viewToggle = document.querySelector('.fb-viewtoggle');

  function intoSheet() {
    const d = drops();
    if (d && d.parentElement !== body) body.appendChild(d);
    // Saved up top (the everyday lens); Include sold BELOW the filters (the expert toggle) — John,
    // 2026-08-19. Falls back to the top slot if the tail is ever missing, so nothing can vanish.
    if (lenses && savedBtn && savedBtn.parentElement !== lenses) lenses.appendChild(savedBtn);
    // the drops were just appended to body above; the tail must come AFTER them, so (re)append it last
    const tail = tailSlot(); body.appendChild(tail);
    if (soldBtn && soldBtn.parentElement !== tail) tail.appendChild(soldBtn);
  }
  function intoBar() {
    const d = drops();
    if (d && d.parentElement !== bar) bar.appendChild(d);
    // Restore the ORIGINAL desktop order: … Sold · Saved · Reset · view toggle. Anchoring on the
    // view toggle alone put both buttons after Reset, so a phone→desktop resize silently reordered
    // the bar. Anchor on Reset when it exists; appendChild order keeps Sold before Saved.
    const anchor = $('#resetBtn') || viewToggle || null;
    [soldBtn, savedBtn].forEach(b => {
      if (b && viewGroup && b.parentElement !== viewGroup) viewGroup.insertBefore(b, anchor);
    });
  }

  /* ---- count reflection ---- */
  function activeCount() {
    const S = window.DTSSearch;
    if (!S || !S.state) return 0;
    const s = S.state;
    return (s.priceMin || s.priceMax ? 1 : 0) + (s.beds || s.baths ? 1 : 0) +
           (s.types && s.types.length ? 1 : 0) + (s.cities && s.cities.length ? 1 : 0) +
           (s.maxTrainMin ? 1 : 0) + (s.circle ? 1 : 0);
  }
  function syncTrigger() {
    const n = activeCount();
    const c = $('#fbFilterCount');
    btn.classList.toggle('has-val', n > 0);
    if (c) { c.hidden = n === 0; c.textContent = n; }
  }
  function syncApply() {
    const S = window.DTSSearch, el = $('#fsheetCount');
    if (!el) return;
    // The sheet applies live, so this button is a "how many will I see" readout, not a submit.
    let n = null;
    try { n = S && typeof S.results === 'function' ? S.results().length : null; } catch (e) { n = null; }
    if (n === null) { const c = $('#count'); n = c ? c.textContent : '—'; }
    el.textContent = typeof n === 'number' ? n.toLocaleString('en-US') : n;
  }

  function openSheet() {
    if (!MOBILE()) return;
    intoSheet();
    // Every panel is inline inside the sheet; clear any desktop dropdown state that came with it.
    document.querySelectorAll('.fsheet .drop').forEach(d => {
      d.classList.remove('is-active');
      const b = d.querySelector('.drop-btn'); if (b) b.setAttribute('aria-expanded', 'true');
      const p = d.querySelector('.drop-panel'); if (p) { p.style.top = ''; p.style.left = ''; }
    });
    scrim.hidden = false; sheet.hidden = false;
    // Force a reflow so the closed transform is committed before the open class lands — otherwise
    // the browser collapses both into one style pass and the sheet jumps instead of sliding.
    // Deliberately NOT requestAnimationFrame: rAF is paused in a backgrounded/hidden tab, which
    // left the sheet unstyled-open (hidden=false, no .is-open, still translated off-screen).
    void sheet.offsetHeight;
    scrim.classList.add('is-open');
    sheet.classList.add('is-open');
    stopFlash(true);                       // he found it — never flash again on this device
    open = true;
    btn.setAttribute('aria-expanded', 'true');
    /* iOS ignores body{overflow:hidden} for TOUCH scrolling — the page keeps moving under the panel,
       which is exactly what John hit. position:fixed is the only lock Safari honours, so pin the body
       at its current offset and put it back on close (otherwise the page jumps to the top every time
       the filters are dismissed). overflow:hidden stays for desktop wheel scroll. */
    lockedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = -lockedScrollY + 'px';
    document.body.style.width = '100%';
    syncApply();
  }

  function closeSheet() {
    if (!open) return;
    scrim.classList.remove('is-open');
    sheet.classList.remove('is-open');
    open = false;
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, lockedScrollY);      // restore exactly where he was in the results
    const done = () => { if (!open) { sheet.hidden = true; scrim.hidden = true; } };
    sheet.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 500);                 // transitionend can be skipped if the tab is hidden
  }

  btn.addEventListener('click', () => (open ? closeSheet() : openSheet()));
  maybeFlash();     // last: everything it depends on is wired by here
  scrim.addEventListener('click', closeSheet);
  $('#fsheetApply') && $('#fsheetApply').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeSheet(); });

  // Reset reuses the bar's own Reset button so there is one reset path, not two.
  $('#fsheetClear') && $('#fsheetClear').addEventListener('click', () => {
    const r = $('#resetBtn'); if (r) r.click();
    syncTrigger(); syncApply();
  });

  // A tap on a panel inside the sheet must not bubble into app.js's document-level closeDrops(),
  // which would collapse the inline panels the sheet depends on.
  sheet.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target.closest('.drop-btn')) e.preventDefault();   // panels are already open here
    setTimeout(() => { syncTrigger(); syncApply(); }, 60);   // after app.js re-renders
  });

  /* Placement is decided by viewport, NOT by whether the sheet is open: on a phone Sold/Saved must
     already be out of the bar when the page loads, or they sit in the bar AND in the sheet. Run it
     once now, then again whenever we cross the breakpoint (rotation, desktop resize) — coming back
     to desktop has to hand every control back or the filters simply vanish. */
  function place() { (MOBILE() ? intoSheet : intoBar)(); }
  place();

  let wasMobile = MOBILE();
  window.addEventListener('resize', () => {
    const m = MOBILE();
    if (m === wasMobile) return;
    wasMobile = m;
    if (!m) closeSheet();
    place();
  });

  /* Keep the trigger + Apply count honest no matter WHAT changed the filters — a tap in the sheet,
     Magic Search, a ?bd= URL, Reset, the map's "search this area".
     Anchored to #count, the number app.js itself renders: it is the one element guaranteed to
     change on every render, so observing it cannot drift out of sync the way a fixed timeout can.
     (An earlier version listened for a 'dts:filters-applied' event — app.js never dispatches one,
     so that listener was dead and the badge only updated by luck of a 60ms timeout.) */
  const countEl = $('#count');
  if (countEl && 'MutationObserver' in window) {
    new MutationObserver(() => { syncTrigger(); syncApply(); })
      .observe(countEl, { childList: true, characterData: true, subtree: true });
  }
  window.addEventListener('dts:ai-cleared', () => { syncTrigger(); syncApply(); });
  window.addEventListener('dts:ready', () => { syncTrigger(); syncApply(); });
  syncTrigger();
}
