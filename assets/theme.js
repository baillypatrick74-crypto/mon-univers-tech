(() => {
  const root = document.documentElement;
  const valid = ['auto', 'light', 'dark'];
  let selected = 'auto';
  try {
    const saved = localStorage.getItem('mut-theme');
    if (valid.includes(saved)) selected = saved;
  } catch {}
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    const theme = selected === 'auto' ? (prefersDark.matches ? 'dark' : 'light') : selected;
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#091323' : '#f5f8fc');
  }
  apply();
  prefersDark.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.getElementById('theme');
    if (!control) return;
    control.value = selected;
    control.addEventListener('change', () => {
      if (!valid.includes(control.value)) return;
      selected = control.value;
      try { localStorage.setItem('mut-theme', selected); } catch {}
      apply();
    });
  });
})();
