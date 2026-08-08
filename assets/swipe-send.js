/* swipe-send.js — the lead-form submit control (2026-08-07)
 *
 * Replaces the visible hCaptcha checkbox + plain button with a slide-to-send track: swipe the knob
 * across, OR just press and hold it (~700ms) and it fills itself. John: "the captcha is a bit too
 * strict — what about just a swipe? or hold button loading thing".
 *
 * The captcha is NOT deleted, it is made INVISIBLE. That distinction is the whole point: Web3Forms
 * verifies the hCaptcha token SERVER-side, which is the only reason scraping the (public) access_key
 * out of the HTML and POSTing api.web3forms.com directly doesn't work — an SEO-pitch spammer walked
 * straight through the botcheck honeypot on 2026-08-06. So the widget stays, switched to
 * data-size="invisible", and the swipe is what triggers hcaptcha.execute(). Most humans now see
 * nothing at all; only the ones hCaptcha finds suspicious get a challenge. Server protection is
 * unchanged — the gesture is UX, never the security layer.
 *
 * Degrades safely at every step: no JS -> the original button is still a real submit button. hCaptcha
 * fails to load or times out -> the visible checkbox comes back with a prompt, so a lead can never
 * dead-end on a control that won't fire.
 *
 * Usage: <script src="assets/swipe-send.js" defer></script> on any page with a Web3Forms form.
 */
