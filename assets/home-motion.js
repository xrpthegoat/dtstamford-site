/* Native, bounded motion: one frame per input, visible layers only, no perpetual render loop. */
(() => {
  const root = document.documentElement;
  const toggle = document.querySelector('.home-motion-toggle');
  if (!toggle || !Element.prototype.animate) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const small = matchMedia('(max-width: 760px)');
  const active = new Set();
  const layers = [];
  const inView = new Set();
  const seen = new WeakSet();
  let paused = false;
  let frame = 0;
  try { paused = sessionStorage.getItem('dts-home-motion-paused') === 'true'; } catch (_) {}
  const enabled = () => !paused && !reduced.matches && !document.hidden;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function play(node, frames, delay = 0, duration = 850) {
    if (!enabled()) return;
    const animation = node.animate(frames, { duration, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    active.add(animation);
    animation.onfinish = animation.oncancel = () => active.delete(animation);
  }
  function reveal(node, index = 0) {
    play(node, [{ opacity: .12, transform: 'translate3d(0,32px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], Math.min(index * 85, 255));
  }
  function flow(heading) {
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (walker.currentNode.textContent.trim()) texts.push(walker.currentNode);
    const words = [];
    texts.forEach(text => {
      const fragment = document.createDocumentFragment();
      text.textContent.split(/(\s+)/).forEach(part => {
        if (!part.trim()) { fragment.append(document.createTextNode(part)); return; }
        const word = document.createElement('span');
        word.className = 'motion-word';
        word.textContent = part;
        fragment.append(word);
        words.push(word);
      });
      text.replaceWith(fragment);
    });
    words.forEach((word, index) => play(word, [
      { opacity: .12, transform: 'perspective(650px) translate3d(0,24px,0) rotateX(14deg)' },
      { opacity: 1, transform: 'perspective(650px) translate3d(0,0,0) rotateX(0deg)' }
    ], Math.min(index * 48, 430), 1050));
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    [...active].forEach(animation => animation.cancel());
    layers.forEach(layer => layer.node.style.removeProperty('--motion-y'));
    document.querySelectorAll('[data-motion-pointer]').forEach(node => {
      node.style.removeProperty('--mag-x');
      node.style.removeProperty('--mag-y');
    });
  }
  function sync() {
    root.classList.toggle('home-motion-paused', paused || reduced.matches);
    toggle.hidden = reduced.matches;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.querySelector('.home-motion-label').textContent = paused ? 'Resume motion' : 'Pause motion';
    toggle.firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
    if (!enabled()) reset(); else schedule();
  }
  toggle.addEventListener('click', () => {
    paused = !paused;
    try { sessionStorage.setItem('dts-home-motion-paused', String(paused)); } catch (_) {}
    sync();
  });
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);

  // Two layers in the opening, with no scaling/cropping of the full Avon photograph.
  const backdrop = document.querySelector('.avon-image-frame');
  const hero = document.querySelector('.hero--avon>.wrap');
  if (backdrop) layers.push({ node: backdrop, anchor: document.querySelector('.hero--avon'), hero: true, rate: .07, limit: 42 });
  if (hero) layers.push({ node: hero, anchor: hero.parentElement, hero: true, rate: -.035, limit: 24 });
  document.querySelectorAll('.home-statement .sa-fig').forEach((node, index) => layers.push({ node, anchor: node.parentElement, rate: index ? -.055 : .04, limit: 22 }));
  document.querySelectorAll('#stamford .frame .img').forEach((node, index) => layers.push({ node, anchor: node.closest('.frame'), rate: index % 2 ? -.035 : .035, limit: 14 }));

  function updateLayers() {
    frame = 0;
    if (!enabled()) return;
    // Batch all layout reads before writing transforms.
    const changes = [];
    inView.forEach(layer => {
      const rect = layer.anchor.getBoundingClientRect();
      const progress = layer.hero ? -Math.min(0, rect.top) : innerHeight / 2 - (rect.top + rect.height / 2);
      const multiplier = small.matches ? .5 : 1;
      changes.push([layer.node, clamp(progress * layer.rate * multiplier, -layer.limit * multiplier, layer.limit * multiplier)]);
    });
    changes.forEach(([node, y]) => node.style.setProperty('--motion-y', y.toFixed(2) + 'px'));
  }
  function schedule() {
    if (!frame && enabled()) frame = requestAnimationFrame(updateLayers);
  }
  if ('IntersectionObserver' in window) {
    const anchors = new Map();
    layers.forEach(layer => {
      if (!anchors.has(layer.anchor)) anchors.set(layer.anchor, []);
      anchors.get(layer.anchor).push(layer);
    });
    const visibility = new IntersectionObserver(entries => {
      entries.forEach(entry => anchors.get(entry.target).forEach(layer => {
        if (entry.isIntersecting) inView.add(layer); else inView.delete(layer);
      }));
      schedule();
    }, { rootMargin: '80px' });
    anchors.forEach((_, anchor) => visibility.observe(anchor));

    const revealObserver = new IntersectionObserver(entries => {
      let stagger = 0;
      entries.forEach(entry => {
        if (!entry.isIntersecting || seen.has(entry.target)) return;
        seen.add(entry.target);
        revealObserver.unobserve(entry.target);
        if (!enabled()) return;
        if (entry.target.matches('h2')) flow(entry.target); else reveal(entry.target, stagger++);
      });
    }, { threshold: .12, rootMargin: '0px 0px -5% 0px' });
    document.querySelectorAll('main h2,.tools-eyebrow,.tools-heading>p,.tool-card,.market-panel,.statement-copy>.big,.statement-signature,.home-statement .sa-fig,.stats .stat-w,.meet .portrait,.meet .row>div:last-child>p,.meet .tag,.meet .sign,.svc .cell,#stamford .frame,.hgrid,.ig-card,.faq-cat,.cta .cta-row').forEach(node => revealObserver.observe(node));
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });

  // The hit area follows the pointer by at most four pixels; links keep their real hrefs.
  document.querySelectorAll('.hero .btn,.callbar .btn,.cta .btn,.tool-link,.ms-bar button').forEach(node => {
    node.dataset.motionPointer = '';
    node.addEventListener('pointermove', event => {
      if (!enabled() || !fine.matches || event.pointerType === 'touch') return;
      const rect = node.getBoundingClientRect();
      node.style.setProperty('--mag-x', clamp((event.clientX - rect.left - rect.width / 2) * .06, -4, 4).toFixed(2) + 'px');
      node.style.setProperty('--mag-y', clamp((event.clientY - rect.top - rect.height / 2) * .1, -3, 3).toFixed(2) + 'px');
    }, { passive: true });
    const clear = () => { node.style.removeProperty('--mag-x'); node.style.removeProperty('--mag-y'); };
    node.addEventListener('pointerleave', clear);
    node.addEventListener('blur', clear);
  });
  document.querySelectorAll('.tool-card').forEach(node => node.addEventListener('pointermove', event => {
    if (!enabled() || !fine.matches || event.pointerType === 'touch') return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--light-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
    node.style.setProperty('--light-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
  }, { passive: true }));

  root.classList.add('motion-enabled');
  sync();
  if (enabled()) {
    document.querySelectorAll('.hero-location,.hero-promise').forEach(flow);
    document.querySelectorAll('.hero .eyebrow,.hero .sub,.hero .reviews-badge,.hero .cta-row,.hero-agent').forEach((node, index) => reveal(node, index));
  }
})();
