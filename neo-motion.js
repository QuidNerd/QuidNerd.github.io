/* ============================================================
   NEO-MOTION — the shared motion layer.

   Feedback verbs, called by the page scripts:
     arrive   a result landed        (drops in)
     shutter  a panel replaced       (slides up)
     jolt     the page said no       (shake)
     tick     a number was worked out (counts up)

   And the filing-cabinet motion, which runs on its own:
     the top bar ducks away on scroll down, back on scroll up;
     sections rise in as they scroll into view;
     internal links put the folder away before leaving
     (and on the home page, the clicked folder opens to fill
     the screen first).

   The hazard bar covers the one real wait: the webfont fetch.
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.documentElement.classList.add('js');

  /* Restart an animation that may already have run. Removing the class
     is not enough on its own — the browser coalesces the remove/add into
     one frame, so the reflow read in between is what actually resets it. */
  function restart(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  window.neoArrive  = function (el) { if (!reduced) restart(el, 'neo-arrive'); };

  /* ---------- TICK ----------
     For computed numbers. The readout counts up to its value instead of
     appearing at it — the movement itself is what says "this was worked
     out". Counting is mechanical, so it steps in whole numbers on a fixed
     frame budget rather than interpolating smoothly.

     Live readouts recompute on every keystroke, so the count is held until
     the typing stops; otherwise it would restart on every digit. */
  var tickTimers = new WeakMap();   // pending debounce, per element
  var tickFrames = new WeakMap();   // in-flight rAF, per element
  var tickFinals = new WeakMap();   // the settle-guarantee timer, per element
  var tickValues = new WeakMap();   // last value counted to, per element

  var TICK_MS = 380;

  function cancelTick(el) {
    clearTimeout(tickTimers.get(el));
    clearTimeout(tickFinals.get(el));
    cancelAnimationFrame(tickFrames.get(el));
  }

  function runTick(el, target, format) {
    var from = tickValues.get(el) || 0;
    var start = performance.now();

    /* The count is decoration; the number is not. requestAnimationFrame
       stops firing in a backgrounded or unfocused tab, which would strand
       the readout on whatever partial value it had reached — a savings
       planner reading "0 days" when the answer is 103 is far worse than
       one that never animated. So the true value is written on a plain
       timer that does not depend on rAF running at all. */
    clearTimeout(tickFinals.get(el));
    tickFinals.set(el, setTimeout(function () {
      cancelAnimationFrame(tickFrames.get(el));
      el.textContent = format(target);
    }, TICK_MS + 60));

    (function frame(now) {
      var t = Math.min(1, (now - start) / TICK_MS);
      var eased = 1 - Math.pow(1 - t, 3);          // ease-out: fast, then lands
      el.textContent = format(Math.round(from + (target - from) * eased));
      if (t < 1) tickFrames.set(el, requestAnimationFrame(frame));
    })(start);
  }

  /* Count `el` up to `target`, once the value has settled for `delay` ms.
     `format` turns the running integer into the displayed string. */
  window.neoTick = function (el, target, format, delay) {
    if (!el) return;
    format = format || String;
    if (reduced) { el.textContent = format(target); tickValues.set(el, target); return; }
    cancelTick(el);
    tickTimers.set(el, setTimeout(function () {
      runTick(el, target, format);
      tickValues.set(el, target);
    }, delay === undefined ? 350 : delay));
  };

  /* For the non-numeric states of a ticking readout ("Set a goal above 0").
     Cancels any pending count and resets the origin, so the next real value
     counts up from zero rather than from a number no longer on screen. */
  window.neoTickText = function (el, text) {
    if (!el) return;
    cancelTick(el);
    tickValues.set(el, 0);
    el.textContent = text;
  };
  window.neoShutter = function (el) { if (!reduced) restart(el, 'neo-shutter'); };
  window.neoJolt    = function (el) { if (!reduced) restart(el, 'neo-jolt'); };

  /* ---------- HAZARD BAR ----------
     These pages are static and their JS is synchronous, so there is no
     computation worth spinning for. The one real wait on every page is
     the webfont fetch — until Space Grotesk lands you are looking at
     fallback text. That is what this covers, and nothing else.

     It is torn down on `load`, but held for a minimum beat first: a bar
     that flashes for 30ms on a warm cache reads as a glitch, not a wait. */
  var MIN_VISIBLE = 260;

  function mountHazard() {
    if (reduced) return;
    var bar = document.createElement('div');
    bar.className = 'neo-hazard';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', 'Loading');
    (document.body || document.documentElement).appendChild(bar);

    var born = Date.now();
    var done = false;

    function dismiss() {
      if (done) return;
      done = true;
      var held = Date.now() - born;
      setTimeout(function () {
        bar.classList.add('is-done');
        setTimeout(function () { bar.remove(); }, 200);
      }, Math.max(0, MIN_VISIBLE - held));
    }

    /* fonts.ready is the signal we actually care about; `load` is the
       backstop for browsers without the Font Loading API, and the timeout
       is the backstop for a font CDN that never answers. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(dismiss);
    }
    window.addEventListener('load', dismiss);
    setTimeout(dismiss, 4000);
  }

  /* ---------- TOP BAR: DUCK ON SCROLL ----------
     Hides once you are scrolling down past the top, comes back on any
     scroll up. A small dead zone stops it twitching on trackpad jitter. */
  function duckTopbar() {
    var bar = document.querySelector('.topbar');
    /* home only: on the files the bar stays pinned */
    if (!bar || !document.body.classList.contains('home')) return;
    var last = window.scrollY, ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY, d = y - last;
        if (y < 80 || d < -6) bar.classList.remove('is-hidden');
        else if (d > 6) bar.classList.add('is-hidden');
        if (Math.abs(d) > 6) last = y;
        ticking = false;
      });
    }, { passive: true });
    /* keyboard users tabbing into the bar must be able to see it */
    bar.addEventListener('focusin', function () { bar.classList.remove('is-hidden'); });
  }

  /* ---------- NO RIGHT CLICK ----------
     The context menu is swapped for a little note by the cursor. Text
     fields keep the real menu so pasting still works. */
  function noPeek() {
    var note = null;
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      if (note) note.remove();
      note = document.createElement('div');
      note.className = 'no-peek';
      note.setAttribute('role', 'status');
      note.textContent = 'hey you!\nno peeking behind the folders';
      document.body.appendChild(note);
      /* sit just below-right of the cursor, flipped back inside the window */
      var w = note.offsetWidth, h = note.offsetHeight, pad = 12;
      var x = e.clientX + 14, y = e.clientY + 16;
      if (x + w > innerWidth - pad) x = e.clientX - w - 10;
      if (y + h > innerHeight - pad) y = e.clientY - h - 12;
      note.style.left = Math.max(pad, x) + 'px';
      note.style.top = Math.max(pad, y) + 'px';
      var mine = note;
      note.addEventListener('animationend', function () {
        mine.remove();
        if (note === mine) note = null;
      });
    });
  }

  /* ---------- REVEAL ----------
     Top-level pieces of the sheet rise in as they scroll into view.
     Anything already on screen at load is left alone, since it is
     arriving with the sheet anyway. Panels that start hidden (tabs)
     are observed too, and reveal when they are first shown. */
  var REVEAL = '.sheet > *, .sheet > [id$="-panel"] > *, .chapter > *, .notes > *, .drawer-inner > *';

  function mountReveal() {
    if (reduced || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });

    /* Measured by layout (offsetTop), not getBoundingClientRect: at this
       moment the folder is mid-way through sliding up, so its transformed
       position would put everything "below the fold". */
    function layoutTop(el) {
      var y = 0;
      for (; el; el = el.offsetParent) y += el.offsetTop;
      return y;
    }
    var fold = window.scrollY + window.innerHeight;
    document.querySelectorAll(REVEAL).forEach(function (el) {
      /* .chapter-intro is a tilted sticky note: the rise-in sets transform,
         which would straighten it until the effect let go, then it tipped */
      if (el.matches('.tabs, .tab-hint, .masthead, .chapter-intro, script, style')) return;
      var hiddenNow = el.offsetParent === null;
      if (!hiddenNow && layoutTop(el) < fold) return;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  /* ---------- HOME STACK ----------
     Each folder is a stack of sheets (one per sub-page) behind a cover.
     Pointing at a sheet's tab tips the cover and every sheet in front of it
     forward, showing that sheet; the folders in front tilt back too. The
     right third unfolds the folders in front to show the description.
     Keyboard focus does the same; touch just follows the links. */
  function mountHomeStack() {
    var stack = document.querySelector('.stack');
    if (!stack) return;
    var folders = Array.prototype.slice.call(stack.querySelectorAll('.folder'));
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    /* the narrow layout hides the number, name and description the unfold
       makes room for, so unfolding there would only open an empty gap */
    var narrow = window.matchMedia('(max-width: 620px)');

    function setState(active, unfolded, sheet) {
      if (document.documentElement.classList.contains('is-picking') ||
          document.documentElement.classList.contains('home-returning')) return;
      sheet = sheet || 0;
      if (narrow.matches) unfolded = false;
      folders.forEach(function (folder, i) {
        folder.classList.toggle('is-hovered', i === active);
        folder.classList.toggle('is-after', active >= 0 && i > active);
        folder.classList.toggle('is-unfolded', unfolded && i > active);
        folder.querySelectorAll('.folder-page').forEach(function (page) {
          page.classList.toggle('is-rotated', i === active && +page.getAttribute('data-k') < sheet);
        });
      });
    }
    var pointing = function (e) { return e.pointerType !== 'touch' && finePointer.matches; };

    folders.forEach(function (folder, i) {
      folder.querySelectorAll('.folder-page').forEach(function (page) {
        var k = +page.getAttribute('data-k');
        page.addEventListener('pointerenter', function (e) { if (pointing(e)) setState(i, false, k); });
        page.addEventListener('focusin', function () {
          if (page.matches(':focus-visible')) setState(i, true, k);
        });
      });
      folder.addEventListener('pointerleave', function () {
        var f = folder.querySelector('.folder-page:focus-visible');
        if (f) setState(i, true, +f.getAttribute('data-k'));
        else setState(-1, false);
      });
      var area = folder.querySelector('.folder-unfold');
      if (area) {
        area.addEventListener('pointerenter', function (e) { if (pointing(e)) setState(i, true, 0); });
        area.addEventListener('pointerleave', function () {
          if (folder.matches(':hover')) setState(i, false, 0);
        });
      }
      folder.addEventListener('focusout', function (e) {
        if (!folder.contains(e.relatedTarget)) setState(-1, false);
      });
    });

    /* Each file's row of tabs runs left to right along its top edge. It must
       stop short of the label printed at the right of the folder behind it
       (that label sits on the same line), and a long row (Junk Drawer has six
       sub-pages) steps its type down a little until it fits. Measured at rest,
       on load, once the webfonts land, and on resize. */
    function fitTabs() {
      /* measuring means briefly undoing these settings; with transitions
         live, that would set every folder easing to the undone size and
         back, a visible bounce */
      stack.classList.add('is-fitting');
      try { fitTabsNow(); } finally {
        void stack.offsetHeight;
        stack.classList.remove('is-fitting');
      }
    }
    function fitTabsNow() {
      /* the open cover at the bottom must be tall enough for its text */
      var coverBand = stack.querySelector('.folder-cover .folder-band');
      if (coverBand) {
        /* ...plus a little spare room under it: the cover slides down a
           few px and tilts when a folder above it is hovered (it slides,
           rather than shrinks, so it never needs room for the larger unfold) */
        /* 0px, not removed: the page may already carry the last value from
           <head> (index.html), and the band must be measured unstretched */
        stack.style.setProperty('--cover-min', '0px');
        var drop = (parseFloat(getComputedStyle(stack).getPropertyValue('--cover-offset')) || 16) + 24;
        var coverMin = Math.ceil(coverBand.scrollHeight + drop) + 'px';
        stack.style.setProperty('--cover-min', coverMin);
        /* remembered per width, so the next visit starts at its final height */
        try { sessionStorage.setItem('junk-drawer:cover-min', JSON.stringify({ w: window.innerWidth, v: coverMin })); } catch (_) {}
      }
      folders.forEach(function (folder, i) {
        var rows = Array.prototype.slice.call(folder.querySelectorAll('.folder-tabs'));
        var row = rows[0];
        if (!row) return;
        var reserve = 0;
        var label = i > 0 && folders[i - 1].querySelector('.folder-go');
        if (label && label.offsetParent) {
          reserve = folder.getBoundingClientRect().right - label.getBoundingClientRect().left + 28;
        }
        /* set on the folder, so every sheet's copy of the row inherits it */
        var set = function (p, v) { folder.style.setProperty(p, v); };
        set('--reserve', Math.max(0, Math.round(reserve)) + 'px');
        ['--tab-fs', '--tsh', '--tgap'].forEach(function (p) { folder.style.removeProperty(p); });
        var squeeze = function (k, on) {
          rows.forEach(function (r) { if (r.children[k]) r.children[k].classList.toggle('is-squeezed-out', on); });
        };
        var n = row.children.length;
        for (var j = 0; j < n; j++) squeeze(j, false);
        var over = function () { return row.scrollWidth > row.clientWidth + 1; };
        if (!over()) return;
        var sh = parseFloat(getComputedStyle(row).getPropertyValue('--sh')) || 40;
        var fs = parseFloat(getComputedStyle(row).fontSize);
        /* 1. close the gaps until neighbouring shoulders just meet */
        set('--tgap', '0px');
        /* 2. steepen the shoulders, down to half their width */
        for (var w = sh; over() && w > sh / 2; w -= 2) set('--tsh', w + 'px');
        /* 3. step the type down, to 15px at the least */
        while (over() && fs > 15) { fs -= 0.5; set('--tab-fs', fs + 'px'); }
        /* 4. still too long: drop tabs from the end (each page's side tabs
              still reach every section) */
        for (var k = n - 1; over() && k > 0; k--) squeeze(k, true);
      });
    }
    fitTabs();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTabs);
    /* only a change of width can change the fit: on a phone the address
       bar showing and hiding while you scroll fires resize too */
    var fitTimer, fitWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      if (window.innerWidth === fitWidth) return;
      fitWidth = window.innerWidth;
      clearTimeout(fitTimer);
      fitTimer = setTimeout(fitTabs, 120);
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) requestAnimationFrame(function () { setState(-1, false); });
    });
  }

  /* ---------- LEAVING ----------
     Same-site links play the put-away animation, then navigate. New-tab
     clicks, modified clicks, hash links and off-site links are untouched. */
  var LEAVE_MS = 520, OPEN_MS = 650;

  function isInternal(a, e) {
    if (!a || e.defaultPrevented || e.button !== 0) return false;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.hash) return false;
    return url;
  }

  /* How much of a flat-lying file shows at the bottom of the screen, both
     when the home page pulls it out of the stack and when the next page
     starts its swing upright from there. The two match, so it reads as one
     continuous move across the page load. */
  var PEEK = 190;

  /* Home page: the clicked folder slides down to the bottom of the screen
     while the rest of the stack falls away. */
  function pickFolder(folder) {
    var band = folder.querySelector('.folder-band') || folder;
    var dy = window.innerHeight - PEEK - band.getBoundingClientRect().top;
    document.documentElement.classList.add('is-picking');
    folder.classList.add('is-picked');
    folder.style.transform = 'translateY(' + dy + 'px)';
  }

  function mountLeaving() {
    if (reduced) return;
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      var url = isInternal(a, e);
      if (!url) return;
      e.preventDefault();
      if (document.documentElement.classList.contains('is-picking') ||
          document.documentElement.classList.contains('home-returning') ||
          document.documentElement.classList.contains('file-closing') ||
          document.documentElement.classList.contains('is-leaving')) return;
      var folder = a.closest('.folder');
      if (folder && window.neoFileTransition && window.neoFileTransition.depart(a, url)) return;
      if (a.matches('a.topbar-home') && window.neoFileTransition && window.neoFileTransition.closeHome(url)) return;
      if (folder) pickFolder(folder);
      else document.documentElement.classList.add('is-leaving');
      setTimeout(function () { location.href = url.href; }, folder ? OPEN_MS : LEAVE_MS);
    });
    /* back/forward restores the page from cache mid-animation; reset it */
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      var html = document.documentElement;
      html.classList.remove('is-leaving', 'is-picking');
      document.querySelectorAll('.folder.is-picked').forEach(function (f) {
        f.classList.remove('is-picked');
        f.style.transform = '';
      });
    });
  }

  /* ---------- TITLE ----------
     Give each letter a mask for the staggered sideways reveal. The heading
     keeps its text as an aria-label; the letter spans are hidden from
     screen readers so it is not spelled out. */
  function splitTitle() {
    var h = document.querySelector('.masthead h1');
    if (!h || reduced) return;
    var text = h.textContent.trim();
    // Keep this delay on the heading: removing file-arriving must not
    // change the timing of an animation already in progress.
    h.style.setProperty('--title-delay', document.documentElement.classList.contains('file-arriving') ? '0.65s' : '0.1s');
    h.setAttribute('aria-label', text);
    h.textContent = '';
    var n = 0;
    text.split(/\s+/).forEach(function (w, i) {
      if (i) h.appendChild(document.createTextNode(' '));
      var word = document.createElement('span');
      word.className = 'word';
      word.setAttribute('aria-hidden', 'true');
      Array.from(w).forEach(function (ch) {
        var mask = document.createElement('span');
        mask.className = 'char-mask';
        var c = document.createElement('span');
        c.className = 'char';
        c.style.setProperty('--n', n++);
        c.textContent = ch;
        mask.appendChild(c);
        word.appendChild(mask);
      });
      h.appendChild(word);
    });
  }

  /* ---------- SIDE TABS ----------
     The file's own tab, then one tab per section. On a page with a tab row
     the side tabs drive it (and the row hides); otherwise they jump to each
     titled block and follow along as you scroll.

     COLOUR: a section that is also a sheet on the home page carries that
     sheet's colour (data-c on its tab or block). Its side tab is drawn in it,
     and while it is the open section the whole folder takes that colour, so
     the sheet you clicked on the home page is the folder that opens. Sections
     without one (Tag Check's steps) keep the page's own colour. */
  var PALETTE = ['pink', 'cyan', 'lime', 'orange', 'yellow', 'red'];

  function buildRail() {
    var page = document.querySelector('.page[data-tab]');
    if (!page) return;
    var rail = document.createElement('nav');
    rail.className = 'side-tabs';
    rail.setAttribute('aria-label', 'Sections');

    var own = (document.body.className.match(/\bf-([a-z]+)/) || [])[1];
    var colours = PALETTE.filter(function (c) { return c !== own; });
    /* The first paint, as the page opens, lands at once: the folder is set
       to its section's colour with its 0.45s fade switched off, so a page
       opened straight on a section (#duelling, a reload) never shows the
       parent's colour turning into it. Later tab switches still fade. */
    var painted = false;
    var paint = function (c) {
      var html = document.documentElement;
      if (!painted) html.classList.add('no-folder-fade');
      document.body.style.setProperty('--folder', 'var(--' + (c || own) + ')');
      if (!painted) {
        painted = true;
        void document.body.offsetWidth;   /* settle the new colour while the fade is off */
        html.classList.remove('no-folder-fade');
      }
    };

    /* The sections: a tab row (Rule Book, the Junk Drawer page) or titled
       blocks (Useful Tools). The page opens on the first one, so the
       file's own tab (named by data-tab) stands for it; the rest get a tab
       each. A page without sections just has its file tab, always open. */
    var row = Array.prototype.slice.call(document.querySelectorAll('.sheet .tabs .tab'));
    var blocks = row.length ? [] : Array.prototype.slice.call(document.querySelectorAll('.sheet .block'))
      .filter(function (bl) { return bl.querySelector('.block-title'); });
    var sections = row.length ? row : (blocks.length > 1 ? blocks : []);
    var backingSheets = [], hoveredTab = null;
    function syncPeeks() {
      backingSheets.forEach(function (pair) {
        pair.sheet.classList.toggle('is-peeking', !pair.tab.classList.contains('is-active') &&
          (pair.tab === hoveredTab || pair.tab.matches(':focus-visible')));
      });
    }

    function addTab(label, c, i) {
      var b = document.createElement(sections.length ? 'button' : 'span');
      if (sections.length) b.type = 'button';
      b.className = 'side-tab' + (i === 0 ? ' is-file' : '');
      b.textContent = label;
      if (sections.length) {
        var hitbox = document.createElement('span');
        hitbox.className = 'side-tab-hitbox';
        hitbox.setAttribute('aria-hidden', 'true');
        b.appendChild(hitbox);
      }
      b.style.setProperty('--c', 'var(--' + (c || (i === 0 ? own : colours[i % colours.length])) + ')');
      if (sections.length) {
        var backing = document.createElement('div');
        backing.className = 'side-page-peek';
        backing.setAttribute('aria-hidden', 'true');
        backing.style.setProperty('--c', b.style.getPropertyValue('--c'));
        page.appendChild(backing);
        backingSheets.push({ tab: b, sheet: backing });
        /* mouse only: a tap would leave the sheet peeking out */
        b.addEventListener('pointerenter', function (e) {
          if (e.pointerType !== 'mouse') return;
          hoveredTab = b; syncPeeks();
        });
        b.addEventListener('pointerleave', function () {
          if (hoveredTab === b) hoveredTab = null;
          syncPeeks();
        });
        b.addEventListener('focus', function () { requestAnimationFrame(syncPeeks); });
        b.addEventListener('blur', syncPeeks);
      }
      rail.appendChild(b);
      return b;
    }

    if (!sections.length) {
      addTab(page.getAttribute('data-tab'), own, 0).classList.add('is-active');
    } else {
      var shownSub = function () {
        return blocks.filter(function (bl) { return bl.hasAttribute('data-subpage') && !bl.classList.contains('hidden'); })[0];
      };
      var showSub = function (sub) {
        blocks.forEach(function (bl) {
          bl.classList.toggle('hidden', bl.hasAttribute('data-subpage') ? bl !== sub : !!sub);
        });
      };
      var tabs = sections.map(function (sec, i) {
        var label = sec.getAttribute('data-home-label') || (i === 0 ? page.getAttribute('data-tab')
                  : (row.length ? sec : sec.querySelector('.block-title')).textContent.trim());
        var b = addTab(label, sec.getAttribute('data-c'), i);
        b.addEventListener('click', function () {
          if (row.length) { sec.click(); return; }
          /* a data-subpage block is a page of its own: its tab swaps it in
             for the rest; any other tab swaps the rest back, then scrolls */
          var isSub = sec.hasAttribute('data-subpage');
          if (isSub || shownSub()) {
            showSub(isSub ? sec : null);
            open(i);
            history.replaceState(null, '', isSub ? '#' + sec.getAttribute('data-home-hash') : location.pathname);
            if (window.neoShutter) window.neoShutter(isSub ? sec : blocks[0]);
          }
          sec.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        });
        return b;
      });
      /* exactly one tab is open: it sits on the folder in the folder's colour */
      var open = function (k) {
        tabs.forEach(function (t, j) { t.classList.toggle('is-active', j === k); });
        syncPeeks();
        paint(sections[k] && sections[k].getAttribute('data-c'));
      };
      if (row.length) {
        var sync = function () {
          var k = row.findIndex(function (t) { return t.classList.contains('active'); });
          open(k < 0 ? 0 : k);
        };
        var mo = new MutationObserver(sync);
        row.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
        sync();
      } else {
        var initial = blocks.findIndex(function (bl) { return bl.getAttribute('data-home-hash') === location.hash.slice(1); });
        if (initial >= 0 && blocks[initial].hasAttribute('data-subpage')) showSub(blocks[initial]);
        open(initial < 0 ? 0 : initial);
        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function (entries) {
            if (document.documentElement.classList.contains('file-arriving')) return;
            entries.forEach(function (e) { if (e.isIntersecting) open(blocks.indexOf(e.target)); });
          }, { rootMargin: '-30% 0px -60% 0px' });
          blocks.forEach(function (bl) { io.observe(bl); });
        }
      }
      document.body.classList.add('has-rail');
    }
    if (window.neoFileTransition) window.neoFileTransition.fitRail(rail);
    page.appendChild(rail);
    /* the folder must be at least as long as its tabs, or a short section
       would leave them hanging off the bottom */
    var sizeRail = function () { page.style.setProperty('--rail-len', rail.offsetWidth + 'px'); };
    sizeRail();
    if ('ResizeObserver' in window) new ResizeObserver(sizeRail).observe(rail);
  }

  /* Home clicks carry a folder pose. Every other visit slides an already
     open file up from below the viewport, including reloads and deep links. */
  function openFile() {
    var html = document.documentElement;
    var page = document.querySelector('.page');
    try {
      if (!page || reduced) return;
      if (window.neoFileTransition && window.neoFileTransition.arrive(page)) return;
      if (window.neoFileTransition) window.neoFileTransition.revealRail(page, 350);
      var cls = 'is-sliding';
      var r = page.getBoundingClientRect();
      page.style.setProperty('--slide-y', Math.max(0, window.innerHeight - r.top) + 'px');
      page.classList.add(cls);
      var done = function () { page.classList.remove(cls); };
      page.addEventListener('animationend', function (e) {
        if (e.target.classList.contains('sheet') && e.animationName === 'file-paper-slide') done();
      });
      setTimeout(done, 1400);
    } finally {
      html.classList.add('opened');
    }
  }

  function init() {
    /* decoration first, guarded: if either fails, the file must still open */
    try { splitTitle(); buildRail(); } catch (err) { /* page works without them */ }
    var page = document.querySelector('.page');
    if (page && window.neoFileTransition) window.neoFileTransition.ensureCover(page);
    openFile();
    mountHazard();
    duckTopbar();
    noPeek();
    mountReveal();
    mountHomeStack();
    mountLeaving();
    if (window.neoFileTransition) {
      window.neoFileTransition.rememberHome();
      window.neoFileTransition.arriveHome();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
