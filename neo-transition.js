/* A cross-document handoff: keep the clicked cover's pose, then move and
   open that cover together. The normal HTML links still own navigation. */
(function () {
  'use strict';
  var KEY = 'junk-drawer:flight';
  // Mosby's swing: 1.5s on GSAP's power3.inOut (a quartic in-out), which
  // gets going decisively and does most of the turn in its quick middle
  var SWING = 'cubic-bezier(.76,0,.24,1)';
  var HOME_KEY = 'junk-drawer:home-layout';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var incoming = null, returning = null, leaving = false, reveal = null, startFlight = null, resetClose = null;
  try {
    incoming = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    var nav = performance.getEntriesByType('navigation')[0];
    if (!incoming || incoming.url !== location.href || Date.now() - incoming.time > 15000 ||
        (nav && nav.type !== 'navigate') || reduce) incoming = null;
  } catch (_) { incoming = null; }
  if (incoming && incoming.kind === 'close') {
    returning = incoming;
    incoming = null;
    document.documentElement.classList.add('home-returning');
  }
  if (incoming) document.documentElement.classList.add('file-arriving');
  // On a hand-off, hold this page's first paint until it has been parsed in
  // full: the flying folder is built from it (on DOMContentLoaded), and a long
  // page could otherwise show a frame of bare desk first, a flash before the
  // swing. An expect link for an id that never appears unblocks rendering
  // once parsing finishes; browsers without it just ignore the link.
  if (incoming || returning) {
    try {
      var hold = document.createElement('link');
      hold.rel = 'expect';
      hold.href = '#neo-parsed';
      hold.setAttribute('blocking', 'render');
      document.head.appendChild(hold);
    } catch (_) {}
  }

  // and on the page being left: its side of a skipped transition rejects too
  addEventListener('pageswap', function (e) {
    var vt = e.viewTransition;
    if (vt) { vt.ready.catch(function () {}); vt.finished.catch(function () {}); vt.updateCallbackDone.catch(function () {}); }
  });
  addEventListener('pagereveal', function (e) {
    // a skipped transition (e.g. a page in the background) rejects .ready too
    if (e.viewTransition) { e.viewTransition.ready.catch(function () {}); e.viewTransition.updateCallbackDone.catch(function () {}); }
    reveal = e.viewTransition ? e.viewTransition.finished.catch(function () {}) : Promise.resolve();
    if (startFlight) reveal.then(startFlight);
  });

  // The layout key: width plus the px height of 100vh. On a phone 100vh is
  // the tallest viewport and stays put while the address bar comes and goes
  // (innerHeight does not), and the stack is sized in vh, not innerHeight.
  function vh() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
    document.documentElement.appendChild(probe);
    var h = probe.offsetHeight;
    probe.remove();
    return h;
  }
  function layoutFits(layout) { return !!layout && layout.width === innerWidth && layout.vh === vh(); }
  // Object.assign onto el.style silently drops custom properties (--x), so
  // the swing's --cover-light, --folder and tab shoulders never took effect.
  function setStyle(el, props) {
    Object.keys(props).forEach(function (k) {
      if (k.indexOf('--') === 0) el.style.setProperty(k, props[k]);
      else el.style[k] = props[k];
    });
  }
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function metric(tab) {
    var s = getComputedStyle(tab), shoulder = getComputedStyle(tab, '::before');
    return {
      height: s.height, fontSize: s.fontSize, padding: s.padding,
      shoulder: shoulder.width, width: s.width
    };
  }
  function ensureCover(page) {
    var cover = page.querySelector(':scope > .page-cover');
    if (!cover) {
      cover = document.createElement('div');
      cover.className = 'page-cover';
      cover.setAttribute('aria-hidden', 'true');
      page.appendChild(cover);
    }
    return cover;
  }
  function depart(a, url) {
    var folder = a.closest('.folder');
    if (!folder || reduce || leaving) return false;
    var sheet = a.matches('.folder-page') ? a : folder.querySelector('.folder-page[data-k="0"]');
    var tab = sheet && sheet.querySelector('.folder-tab.is-own');
    var band = folder.querySelector('.folder-band');
    if (!tab || !band) return false;
    dispatchEvent(new Event('neo:home-layout'));
    var fs = getComputedStyle(folder), ts = getComputedStyle(tab);
    var stack = folder.closest('.stack'), sr = rect(stack);
    var origin = getComputedStyle(stack).perspectiveOrigin.split(' ');
    var state = {
      url: url.href, time: Date.now(),
      box: rect(folder), tab: metric(tab), label: tab.textContent.trim(),
      tabX: tab.getBoundingClientRect().left - folder.getBoundingClientRect().left,
      ink: ts.color, paper: getComputedStyle(sheet).backgroundColor,
      cover: getComputedStyle(band).backgroundColor,
      coverTransform: getComputedStyle(band).transform,
      light: getComputedStyle(band, '::after').opacity,
      perspective: [sr.x + parseFloat(origin[0]), sr.y + parseFloat(origin[1])],
      gap: fs.getPropertyValue('--tgap').trim() || '14px',
      // the sheets in front of the one picked (Quidditch Build in front of
      // Duelling): they turn over with the cover, so the colour in front
      // stays put through the hand-off. Nearest the picked sheet first.
      fronts: Array.from(folder.querySelectorAll('.folder-page')).filter(function (p) {
        return +p.getAttribute('data-k') < +sheet.getAttribute('data-k');
      }).sort(function (x, y) { return +y.getAttribute('data-k') - +x.getAttribute('data-k'); })
        .map(function (p) { return getComputedStyle(p).backgroundColor; })
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); }
    catch (_) { return false; }
    leaving = true;
    // A click can land halfway through hover. Freeze that exact rendered pose
    // so it cannot advance while the next document is being prepared.
    band.style.transition = 'none';
    band.style.transform = state.coverTransform;
    band.style.setProperty('--held-light', state.light);
    // The other files leave in turn, in stack order (as Mosby's timeline
    // staggers them), and the page eases back to the top meanwhile; the next
    // page loads once the last one has gone, 0.75s after it set off.
    // Mosby staggers 0.1s with three folders to clear, so they have all set
    // off by 0.2s; ours keep that same 0.2s spread, however many there are.
    var others = Array.from(stack.querySelectorAll('.folder')).filter(function (f) { return f !== folder; });
    var spread = 200, step = others.length > 1 ? spread / (others.length - 1) : 0;
    others.forEach(function (f, n) { f.style.setProperty('--out', Math.round(n * step) + 'ms'); });
    document.documentElement.classList.add('is-picking');
    folder.classList.add('is-picked');
    folder.querySelectorAll('.folder-page').forEach(function (other) {
      if (other !== sheet) other.classList.add('is-tucked');
    });
    var total = (others.length > 1 ? spread : 0) + 750;
    if (scrollY > 1) scrollTo({ top: 0, behavior: 'smooth' });
    // Keep the selected cover still. Only its labels and the other files leave.
    setTimeout(function () {
      // it may have ridden up with the scroll: hand over where it is now
      var sr2 = rect(stack);
      state.box = rect(folder);
      state.perspective = [sr2.x + parseFloat(origin[0]), sr2.y + parseFloat(origin[1])];
      state.time = Date.now();
      try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
      location.assign(url.href);
    }, total);
    return true;
  }

  function fitRail(rail) {
    if (!incoming) return;
    var m = incoming.tab;
    rail.style.setProperty('--file-tab-height', m.height);
    rail.style.setProperty('--file-tab-font', m.fontSize);
    rail.style.setProperty('--file-tab-padding', m.padding);
    rail.style.setProperty('--file-tab-shoulder', m.shoulder);
    rail.style.setProperty('--file-tab-gap', incoming.gap);
    // Captured metrics only apply at the viewport where the tab was clicked.
    addEventListener('resize', function () {
      ['height', 'font', 'padding', 'shoulder', 'gap'].forEach(function (name) {
        rail.style.removeProperty('--file-tab-' + name);
      });
    }, { once: true });
  }

  function tabTiming(index, activeIndex, delay) {
    return { duration: 750, delay: (delay === undefined ? 850 : delay) + Math.max(0, Math.abs(index - activeIndex) - 1) * 35,
      easing: 'cubic-bezier(.165,.84,.44,1)', fill: 'both' };
  }

  function revealRail(page, delay) {
    if (reduce) return;
    var tabs = Array.from(page.querySelectorAll('.side-tab'));
    var activeIndex = tabs.findIndex(function (tab) { return tab.classList.contains('is-active'); });
    tabs.forEach(function (tab, i) {
      if (i === activeIndex) return;
      var a = tab.animate([
        { transform: 'translateY(110%)', opacity: 0 },
        { transform: getComputedStyle(tab).transform, opacity: 1 }
      ], tabTiming(i, activeIndex, delay));
      a.finished.then(function () { a.cancel(); }, function () {});
    });
  }

  // Cache actual home geometry, not a second set of layout constants. This
  // also lets a file reached through a deep link return to its own folder.
  function rememberHome() {
    if (!document.body.classList.contains('home')) return;
    function measure() {
      if (document.documentElement.classList.contains('is-picking')) return;
      var targets = Array.from(document.querySelectorAll('a.folder-page')).map(function (sheet) {
        var folder = sheet.closest('.folder'), tab = sheet.querySelector('.folder-tab.is-own');
        if (!tab || !tab.offsetWidth) return null;
        var stackBox = rect(folder.parentElement);
        var box = { x: stackBox.x + folder.offsetLeft, y: stackBox.y + folder.offsetTop + scrollY,
          width: folder.offsetWidth, height: folder.offsetHeight };
        var tabX = tab.offsetLeft + tab.parentElement.offsetLeft;
        return { url: sheet.href, label: tab.textContent.trim(), box: box, tabX: tabX, tab: metric(tab),
          paper: getComputedStyle(sheet).backgroundColor,
          cover: getComputedStyle(folder.querySelector('.folder-band')).backgroundColor };
      }).filter(Boolean);
      try { sessionStorage.setItem(HOME_KEY, JSON.stringify({ width: innerWidth, vh: vh(), targets: targets })); } catch (_) {}
    }
    // Only measure at rest: home return animations temporarily transform the
    // stack, and the folders ease to their final heights (--cover-min lands
    // after load, again once the webfonts do), so wait those out first.
    function atRest() {
      var running = document.getAnimations ? document.getAnimations().filter(function (a) {
        return a.transitionProperty === 'height' && a.effect && a.effect.target &&
          a.effect.target.classList.contains('folder');
      }) : [];
      if (!running.length) { measure(); return; }
      Promise.all(running.map(function (a) { return a.finished.catch(function () {}); })).then(atRest);
    }
    if (!returning) atRest();
    if (document.fonts) document.fonts.ready.then(function () { if (!returning) atRest(); });
    addEventListener('resize', function () { setTimeout(function () { if (!returning) atRest(); }, 180); });
    addEventListener('neo:home-opened', atRest);
    addEventListener('neo:home-layout', atRest);
  }

  // Read from partway down a file, the folder would fold up from wherever it
  // has scrolled to, half off screen. So glide back to the top first, then
  // close. A long way down jumps most of the distance at once, so the glide
  // is only ever about a screen long.
  function closeHome(url) {
    var page = document.querySelector('.frame > .page');
    if (!page || reduce || leaving || document.documentElement.classList.contains('file-arriving')) return false;
    if (!page.querySelector('.side-tab')) return false;
    if (scrollY <= 1) return closeHomeNow(url);
    leaving = true;
    var html = document.documentElement;
    html.classList.add('file-rewinding');
    if (scrollY > innerHeight * 1.5) scrollTo({ top: innerHeight, behavior: 'instant' });
    scrollTo({ top: 0, behavior: 'smooth' });
    var done = false, started = Date.now();
    function go() {
      if (done) return;
      done = true;
      removeEventListener('scrollend', check);
      html.classList.remove('file-rewinding');
      leaving = false;
      if (!closeHomeNow(url)) location.assign(url.href);
    }
    function check() {
      if (scrollY <= 1 || Date.now() - started > 1500) go();
      else if (!done) requestAnimationFrame(check);
    }
    addEventListener('scrollend', check);
    requestAnimationFrame(check);
    setTimeout(go, 1600);
    return true;
  }

  function closeHomeNow(url) {
    var page = document.querySelector('.frame > .page');
    if (!page || leaving) return false;
    var active = page.querySelector('.side-tab.is-active') || page.querySelector('.side-tab');
    if (!active) return false;
    leaving = true;
    var box = rect(page), tab = metric(active), colour = getComputedStyle(page, '::before').backgroundColor;
    var target = null;
    try {
      var layout = JSON.parse(sessionStorage.getItem(HOME_KEY));
      if (layoutFits(layout)) {
        target = layout.targets.find(function (t) { return t.label === active.textContent.trim(); }) ||
          layout.targets.find(function (t) { return new URL(t.url).pathname === location.pathname; });
      }
    } catch (_) {}
    var end = target ? target.box : { x: innerWidth <= 620 ? 10 : 16, y: innerHeight - 190,
      width: document.documentElement.clientWidth - (innerWidth <= 620 ? 20 : 32), height: Math.max(innerHeight, box.width) };
    var state = { kind: 'close', url: url.href, time: Date.now(), source: location.href,
      label: target ? target.label : active.textContent.trim(), box: end, cover: target ? target.cover : colour };
    var stage = document.createElement('div');
    stage.className = 'file-flight-stage'; stage.inert = true; stage.setAttribute('aria-hidden', 'true');
    var flight = document.createElement('div');
    flight.className = 'file-flight';
    var length = Math.max(innerHeight - box.y + 160, innerWidth);
    setStyle(flight, { left: '0', top: '0', width: length + 'px', height: box.width + 'px',
      transform: 'translate(' + (box.x + box.width) + 'px,' + box.y + 'px) rotate(90deg)' });
    var windowEl = document.createElement('div');
    windowEl.className = 'file-flight-window'; windowEl.style.backgroundColor = colour;
    var content = page.cloneNode(true);
    content.classList.remove('is-sliding'); content.classList.add('file-flight-content');
    content.querySelectorAll('.side-tabs, .side-page-peek, .page-cover').forEach(function (el) { el.remove(); });
    // Ids stay: pieces styled by id (#bb-input) would otherwise change size
    // at the hand-off. The copy sits after the real page, so lookups by id
    // still find the real elements, and it is gone once the swing ends.
    // Pinned to the tab edge by a fixed offset (not top:100%, which moves as
    // the folder resizes mid-turn), so the paper rides rigidly with it.
    setStyle(content, { width: box.width + 'px', height: box.height + 'px', margin: '0',
      top: box.width + 'px', padding: getComputedStyle(page).padding, opacity: '1', '--folder': colour });
    windowEl.appendChild(content); flight.appendChild(windowEl);
    // Each flying tab gets a 4px skirt of its own colour (the box-shadow),
    // tucked behind the folder: while it turns, sub-pixel rounding would
    // otherwise open a hairline of desk between tab and folder.
    var labels = Array.from(page.querySelectorAll('.side-tab')).map(function (original) {
      var m = metric(original), style = getComputedStyle(original), copy = document.createElement('span');
      copy.className = 'file-flight-tab'; copy.textContent = original.textContent;
      setStyle(copy, { left: original.offsetLeft + 'px', bottom: 'calc(100% - 2px)',
        height: m.height, width: m.width, fontSize: m.fontSize, padding: m.padding,
        color: style.color, backgroundColor: style.backgroundColor, boxShadow: '0 4px 0 ' + style.backgroundColor, transform: style.transform,
        '--file-tab-shoulder': m.shoulder });
      flight.appendChild(copy);
      return { el: copy, active: original === active, left: original.offsetLeft, transform: style.transform };
    });
    var cover = document.createElement('div');
    cover.className = 'file-flight-cover';
    setStyle(cover, { backgroundColor: colour, transform: 'rotateX(-180deg)' });
    flight.appendChild(cover); stage.appendChild(flight); document.body.appendChild(stage);
    document.documentElement.classList.add('file-closing');
    var animations = [], navigated = false, timeout;
    function animate(el, frames, options) { var a = el.animate(frames, options); animations.push(a); return a; }
    function go() {
      if (navigated) return;
      navigated = true; clearTimeout(timeout);
      state.time = Date.now();
      try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
      location.assign(url.href);
    }
    resetClose = function () {
      clearTimeout(timeout); animations.forEach(function (a) { a.cancel(); }); stage.remove();
      document.documentElement.classList.remove('file-closing'); leaving = false;
    };
    var timing = { duration: 1500, easing: SWING, fill: 'both' };
    var move = animate(flight, [
      { width: length + 'px', height: box.width + 'px', transform: flight.style.transform },
      { width: end.width + 'px', height: end.height + 'px', transform: 'translate(' + end.x + 'px,' + end.y + 'px) rotate(0deg)' }
    ], timing);
    animate(cover, [{ transform: 'rotateX(-180deg)', backgroundColor: colour },
      { transform: 'rotateX(0deg)', backgroundColor: target ? target.cover : colour }], timing);
    animate(content, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 950, fill: 'both' });
    labels.forEach(function (label) {
      if (!label.active) {
        animate(label.el, [{ transform: label.transform, opacity: 1 }, { transform: 'translateY(110%)', opacity: 0 }],
          { duration: 400, easing: 'ease-in', fill: 'both' });
      } else {
        var endTab = target ? target.tab : tab;
        animate(label.el, [
          { left: label.left + 'px', bottom: 'calc(100% - 2px)', width: tab.width, height: tab.height, fontSize: tab.fontSize, padding: tab.padding },
          { left: (target ? target.tabX : parseFloat(tab.shoulder)) + 'px', bottom: '100%',
            width: endTab.width, height: endTab.height, fontSize: endTab.fontSize, padding: endTab.padding }
        ], timing);
      }
    });
    document.querySelectorAll('.masthead .char').forEach(function (char, i) {
      animate(char, [{ transform: getComputedStyle(char).transform, opacity: 1 }, { transform: 'translateX(-150%)', opacity: 0 }],
        { duration: 650, delay: Math.min(i * 20, 500), easing: 'ease-in-out', fill: 'both' });
    });
    var footer = document.querySelector('.site-footer');
    if (footer) animate(footer, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'both' });
    move.finished.then(go, function () {});
    timeout = setTimeout(go, 1800);
    return true;
  }

  function arriveHome() {
    if (!returning || !document.body.classList.contains('home')) return;
    var state = returning, html = document.documentElement, animations = [], done = false;
    html.classList.add('home-returned');
    var sheets = Array.from(document.querySelectorAll('a.folder-page'));
    var sheet = sheets.find(function (el) { return el.querySelector('.is-own').textContent.trim() === state.label; }) ||
      sheets.find(function (el) { return new URL(el.href).pathname === new URL(state.source).pathname; });
    var selected = sheet && sheet.closest('.folder');
    function animate(el, frames, options) { var a = el.animate(frames, options); animations.push(a); return a; }
    function finish() {
      if (done) return;
      done = true;
      html.classList.remove('home-returning');
      animations.forEach(function (a) { a.cancel(); });
      if (selected) selected.style.removeProperty('transform-origin');
      returning = null;
      dispatchEvent(new Event('neo:home-opened'));
    }
    try {
      document.querySelectorAll('.folder').forEach(function (folder, i) {
        if (folder === selected) {
          var dest = rect(folder);
          folder.style.transformOrigin = 'top left';
          animate(folder, [
            { opacity: 1, transform: 'translate(' + (state.box.x - dest.x) + 'px,' + (state.box.y - dest.y) + 'px) scale(' + (state.box.width / dest.width) + ',' + (state.box.height / dest.height) + ')' },
            { opacity: 1, transform: 'none' }
          ], { duration: 450, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'both' });
          var band = folder.querySelector('.folder-band');
          animate(band, [{ backgroundColor: state.cover }, { backgroundColor: getComputedStyle(band).backgroundColor }],
            { duration: 450, fill: 'both' });
        } else {
          animate(folder, [{ opacity: 0, transform: 'translateY(120%)' }, { opacity: 1, transform: 'none' }],
            { duration: 900, delay: 80 + i * 60, easing: 'cubic-bezier(.165,.84,.44,1)', fill: 'both' });
        }
      });
      var intro = document.querySelector('.home-intro');
      if (intro) animate(intro, [{ opacity: 0, transform: 'translateY(32px)' }, { opacity: 1, transform: 'none' }],
        { duration: 900, delay: 120, easing: 'ease-out', fill: 'both' });
      // only what is always on show: the number, title and description stay
      // hidden until the folder is hovered, so they must not be faded in here
      if (selected) selected.querySelectorAll('.folder-go, .folder-tab.is-own').forEach(function (el) {
        if (el.textContent.trim() === state.label) return;
        animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 350, fill: 'both' });
      });
      Promise.all(animations.map(function (a) { return a.finished; })).then(finish, finish);
      setTimeout(finish, 1700);
      addEventListener('pagehide', finish, { once: true });
    } catch (_) { finish(); }
  }

  function arrive(page) {
    var permanentCover = ensureCover(page);
    if (!incoming) return false;
    var state = incoming;
    var stage, flight, cover, finished = false, started = false, animations = [];
    var safety;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      animations.forEach(function (a) { a.cancel(); });
      if (cover) {
        // Once open, inherit the current section colour all the way to the
        // viewport edge; do not pin this surface to the home cover colour.
        cover.className = 'page-cover';
        cover.removeAttribute('style');
        permanentCover.replaceWith(cover);
      }
      if (stage) stage.remove();
      document.documentElement.classList.remove('file-arriving');
      document.documentElement.classList.add('opened');
      incoming = null;
      dispatchEvent(new Event('neo:file-opened'));
    }
    try {
      var dest = rect(page), rail = page.querySelector('.side-tabs');
      var active = rail && (rail.querySelector('.is-active') || rail.firstElementChild);
      var activeOffset = active ? active.offsetLeft : parseFloat(state.tab.shoulder);
      var length = Math.max(innerHeight - dest.y + 160, state.box.width);
      stage = document.createElement('div');
      stage.className = 'file-flight-stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.inert = true;
      stage.style.perspectiveOrigin = state.perspective.join('px ') + 'px';
      flight = document.createElement('div');
      flight.className = 'file-flight';
      setStyle(flight, {
        left: '0', top: '0',
        transform: 'translate(' + state.box.x + 'px,' + state.box.y + 'px)',
        width: state.box.width + 'px', height: state.box.height + 'px'
      });
      var windowEl = document.createElement('div');
      windowEl.className = 'file-flight-window';
      windowEl.style.backgroundColor = state.paper;
      var content = page.cloneNode(true);
      content.classList.add('file-flight-content');
      content.querySelectorAll('.side-tabs, .side-page-peek, .page-cover').forEach(function (el) { el.remove(); });
      // Ids stay: pieces styled by id (#bb-input) would otherwise change size
      // at the hand-off. The copy sits after the real page, so lookups by id
      // still find the real elements, and it is gone once the swing ends.
      setStyle(content, {
        width: dest.width + 'px', height: dest.height + 'px', top: dest.width + 'px',
        padding: getComputedStyle(page).padding, margin: '0',
        '--folder': state.paper, '--edge': getComputedStyle(page).getPropertyValue('--edge')
      });
      windowEl.appendChild(content);
      flight.appendChild(windowEl);
      var label = document.createElement('span');
      label.className = 'file-flight-tab';
      label.textContent = state.label;
      setStyle(label, {
        left: state.tabX + 'px', height: state.tab.height, width: state.tab.width,
        fontSize: state.tab.fontSize, padding: state.tab.padding,
        color: state.ink, backgroundColor: state.paper, boxShadow: '0 4px 0 ' + state.paper,
        '--file-tab-shoulder': state.tab.shoulder
      });
      flight.appendChild(label);
      // Carry the neighbouring tabs with the turning folder. Their opening
      // begins before the handoff, so the real rail never flashes into view.
      var neighbours = [];
      var railTabs = rail ? Array.from(rail.children) : [];
      var activeIndex = railTabs.indexOf(active);
      railTabs.forEach(function (tab, i) {
        if (tab === active) return;
        var m = metric(tab), s = getComputedStyle(tab);
        var copy = document.createElement('span');
        copy.className = 'file-flight-tab';
        copy.textContent = tab.textContent;
        setStyle(copy, {
          left: tab.offsetLeft + 'px', bottom: 'calc(100% - 2px)',
          height: m.height, width: m.width, fontSize: m.fontSize, padding: m.padding,
          color: s.color, backgroundColor: s.backgroundColor, boxShadow: '0 4px 0 ' + s.backgroundColor, opacity: '0',
          '--file-tab-shoulder': m.shoulder
        });
        flight.appendChild(copy);
        neighbours.push({ el: copy, index: i, transform: s.transform });
      });
      // The sheets in front of the picked one, each a hair behind the next,
      // so they turn over as one with the cover (see depart).
      var closedPose = state.coverTransform === 'none' ? 'translateY(0px) rotateX(0deg)' : state.coverTransform;
      var fronts = (state.fronts || []).map(function (colour, n) {
        var sheetEl = document.createElement('div');
        sheetEl.className = 'file-flight-cover';
        var z = ' translateZ(' + -(state.fronts.length - n) * 0.5 + 'px)';
        setStyle(sheetEl, { backgroundColor: colour, transform: closedPose + z });
        flight.appendChild(sheetEl);
        return { el: sheetEl, colour: colour, z: z };
      });
      cover = document.createElement('div');
      cover.className = 'file-flight-cover';
      setStyle(cover, {
        backgroundColor: state.cover, transform: state.coverTransform,
        '--cover-light': state.light
      });
      flight.appendChild(cover);
      stage.appendChild(flight);
      document.body.appendChild(stage);
      document.documentElement.classList.add('opened');

      function animate(el, frames, options) {
        var a = el.animate(frames, options);
        animations.push(a);
        return a;
      }
      startFlight = function () {
        if (started || finished) return;
        started = true;
        var timing = { duration: 1500, easing: SWING, fill: 'both' };
        animate(flight, [
          { width: state.box.width + 'px', height: state.box.height + 'px', transform: 'translate(' + state.box.x + 'px,' + state.box.y + 'px) rotate(0deg)' },
          { width: length + 'px', height: dest.width + 'px', transform: 'translate(' + (dest.x + dest.width) + 'px,' + dest.y + 'px) rotate(90deg)' }
        ], timing);
        // The original hover rotation is the first frame, not a new closed lid.
        animate(cover, [
          { transform: state.coverTransform === 'none' ? 'translateY(0px) rotateX(0deg)' : state.coverTransform },
          { transform: 'translateY(0px) rotateX(180deg)' }
        ], timing);
        animate(cover, [{ backgroundColor: state.cover }, { backgroundColor: state.paper }],
          { duration: 600, delay: 900, easing: 'ease', fill: 'both' });
        fronts.forEach(function (f) {
          animate(f.el, [
            { transform: closedPose + f.z },
            { transform: 'translateY(0px) rotateX(180deg)' + f.z }
          ], timing);
          animate(f.el, [{ backgroundColor: f.colour }, { backgroundColor: state.paper }],
            { duration: 600, delay: 900, easing: 'ease', fill: 'both' });
        });
        animate(label, [
          { left: state.tabX + 'px', bottom: '100%' },
          { left: activeOffset + 'px', bottom: 'calc(100% - 2px)' }
        ], timing);
        neighbours.forEach(function (tab) {
          animate(tab.el, [
            { transform: 'translateY(110%)', opacity: 0 },
            { transform: tab.transform, opacity: 1 }
          ], tabTiming(tab.index, activeIndex));
        });
        animate(content, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 200, fill: 'both' });
        // The 5% hover highlight fades away as the same front turns over.
        cover.style.setProperty('--cover-light', '0');
        Promise.all(animations.map(function (a) { return a.finished; })).then(finish, finish);
      };
      if (reveal) reveal.then(startFlight);
      else if (!('onpagereveal' in window)) requestAnimationFrame(startFlight);
      // Also works when pagereveal happened before this script or is skipped.
      setTimeout(startFlight, 180);
      safety = setTimeout(finish, 2200);
      addEventListener('pagehide', finish, { once: true });
      return true;
    } catch (err) {
      finish();
      return false;
    }
  }

  // Warm only same-origin documents, without executing them or rewriting history.
  var warmed = new Set();
  addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a.folder-page').forEach(function (a) {
      function warm() {
        var url = new URL(a.href);
        url.hash = '';
        if (url.origin !== location.origin || warmed.has(url.href)) return;
        warmed.add(url.href);
        var link = document.createElement('link');
        link.rel = 'prefetch'; link.as = 'document'; link.href = url.href;
        document.head.appendChild(link);
      }
      a.addEventListener('pointerenter', warm, { once: true });
      a.addEventListener('focus', warm, { once: true });
    });
  });
  addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (resetClose) { resetClose(); resetClose = null; }
    leaving = false;
    document.querySelectorAll('.folder-page').forEach(function (sheet) { sheet.style.removeProperty('visibility'); sheet.classList.remove('is-tucked'); });
    document.querySelectorAll('.folder-band').forEach(function (band) {
      band.style.removeProperty('transition');
      band.style.removeProperty('transform');
      band.style.removeProperty('--held-light');
    });
  });
  // A file reached without passing through home (a shared link, a bookmark)
  // has no home layout to close back into, so it would fold up somewhere
  // generic and then jump. Lay home out in a hidden frame at this exact
  // window size instead: its own rememberHome() records where every folder
  // sits (sessionStorage is shared), then the frame goes away. Redone after
  // a resize, since the stack moves with the window.
  var measuringHome = null;
  function haveHomeLayout() {
    try {
      return layoutFits(JSON.parse(sessionStorage.getItem(HOME_KEY)));
    } catch (_) { return false; }
  }
  function measureHomeOffscreen() {
    var home = document.querySelector('.topbar-home[href]');
    if (!home || document.body.classList.contains('home') || haveHomeLayout()) return;
    if (measuringHome) measuringHome.remove();
    var frame = measuringHome = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // in the viewport but see-through and behind the page: a frame that is
    // off screen or hidden gets throttled, and its folders would never finish
    // easing into place
    frame.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;border:0;opacity:0;pointer-events:none;' +
      'width:' + innerWidth + 'px;height:' + vh() + 'px';
    frame.src = new URL(home.getAttribute('href'), location.href).href;
    // it records the layout once its webfonts and folder heights settle,
    // a few seconds in; drop the frame as soon as that lands
    var started = Date.now();
    var poll = setInterval(function () {
      if (!haveHomeLayout() && Date.now() - started < 10000) return;
      clearInterval(poll);
      frame.remove();
      if (measuringHome === frame) measuringHome = null;
    }, 250);
    document.body.appendChild(frame);
  }
  if (!reduce) {
    addEventListener('load', function () { setTimeout(measureHomeOffscreen, 1600); });
    var measureTimer;
    addEventListener('resize', function () {
      clearTimeout(measureTimer);
      measureTimer = setTimeout(measureHomeOffscreen, 500);
    });
  }

  window.neoFileTransition = { depart: depart, arrive: arrive, fitRail: fitRail, ensureCover: ensureCover,
    revealRail: revealRail, closeHome: closeHome, arriveHome: arriveHome, rememberHome: rememberHome };
})();
