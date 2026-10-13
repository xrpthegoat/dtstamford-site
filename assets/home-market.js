/* Presentation only. The existing homepage module owns MLS values, pricing and listing links. */
(() => {
  const rail = document.getElementById('liNewRow');
  const toggle = document.querySelector('.market-motion-toggle');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  if (rail && toggle) {
    const syncPreference = () => {
      toggle.hidden = reducedMotion.matches;
    };
    syncPreference();
    reducedMotion.addEventListener('change', syncPreference);
    toggle.addEventListener('click', () => {
      const paused = rail.classList.toggle('is-paused');
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.setAttribute('aria-label', paused ? 'Play new listings' : 'Pause new listings');
      toggle.querySelector('.market-motion-label').textContent = paused ? 'Play' : 'Pause';
      toggle.querySelector('.market-motion-icon').textContent = paused ? '▷' : 'Ⅱ';
    });
    const syncVisibility = () => rail.classList.toggle('is-background', document.hidden);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
  }

  if (!('IntersectionObserver' in window)) return;
  // Content is never hidden waiting for JS; animate once when it is already entering view.
  const entrance = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (!reducedMotion.matches) entry.target.classList.add('market-enter');
      entrance.unobserve(entry.target);
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.market-panel, .statement-copy, .home-statement .sa-fig').forEach(el => entrance.observe(el));

  if (rail) {
    const visibility = new IntersectionObserver(entries => {
      rail.classList.toggle('is-offscreen', !entries[0].isIntersecting);
    }, { rootMargin: '100px' });
    visibility.observe(rail);
  }
})();