(function () {
  'use strict';

  var HOLD_MS = 700;      // press-and-hold duration to fill on its own
  var DONE_AT = 0.985;    // knob is "across" at this fraction of travel
  var CAPTCHA_TIMEOUT = 15000;

  var CSS = [
    '.swsend{margin:18px 0 0}',
    '.sw-track{position:relative;display:flex;align-items:center;height:60px;padding:5px;border-radius:999px;',
    '  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.045);overflow:hidden;',
    '  touch-action:pan-y;user-select:none;-webkit-user-select:none}',
    '.sw-fill{position:absolute;inset:0;width:0;border-radius:999px;background:linear-gradient(90deg,rgba(227,196,126,.30),rgba(227,196,126,.12));pointer-events:none}',
    '.sw-label{position:relative;flex:1;text-align:center;padding:0 58px 0 58px;font-weight:700;font-size:1rem;color:#e6e6ea;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sw-knob{position:absolute;left:5px;top:5px;width:50px;height:50px;border:0;border-radius:50%;cursor:grab;',
    '  display:flex;align-items:center;justify-content:center;color:#161006;font-size:1.15rem;line-height:1;',
    '  background:linear-gradient(180deg,#eed6a3,#cbab68);box-shadow:0 8px 22px -10px rgba(227,196,126,.9);',
    '  transform:translateX(0);touch-action:none}',
    '.sw-knob:focus-visible{outline:2px solid #e3c47e;outline-offset:4px}',
    '.swsend[data-state="idle"] .sw-knob{transition:transform .35s cubic-bezier(.2,.9,.3,1)}',
    '.swsend[data-state="idle"] .sw-fill{transition:width .35s cubic-bezier(.2,.9,.3,1)}',
    '.swsend[data-state="live"] .sw-knob{cursor:grabbing}',
    '.swsend[data-state="done"] .sw-knob,.swsend[data-state="wait"] .sw-knob{cursor:default}',
    '.sw-hint{margin:9px 2px 0;font-family:"Space Mono",ui-monospace,monospace;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:#8b8b93}',
    '.swsend[data-state="wait"] .sw-hint,.swsend[data-state="done"] .sw-hint{color:#c9a24a}',
    /* the arrow breathes to the right so the gesture is discoverable without instructions */
    '@keyframes swNudge{0%,100%{transform:translateX(0)}50%{transform:translateX(4px)}}',
    '.swsend[data-state="idle"] .sw-arrow{display:inline-block;animation:swNudge 1.9s ease-in-out infinite}',
    '@keyframes swPulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '.swsend[data-state="wait"] .sw-fill{animation:swPulse 1.1s ease-in-out infinite}',
    '.sw-recap{margin-top:12px}',
    '@media(prefers-reduced-motion:reduce){.swsend .sw-arrow,.swsend .sw-fill{animation:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('swSendCSS')) return;
    var s = document.createElement('style');
    s.id = 'swSendCSS';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function upgrade(form) {
    var btn = form.querySelector('button[type="submit"], button:not([type])');
    if (!btn || btn.dataset.swUpgraded) return;
    btn.dataset.swUpgraded = '1';

    var capWrap = form.querySelector('.h-captcha');
    // Invisible mode must be set BEFORE Web3Forms' script loads hCaptcha's api.js and auto-renders.
    // This file is deferred and the Web3Forms script is async, so ordering isn't guaranteed — the
    // pages set data-size in their markup too, and this is the belt-and-braces copy.
    if (capWrap && !capWrap.dataset.size) capWrap.dataset.size = 'invisible';

    var labelText = (btn.textContent || 'Send').replace(/\s*→\s*$/, '').trim();

    var wrap = document.createElement('div');
    wrap.className = 'swsend';
    wrap.dataset.state = 'idle';
    wrap.innerHTML =
      '<div class="sw-track">' +
        '<span class="sw-fill"></span>' +
        '<span class="sw-label"></span>' +
      '</div>' +
      '<div class="sw-hint">Swipe the button — or press and hold</div>';

    var track = wrap.querySelector('.sw-track');
    var fill = wrap.querySelector('.sw-fill');
    var label = wrap.querySelector('.sw-label');
    var hint = wrap.querySelector('.sw-hint');
    label.textContent = labelText;

    // Drop the control exactly where the button was, then move the button into it. The knob IS the
    // form's submit button, so keyboard users keep native behaviour (Tab to it and press Enter) and
    // Enter-in-a-text-field still does implicit submission.
    btn.parentNode.insertBefore(wrap, btn);
    btn.className = 'sw-knob';
    btn.innerHTML = '<span class="sw-arrow" aria-hidden="true">→</span>';
    btn.setAttribute('aria-label', labelText + ' — swipe right, or press Enter');
    track.appendChild(btn);

    var travel = 0, progress = 0, dragging = false, holdStart = 0, raf = 0, holdTimer = 0, pointerId = null;

    function maxTravel() { return Math.max(0, track.clientWidth - btn.offsetWidth - 10); }

    function paint() {
      travel = maxTravel();
      btn.style.transform = 'translateX(' + (progress * travel) + 'px)';
      fill.style.width = (progress * 100) + '%';
      label.style.opacity = String(1 - Math.min(1, progress * 1.4));
    }

    function reset() {
      dragging = false; progress = 0; holdStart = 0;
      cancelAnimationFrame(raf); clearTimeout(holdTimer);
      wrap.dataset.state = 'idle';
      paint();
    }

    function tick() {
      if (!dragging) return;
      var held = (Date.now() - holdStart) / HOLD_MS;
      if (held > progress) { progress = Math.min(1, held); paint(); }
      if (progress >= DONE_AT) { complete(); return; }
      raf = requestAnimationFrame(tick);
    }

    function onDown(e) {
      if (wrap.dataset.state === 'done' || wrap.dataset.state === 'wait') return;
      dragging = true; pointerId = e.pointerId; holdStart = Date.now();
      wrap.dataset.state = 'live';
      travel = maxTravel();
      if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) {} }
      raf = requestAnimationFrame(tick);
      // The hold completes on a timer, not on the rAF loop: rAF is throttled (or stopped outright)
      // when the tab isn't being painted, and "held it long enough" must not depend on frame rate.
      // rAF only draws the fill.
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () { if (dragging) complete(); }, HOLD_MS);
    }

    function onMove(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      var dx = e.clientX - (track.getBoundingClientRect().left + btn.offsetWidth / 2);
      var p = travel ? Math.max(0, Math.min(1, dx / travel)) : 0;
      if (p > progress) { progress = p; paint(); }              // never slides backwards mid-gesture
      if (progress >= DONE_AT) complete();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      cancelAnimationFrame(raf); clearTimeout(holdTimer);
      if (progress < DONE_AT) reset();
    }

    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('pointermove', onMove);
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
    addEventListener('resize', paint);

    // A plain mouse/touch CLICK must not submit — that's the whole point of the gesture. Keyboard
    // activation reports detail 0, so Enter/Space on the knob still submits (and lands in the
    // form's submit handler below, which runs the same fill + captcha sequence).
    btn.addEventListener('click', function (e) {
      if (e.detail > 0 && wrap.dataset.state !== 'done') e.preventDefault();
    });

    form.addEventListener('submit', function (e) {
      if (form.dataset.swReady === '1') return;   // our own programmatic submit — let it through
      e.preventDefault();
      complete();
    });

    function fail(msg) {
      hint.textContent = msg;
      reset();
    }

    function complete() {
      if (wrap.dataset.state === 'done' || wrap.dataset.state === 'wait') return;
      dragging = false;
      cancelAnimationFrame(raf); clearTimeout(holdTimer);
      progress = 1; paint();

      if (!form.reportValidity()) {                 // missing name/email/phone — snap back, focus it
        hint.textContent = 'Fill in the highlighted field, then swipe again';
        setTimeout(reset, 250);
        return;
      }

      wrap.dataset.state = 'wait';
      label.textContent = 'Sending…';
      label.style.opacity = '1';
      hint.textContent = 'Sending…';

      if (!capWrap) return send();

      var hc = window.hcaptcha;
      // Any non-empty token in the form counts — after a degrade() there are two widgets in play.
      var solved = Array.prototype.some.call(
        form.querySelectorAll('textarea[name="h-captcha-response"]'),
        function (t) { return !t.disabled && t.value; }
      );
      if (solved) return send();                              // already solved this session

      if (!hc || !hc.execute) return degrade('Verification didn\'t load — tick the box, then swipe again');

      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; degrade('Verification timed out — tick the box, then swipe again'); }
      }, CAPTCHA_TIMEOUT);

      // Two ways home, whichever lands first: the promise from execute({async:true}), and the
      // data-callback declared in the page markup (auto-render reads that attribute at render time,
      // which is why it lives in the HTML and not here). `settled` makes the second one a no-op.
      window.__swPending = function () {
        if (settled) return;
        settled = true; clearTimeout(timer); send();
      };

      try {
        // The widget id lives on the iframe hCaptcha injected, not on our div.
        var frame = capWrap.querySelector('iframe[data-hcaptcha-widget-id]');
        var wid = frame ? frame.getAttribute('data-hcaptcha-widget-id') : undefined;
        var p = hc.execute(wid, { async: true });
        if (p && p.then) {
          p.then(function () {
            if (settled) return;
            settled = true; clearTimeout(timer); send();
          }).catch(function () {
            if (settled) return;
            settled = true; clearTimeout(timer);
            degrade('Verification was cancelled — tick the box, then swipe again');
          });
        }
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); degrade('Verification didn\'t start — tick the box, then swipe again'); }
      }
    }

    // Last resort: put the classic checkbox back on the page so the lead can still get through.
    function degrade(msg) {
      var hc = window.hcaptcha;
      var key = capWrap && (capWrap.dataset.sitekey || capWrap.getAttribute('data-sitekey'));
      if (hc && hc.render && key && !form.querySelector('.sw-recap')) {
        var box = document.createElement('div');
        box.className = 'sw-recap';
        form.insertBefore(box, wrap);
        // Disable the dead invisible widget's token field, or the POST carries two
        // h-captcha-response values and Web3Forms verifies the empty one.
        var stale = capWrap.querySelector('textarea[name="h-captcha-response"]');
        if (stale) stale.disabled = true;
        try {
          hc.render(box, { sitekey: key, theme: 'dark', callback: function () { hint.textContent = 'Verified — swipe to send'; } });
        } catch (err) {}
      }
      label.textContent = labelText;
      fail(msg);
    }

    function send() {
      wrap.dataset.state = 'done';
      label.textContent = 'Sending…';
      hint.textContent = 'Sending…';
      form.dataset.swReady = '1';
      form.submit();
    }

    paint();
  }

  // Named in the pages' data-callback. hCaptcha resolves it by name off window when the (invisible)
  // challenge passes; the form that armed the swipe is holding the actual continuation.
  window.dtsCaptchaDone = function (token) {
    if (typeof window.__swPending === 'function') window.__swPending(token);
  };

  function init() {
    injectCSS();
    document.querySelectorAll('form[action*="api.web3forms.com"]').forEach(upgrade);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
