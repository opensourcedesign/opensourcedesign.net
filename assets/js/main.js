(function () {
  // Apply Pagefind search-term highlighting when arriving from a search result
  // (URL carries one or more ?pagefind-highlight=<term> params).
  (function () {
    if (!/[?&]pagefind-highlight=/.test(window.location.search)) return;
    var base = '/pagefind/';
    var d = document.getElementById('osd-search-dialog');
    if (d && d.getAttribute('data-pagefind-base')) base = d.getAttribute('data-pagefind-base');
    import(base + 'pagefind-highlight.js').then(function (mod) {
      var PH = mod && (mod.default || mod.PagefindHighlight) ? (mod.default || mod.PagefindHighlight) : window.PagefindHighlight;
      if (!PH) return;
      new PH({
        highlightParam: 'pagefind-highlight',
        addStyles: false,
        markOptions: {
          className: 'pagefind-highlight',
          exclude: ['[data-pagefind-ignore]', '[data-pagefind-ignore] *']
        }
      });
    }).catch(function () {});
  })();

  // Scroll to top button
  var btn = document.getElementById('scroll-to-top');
  if (btn) {
    var threshold = 400;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    function updateBtn() {
      btn.classList.toggle('visible', window.scrollY > threshold);
    }
    window.addEventListener('scroll', updateBtn, { passive: true });
    btn.addEventListener('click', function () {
      // CSS `scroll-behavior` doesn't govern programmatic scrolls, so honor
      // prefers-reduced-motion here explicitly.
      window.scrollTo({ top: 0, behavior: reducedMotion && reducedMotion.matches ? 'auto' : 'smooth' });
    });
    updateBtn();
  }

  // Close the mobile menu on navigation. Scoped to the header so <details>
  // used for content disclosure (FAQs etc.) don't collapse on link clicks.
  document.querySelectorAll('header details').forEach(function (d) {
    d.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        d.removeAttribute('open');
      });
    });
  });

  // GIF-replacement videos (render-image hook): honor prefers-reduced-motion
  // by stopping the autoplayed loop and exposing controls instead.
  (function () {
    if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    document.querySelectorAll('video[data-gif-video]').forEach(function (v) {
      v.removeAttribute('autoplay');
      v.pause();
      v.controls = true;
    });
  })();

  // Theme controls (header): the desktop icon button cycles
  // light -> system -> dark; the mobile-menu segmented control sets a state
  // directly. The stored choice ("osd-theme") is applied before first paint
  // by the head script in baseof.html; controls ship hidden and are revealed
  // here (no dead control without JS).
  (function () {
    var cycleButtons = document.querySelectorAll('[data-theme-toggle]');
    var setButtons = document.querySelectorAll('[data-theme-set]');
    var groups = document.querySelectorAll('[data-theme-group]');
    if (!cycleButtons.length && !setButtons.length) return;
    var ORDER = ['light', 'dark'];
    var LABELS = { light: 'Light', dark: 'Dark' };
    function current() {
      try {
        var v = localStorage.getItem('osd-theme');
        if (v === 'light' || v === 'dark') return v;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { 
        return 'light'; 
      }
    }
    function apply(state) {
      try {
        localStorage.setItem('osd-theme', state);
      } catch (e) { /* private mode: theme just won't persist */ }
      if (window.osdSyncTheme) window.osdSyncTheme();
      render();
    }
    function render() {
      var state = current();
      var next = ORDER[(ORDER.indexOf(state) + 1) % ORDER.length];
      cycleButtons.forEach(function (b) {
        b.removeAttribute('data-theme-pending');
        b.setAttribute('data-theme-state', state);
        b.setAttribute('aria-label', 'Colour theme: ' + LABELS[state] + '. Switch to ' + LABELS[next].toLowerCase() + '.');
        b.title = 'Theme: ' + LABELS[state];
      });
      setButtons.forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-theme-set') === state ? 'true' : 'false');
      });
      groups.forEach(function (g) { g.hidden = false; });
    }
    cycleButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        apply(ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length]);
      });
    });
    setButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        apply(b.getAttribute('data-theme-set'));
      });
    });
    render();
  })();

  // Copy-link buttons (share partial) - delegated so there is no inline JS (CSP-friendly).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy-link]');
    if (!btn || btn.dataset.copied === '1') return;
    var url = btn.getAttribute('data-copy-link') || window.location.href;
    var original = btn.innerHTML;
    var confirm = function () {
      btn.dataset.copied = '1';
      btn.innerHTML = '<svg class="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
      btn.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        btn.innerHTML = original;
        btn.setAttribute('aria-label', 'Copy link');
        delete btn.dataset.copied;
      }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(confirm).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); confirm(); } catch (err) { /* ignore */ }
      document.body.removeChild(ta);
    }
  });

  (function () {
    var mods = window.__OSD_MODULES || {};
    function load(url) {
      if (!url) return;
      import(url).then(function (m) { if (m && m.init) m.init(); }).catch(function () {});
    }
    if (document.getElementById('osd-search-dialog') && document.querySelector('[data-search-open]')) load(mods.search);
    if (document.getElementById('osd-notfound-search')) load(mods.notfound);
    if (document.querySelector('main .prose img, main .osd-prose img')) load(mods.lightbox);
    if (document.querySelector('[data-stale-check],[data-deadline-check]')) load(mods.jobMarkers);
  })();
})();
