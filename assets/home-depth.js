(() => {
  const root = document.documentElement;
  const scene = document.querySelector('.depth-intro');
  const button = document.querySelector('.depth-toggle');
  if (!scene || !button) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let paused = false;
  try { paused = sessionStorage.getItem('dts-depth-paused') === 'true'; } catch (_) {}
  function sync() {
    root.classList.toggle('depth-paused', paused || reduced.matches);
    button.hidden = reduced.matches;
    button.textContent = paused ? 'Resume 3D motion' : 'Pause 3D motion';
    button.setAttribute('aria-pressed', String(paused));
  }
  button.addEventListener('click', () => {
    paused = !paused;
    try { sessionStorage.setItem('dts-depth-paused', String(paused)); } catch (_) {}
    sync();
  });
  reduced.addEventListener('change', sync);
  sync();
  let visible = true;
  function visibility() { scene.classList.toggle('depth-offscreen', !visible || document.hidden); }
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); }).observe(scene);
  document.addEventListener('visibilitychange', visibility);
  document.querySelectorAll('.tool-card, .hero-agent').forEach(card => {
    card.addEventListener('pointermove', event => {
      if (paused || reduced.matches || !fine.matches || event.pointerType === 'touch') return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--depth-x', ((.5 - (event.clientY - rect.top) / rect.height) * 6).toFixed(2) + 'deg');
      card.style.setProperty('--depth-y', (((event.clientX - rect.left) / rect.width - .5) * 6).toFixed(2) + 'deg');
    }, { passive: true });
    card.addEventListener('pointerleave', () => { card.style.removeProperty('--depth-x'); card.style.removeProperty('--depth-y'); });
  });
})();
