// Synchronously apply the cached dark-mode class before the page stylesheet
// parses. Loaded via <script src> (CSP for MV3 extension_pages does not allow
// inline script hashes, so we ship this as a tiny separate file).
// The flag is written by theme-to-css.ts (inside the iframe) and by the
// workspace init code (outer page), so both surfaces converge quickly.
(function () {
  try {
    var cached = sessionStorage.getItem('mdv-dark');
    if (cached === '1') {
      document.documentElement.classList.add('dark');
      return;
    }
    if (cached === '0') {
      return;
    }
  } catch (_) { /* storage disabled */ }

  // No cached flag yet (first open of this session): fall back to the OS
  // preference so an auto-mode dark theme does not flash white. The cached
  // flag wins when present because it reflects the theme actually applied —
  // a manual light theme on a dark OS must not flash dark.
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) { /* matchMedia unavailable */ }
})();
