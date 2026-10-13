/* The application runs on Weimark's origin. No applicant fields, files or payment data are read here. */
(() => {
  const url = 'https://apply.weimark.com/rental/ljffdeaa';
  const workspace = document.getElementById('application-workspace');
  const frame = document.getElementById('weimark-application');
  const loading = document.getElementById('frame-loading');
  const heading = document.getElementById('workspace-title');
  const close = document.getElementById('hide-application');
  let opener;

  frame.addEventListener('load', () => {
    if (frame.getAttribute('src')) loading.hidden = true;
  });
  document.querySelectorAll('[data-open-application]').forEach(link => {
    link.addEventListener('click', event => {
      // Preserve standard new-tab actions and a direct-link fallback when JS is unavailable.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      opener = link;
      workspace.hidden = false;
      document.querySelectorAll('[data-open-application]').forEach(control => control.setAttribute('aria-expanded', 'true'));
      if (!frame.getAttribute('src')) frame.src = url;
      heading.focus({ preventScroll: true });
      workspace.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    });
    link.setAttribute('aria-controls', 'application-workspace');
    link.setAttribute('aria-expanded', 'false');
  });
  close.addEventListener('click', () => {
    workspace.hidden = true;
    document.querySelectorAll('[data-open-application]').forEach(link => link.setAttribute('aria-expanded', 'false'));
    // Keep the frame mounted so closing the panel does not discard an in-progress application.
    opener?.focus();
  });
})();
