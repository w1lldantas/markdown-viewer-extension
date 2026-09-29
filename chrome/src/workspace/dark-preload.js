// Synchronously apply the cached dark-mode class before the page stylesheet
// parses. Loaded via <script src> (CSP for MV3 extension_pages does not allow
// inline script hashes, so we ship this as a tiny separate file).
// The flag is written by theme-to-css.ts (inside the iframe) and by the
// workspace init code (outer page), so both surfaces converge quickly.
(function () {
  // localStorage is the current home of the flag: the theme setting is global,
  // so a per-tab value would leave every fresh tab uncached.
  var cached = null;
  try {
    cached = localStorage.getItem('mdv-dark');
  } catch (_) { /* storage disabled */ }

  // The mode is written next to the flag by the same two writers. In auto
  // mode the OS is the authority and `mdv-dark` is only a snapshot of the
  // last resolution, which goes stale the moment the OS flips with no tab
  // open — so there the live matchMedia read wins. In a fixed mode the flag
  // still wins (see below): a manual light theme on a dark OS must not flash
  // dark. An absent mode key (older install) keeps the old behaviour.
  var mode = null;
  try {
    mode = localStorage.getItem('mdv-theme-mode');
  } catch (_) { /* storage disabled */ }

  if (mode === 'auto') {
    var osDark = null;
    try {
      if (typeof matchMedia === 'function') {
        osDark = matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (_) { /* matchMedia unavailable */ }
    if (osDark !== null) {
      if (osDark) {
        document.documentElement.classList.add('dark');
      }
      return;
    }
    // matchMedia unusable: fall through to the cached flag below rather than
    // guessing light.
  }

  if (cached !== '1' && cached !== '0') {
    // Sessions that were already open when the flag moved still only have the
    // per-tab copy; read it rather than making those tabs worse.
    try {
      cached = sessionStorage.getItem('mdv-dark');
    } catch (_) { /* storage disabled */ }
  }

  if (cached === '1') {
    document.documentElement.classList.add('dark');
    return;
  }
  if (cached === '0') {
    return;
  }

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
