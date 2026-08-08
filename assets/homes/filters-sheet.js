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
const bar = document.querySelector('.fb-group-filters');

if (btn && sheet && scrim && body && bar) {
  const drops = () => document.querySelector('.fb-drops');
  let open = false;

  /* ---- relocate the REAL controls, never clone them ----
     Sold and Saved ride along so the phone bar is just search + Buy/Rent + Filters. They are
     lenses rather than filters, so they land in their own strip above the filter list. Their
     home in the bar is .fb-group-view, and they must be put back in their original order. */
  const lenses = $('#fsheetLenses');
  const viewGroup = document.querySelector('.fb-group-view');
  const soldBtn = $('#soldBtn');
  const savedBtn = $('#savedBtn');
  const viewToggle = document.querySelector('.fb-viewtoggle');

  function intoSheet() {
    const d = drops();
    if (d && d.parentElement !== body) body.appendChild(d);
    if (lenses) {
      [soldBtn, savedBtn].forEach(b => { if (b && b.parentElement !== lenses) lenses.appendChild(b); });
    }
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
    open = true;
    btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    syncApply();
  }

  function closeSheet() {
    if (!open) return;
    scrim.classList.remove('is-open');
    sheet.classList.remove('is-open');
    open = false;
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    const done = () => { if (!open) { sheet.hidden = true; scrim.hidden = true; } };
    sheet.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 500);                 // transitionend can be skipped if the tab is hidden
  }

  btn.addEventListener('click', () => (open ? closeSheet() : openSheet()));
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
