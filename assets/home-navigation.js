/* Native details work without JavaScript; enhancement closes adjacent/outside menus. */
(() => {
  const menus = [...document.querySelectorAll('.nav-resources')];
  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
    });
  }
  document.addEventListener('click', event => {
    menus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = menus.find(item => item.open);
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
  });
})();
