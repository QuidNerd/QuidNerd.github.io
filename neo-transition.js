/* A cross-document handoff: keep the clicked cover's pose, then move and
   open that cover together. The normal HTML links still own navigation. */
(function () {
  'use strict';
  var KEY = 'junk-drawer:flight';
  // Mosby's swing: 1.5s on GSAP's power3.inOut (a quartic in-out), which
  // gets going decisively and does most of the turn in its quick middle
  var SWING = 'cubic-bezier(.76,0,.24,1)';
  // Depth inside the swinging folder (preserve-3d): the page sits at 0.25px,
  // the sheets in front of it and the cover each a fraction above. Flat on
  // one plane, the browser does not reliably keep the cover on top, and the
  // page underneath could show through instead of it.
  var LIFT = '1px';
  var HOME_KEY = 'junk-drawer:home-layout';
  // Back and forward leave a page with no chance to animate first, so the
  // page arrived at plays the hand-off instead. Each file notes its shape as
  // it is left (FILE_KEY), and every page notes that it was left (LEFT_KEY).
  var FILE_KEY = 'junk-drawer:file-shape', LEFT_KEY = 'junk-drawer:left';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var incoming = null, returning = null, leaving = false, reveal = null, startFlight = null, resetClose = null;
  try {
    incoming = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    var nav = performance.getEntriesByType('navigation')[0];
    if (!incoming || incoming.url !== location.href || Date.now() - incoming.time > 15000 ||
        (nav && nav.type !== (incoming.traverse ? 'back_forward' : 'navigate')) || reduce) incoming = null;
    if (!incoming && nav && nav.type === 'back_forward') useTraversal(traversal());
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
  function bare(u) {
    try { var x = new URL(u, location.href); x.hash = ''; return x.href; } catch (_) { return ''; }
  }
  function readJSON(key) {
    try { return JSON.parse(sessionStorage.getItem(key)); } catch (_) { return null; }
  }
  // The page this one was reached from. The note the old page left wins
  // while it is fresh; the Navigation API's record covers a note not yet
  // written when a page loads afresh in another process.
  function cameFrom() {
    var left = readJSON(LEFT_KEY);
    if (left && Date.now() - left.time < 4000 && bare(left.url) !== bare(location.href)) return left.url;
    try {
      var from = navigation.activation && navigation.activation.from;
      if (from && from.url) return from.url;
    } catch (_) {}
    return null;
  }
  // After back or forward: a file left for home closes on home ({close}),
  // home left for a file opens on the file ({open}); anything else plays
  // as an ordinary visit.
  function traversal() {
    if (reduce) return null;
    var from = cameFrom();
    if (!from || bare(from) === bare(location.href)) return null;
    var shapes = readJSON(FILE_KEY), shape = shapes && shapes[bare(from)];
    if (shape && bare(shape.homeUrl) === bare(location.href)) return { close: shape };
    var layout = readJSON(HOME_KEY);
    if (layout && layout.home && bare(layout.home) === bare(from) && layoutFits(layout) &&
        layout.targets.some(function (t) { return bare(t.url) === bare(location.href); })) return { open: true };
    return null;
  }
  function useTraversal(t) {
    if (!t) return;
    incoming = t.close ? { kind: 'close', replay: t.close } : { pending: true, url: location.href, time: Date.now() };
    document.documentElement.classList.add('flight-replay');
  }
  // A replayed opening only knows it came from home; the folder it opens
  // from is read off home's remembered layout once the rail says which tab
  // this page has open.
  function resolveOpen(rail) {
    if (!incoming || !incoming.pending) return;
    var active = rail && (rail.querySelector('.is-active') || rail.firstElementChild);
    var label = active ? active.textContent.trim() : '';
    var layout = readJSON(HOME_KEY), t = null;
    if (layoutFits(layout)) {
      t = layout.targets.find(function (x) { return x.url === location.href; }) ||
        layout.targets.find(function (x) { return x.label === label; }) ||
        layout.targets.find(function (x) { return bare(x.url) === bare(location.href); });
    }
    if (!t || !t.perspective) {
      incoming = null;
      document.documentElement.classList.remove('file-arriving');
      return;
    }
    incoming = { url: location.href, time: Date.now(), box: t.box, tab: t.tab, label: t.label, tabX: t.tabX,
      ink: t.ink, paper: t.paper, cover: t.cover, coverTransform: 'none', light: '0',
      perspective: t.perspective, gap: t.gap, fronts: t.fronts };
    // A section with no tab on home (on a phone, Frontend Notes) opens out
    // of its folder's tab, but showing its own name and colour from the start
    if (active && label && t.label !== label) {
      incoming.label = label;
      // the rail is not in the page yet, so read its colour token (var(--pink))
      var token = /--[\w-]+/.exec(active.style.getPropertyValue('--c'));
      var colour = token && getComputedStyle(document.documentElement).getPropertyValue(token[0]).trim();
      if (colour) incoming.paper = colour;
      incoming.tab = Object.assign({}, t.tab, { width: 'auto' });
    }
  }
  // Object.assign onto el.style silently drops custom properties (--x), so
  // the swing's --cover-light, --folder and tab shoulders never took effect.
  function setStyle(el, props) {
    Object.keys(props).forEach(function (k) {
      if (k.indexOf('--') === 0) el.style.setProperty(k, props[k]);
      else el.style[k] = props[k];
    });
  }
  // A colour that changes in one step at the halfway point of the swing: the
  // turn eases symmetrically, so that is where the cover stands edge-on.
  function faces(from, to) {
    return [{ backgroundColor: from, offset: 0 }, { backgroundColor: from, offset: 0.5 },
            { backgroundColor: to, offset: 0.5 }, { backgroundColor: to, offset: 1 }];
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
  // `key`: the forward button's file entry to go on to (see the home side of
  // the navigate listener below), instead of a new visit to `url`
  function depart(a, url, key) {
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
    if (key) state.traverse = true;
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); }
    catch (_) { return false; }
    leaving = true;
    // A second step for home itself, between it and the file: forward from
    // home then first comes to that step, within this same page, which
    // can play this very leaving before going on (the forward button can
    // never hold up a move to another page). Added during the click, so
    // the browser does not skip it.
    if (!key && window.navigation && window.top === window) {
      try { history.pushState(history.state, '', location.href); } catch (_) {}
    }
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
      if (key) navigation.traverseTo(key);
      else location.assign(url.href);
    }, total);
    return true;
  }

  function fitRail(rail) {
    resolveOpen(rail);
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
      var targets = Array.from(document.querySelectorAll('a.folder-page[href]')).map(function (sheet) {
        var folder = sheet.closest('.folder'), tab = sheet.querySelector('.folder-tab.is-own');
        if (!tab || !tab.offsetWidth) return null;
        var stackBox = rect(folder.parentElement);
        var box = { x: stackBox.x + folder.offsetLeft, y: stackBox.y + folder.offsetTop + scrollY,
          width: folder.offsetWidth, height: folder.offsetHeight };
        var tabX = tab.offsetLeft + tab.parentElement.offsetLeft;
        // and what depart() hands over, so back/forward can open from here
        var stack = folder.closest('.stack'), sr = rect(stack);
        var origin = getComputedStyle(stack).perspectiveOrigin.split(' ');
        return { url: sheet.href, label: tab.textContent.trim(), box: box, tabX: tabX, tab: metric(tab),
          paper: getComputedStyle(sheet).backgroundColor,
          cover: getComputedStyle(folder.querySelector('.folder-band')).backgroundColor,
          ink: getComputedStyle(tab).color,
          gap: getComputedStyle(folder).getPropertyValue('--tgap').trim() || '14px',
          perspective: [sr.x + parseFloat(origin[0]), sr.y + scrollY + parseFloat(origin[1])],
          fronts: Array.from(folder.querySelectorAll('.folder-page')).filter(function (p) {
            return +p.getAttribute('data-k') < +sheet.getAttribute('data-k');
          }).sort(function (x, y) { return +y.getAttribute('data-k') - +x.getAttribute('data-k'); })
            .map(function (p) { return getComputedStyle(p).backgroundColor; }) };
      }).filter(Boolean);
      try { sessionStorage.setItem(HOME_KEY, JSON.stringify({ width: innerWidth, vh: vh(), home: location.href, targets: targets })); } catch (_) {}
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
  // `key`: a history entry to go back to (the back button, see armBack),
  // instead of a new visit to `url`
  function leaveFor(url, key) {
    if (key) navigation.traverseTo(key);
    else location.assign(url.href);
  }
  function closeHome(url, key) {
    var page = document.querySelector('.frame > .page');
    if (!page || reduce || leaving || document.documentElement.classList.contains('file-arriving')) return false;
    if (!page.querySelector('.side-tab')) return false;
    if (scrollY <= 1) return closeHomeNow(url, key);
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
      if (!closeHomeNow(url, key)) leaveFor(url, key);
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

  // What closing a file needs to know about it, plain data, so that home can
  // replay the close after the back button (see traversal).
  function shapeOf(page) {
    var active = page.querySelector('.side-tab.is-active') || page.querySelector('.side-tab');
    if (!active) return null;
    var box = rect(page), colour = getComputedStyle(page, '::before').backgroundColor;
    box.y += scrollY;   // as it lies at the top, where the close starts
    var home = document.querySelector('.topbar-home[href]');
    return { url: location.href, homeUrl: home ? home.href : '', box: box, tab: metric(active),
      label: active.textContent.trim(), colour: colour,
      // The cover's two faces: lying open it shows its inside, the section's
      // colour; shut, its outside, the parent tab's (--cover). The swap
      // happens edge-on, halfway through the turn, where neither face shows.
      outside: getComputedStyle(document.body).getPropertyValue('--cover').trim() || colour,
      labels: Array.from(page.querySelectorAll('.side-tab')).map(function (original) {
        var style = getComputedStyle(original);
        return { text: original.textContent, left: original.offsetLeft, m: metric(original), color: style.color,
          bg: style.backgroundColor, transform: style.transform, active: original === active };
      }) };
  }

  // The file's paper as it rides in the swinging folder
  function paperOf(page) {
    var content = page.cloneNode(true);
    content.classList.remove('is-sliding'); content.classList.add('file-flight-content');
    content.querySelectorAll('.side-tabs, .side-page-peek, .page-cover').forEach(function (el) { el.remove(); });
    return content;
  }

  // Build and start the closing swing for a file of this shape, carrying
  // `content` (its paper) when there is one. Returns the hand-off state.
  function flyClosed(s, content, parent) {
    var box = s.box, tab = s.tab, colour = s.colour, target = null;
    try {
      var layout = JSON.parse(sessionStorage.getItem(HOME_KEY));
      if (layoutFits(layout)) {
        target = layout.targets.find(function (t) { return t.label === s.label; }) ||
          layout.targets.find(function (t) { return new URL(t.url).pathname === new URL(s.url).pathname; });
      }
    } catch (_) {}
    var end = target ? target.box : { x: innerWidth <= 620 ? 10 : 16, y: innerHeight - 190,
      width: document.documentElement.clientWidth - (innerWidth <= 620 ? 20 : 32), height: Math.max(innerHeight, box.width) };
    // A section with no tab of its own on home (Summoner's court; on a phone,
    // anything but each folder's first) closes into that folder's own tab.
    // It lands as itself, then home swaps it for the right one (arriveHome).
    var swap = target && target.label !== s.label ? { label: s.label, colour: colour } : null;
    var state = { kind: 'close', time: Date.now(), source: s.url,
      label: target ? target.label : s.label, box: end, cover: target ? target.cover : colour, swap: swap };
    var stage = document.createElement('div');
    stage.className = 'file-flight-stage'; stage.inert = true; stage.setAttribute('aria-hidden', 'true');
    var flight = document.createElement('div');
    flight.className = 'file-flight';
    var length = Math.max(innerHeight - box.y + 160, innerWidth);
    setStyle(flight, { left: '0', top: '0', width: length + 'px', height: box.width + 'px',
      transform: 'translate(' + (box.x + box.width) + 'px,' + box.y + 'px) rotate(90deg)' });
    var windowEl = document.createElement('div');
    windowEl.className = 'file-flight-window'; windowEl.style.backgroundColor = colour;
    // Pinned to the tab edge by a fixed offset (not top:100%, which moves as
    // the folder resizes mid-turn), so the paper rides rigidly with it.
    if (content) { content.style.top = box.width + 'px'; windowEl.appendChild(content); }
    flight.appendChild(windowEl);
    // Each flying tab gets a 4px skirt of its own colour (the box-shadow),
    // tucked behind the folder: while it turns, sub-pixel rounding would
    // otherwise open a hairline of desk between tab and folder.
    var labels = s.labels.map(function (l) {
      var copy = document.createElement('span');
      copy.className = 'file-flight-tab'; copy.textContent = l.text;
      setStyle(copy, { left: l.left + 'px', bottom: 'calc(100% - 2px)',
        height: l.m.height, width: l.m.width, fontSize: l.m.fontSize, padding: l.m.padding,
        color: l.color, backgroundColor: l.bg, boxShadow: '0 4px 0 ' + l.bg, transform: l.transform,
        '--file-tab-shoulder': l.m.shoulder });
      flight.appendChild(copy);
      return { el: copy, active: l.active, left: l.left, transform: l.transform };
    });
    var cover = document.createElement('div');
    cover.className = 'file-flight-cover';
    setStyle(cover, { backgroundColor: colour, transform: 'rotateX(-180deg) translateZ(' + LIFT + ')' });
    flight.appendChild(cover); stage.appendChild(flight); (parent || document.body).appendChild(stage);
    var animations = [];
    function animate(el, frames, options) { var a = el.animate(frames, options); animations.push(a); return a; }
    var timing = { duration: 1500, easing: SWING, fill: 'both' };
    var move = animate(flight, [
      { width: length + 'px', height: box.width + 'px', transform: flight.style.transform },
      { width: end.width + 'px', height: end.height + 'px', transform: 'translate(' + end.x + 'px,' + end.y + 'px) rotate(0deg)' }
    ], timing);
    animate(cover, [{ transform: 'rotateX(-180deg) translateZ(' + LIFT + ')' }, { transform: 'rotateX(0deg) translateZ(' + LIFT + ')' }], timing);
    animate(cover, faces(colour, target ? target.cover : s.outside), { duration: timing.duration, fill: 'both' });
    if (content) animate(content, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 950, fill: 'both' });
    labels.forEach(function (label) {
      if (!label.active) {
        animate(label.el, [{ transform: label.transform, opacity: 1 }, { transform: 'translateY(110%)', opacity: 0 }],
          { duration: 400, easing: 'ease-in', fill: 'both' });
      } else {
        var endTab = target ? target.tab : tab;
        var to = { left: (target ? target.tabX : parseFloat(tab.shoulder)) + 'px', bottom: '100%',
          width: endTab.width, height: endTab.height, fontSize: endTab.fontSize, padding: endTab.padding };
        // keeping its own name, it keeps the width that name needs
        if (swap) to.width = tab.width;
        animate(label.el, [
          { left: label.left + 'px', bottom: 'calc(100% - 2px)', width: tab.width, height: tab.height, fontSize: tab.fontSize, padding: tab.padding },
          to
        ], timing);
      }
    });
    return { state: state, stage: stage, move: move, animations: animations, animate: animate };
  }

  function closeHomeNow(url, key) {
    var page = document.querySelector('.frame > .page');
    if (!page || leaving) return false;
    var shape = shapeOf(page);
    if (!shape) return false;
    leaving = true;
    var content = paperOf(page);
    // Ids stay: pieces styled by id (#bb-input) would otherwise change size
    // at the hand-off. The copy sits after the real page, so lookups by id
    // still find the real elements, and it is gone once the swing ends.
    setStyle(content, { width: shape.box.width + 'px', height: shape.box.height + 'px', margin: '0',
      padding: getComputedStyle(page).padding, opacity: '1', '--folder': shape.colour });
    var fly = flyClosed(shape, content), state = fly.state, animate = fly.animate;
    state.url = url.href;
    if (key) state.traverse = true;
    document.documentElement.classList.add('file-closing');
    var navigated = false, timeout;
    function go() {
      if (navigated) return;
      navigated = true; clearTimeout(timeout);
      state.time = Date.now();
      try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
      leaveFor(url, key);
    }
    resetClose = function () {
      clearTimeout(timeout); fly.animations.forEach(function (a) { a.cancel(); }); fly.stage.remove();
      document.documentElement.classList.remove('file-closing'); leaving = false;
    };
    document.querySelectorAll('.masthead .char').forEach(function (char, i) {
      animate(char, [{ transform: getComputedStyle(char).transform, opacity: 1 }, { transform: 'translateX(-150%)', opacity: 0 }],
        { duration: 650, delay: Math.min(i * 20, 500), easing: 'ease-in-out', fill: 'both' });
    });
    var footer = document.querySelector('.site-footer');
    if (footer) animate(footer, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'both' });
    fly.move.finished.then(go, function () {});
    timeout = setTimeout(go, 1800);
    return true;
  }

  // Home reached by the back button from a file: the file is already gone,
  // so its folder closes here instead, from the shape it left behind, then
  // lands in the stack as after a click on "back to".
  // The file's own paper and title, rebuilt from what it left (noteLeaving)
  // in a shadow root carrying neo.css and the file's own styles, so that
  // home's styles and the file's cannot meet.
  var neoRules = null;
  function stylesFor(css, base) {
    var sheets = [];
    try {
      if (neoRules === null) {
        var src = Array.from(document.styleSheets).find(function (s) { return s.href && /\/neo\.css(\?|$)/.test(s.href); });
        neoRules = src ? Array.from(src.cssRules).map(function (r) { return r.cssText; }).join('\n') : '';
      }
      [neoRules, css || '',
        // already lettered in on the file: the copy stands still until it leaves
        'h1 .char { animation: none !important; } .masthead { position: fixed; margin: 0; box-sizing: border-box; }'
      ].forEach(function (text, i) {
        // the file's own styles resolve url()s against the file
        var sheet = new CSSStyleSheet(i === 1 && base ? { baseURL: base } : undefined);
        sheet.replaceSync(text);
        sheets.push(sheet);
      });
    } catch (_) {}
    return sheets;
  }
  // Fonts a file uses but home does not (Newsreader italic, the mono's
  // other weight) are only fetched once something on the page needs them:
  // the copy would show in a stand-in font for a few frames, then jump
  // to the real one. So home loads the Latin set of every face up front.
  function latinFaces() {
    var out = [];
    try {
      document.fonts.forEach(function (f) { if (/U\+0+-0*FF\b/i.test(f.unicodeRange)) out.push(f); });
    } catch (_) {}
    return out;
  }
  function warmFonts() {
    return Promise.all(latinFaces().map(function (f) { return f.load().catch(function () {}); }));
  }
  var waitingFonts = false;
  function replayClose(shape, ready) {
    if (!ready) {
      if (waitingFonts) return;
      if (latinFaces().some(function (f) { return f.status !== 'loaded'; })) {
        waitingFonts = true;
        var go = function () {
          if (!waitingFonts) return;
          waitingFonts = false;
          replayClose(shape, true);
        };
        warmFonts().then(go, go);
        setTimeout(go, 400);
        return;
      }
    }
    var html = document.documentElement, fly = null, landed = false, host = null, extra = [];
    scrollTo(0, 0);
    try {
      var root = null, content = null;
      if (shape.paper && document.adoptedStyleSheets) {
        host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none';
        root = host.attachShadow({ mode: 'open' });
        root.adoptedStyleSheets = stylesFor(shape.css, shape.url);
        var holder = document.createElement('div');
        if (shape.head) {
          holder.innerHTML = shape.head.html;
          var head = holder.firstElementChild;
          setStyle(head, { left: shape.head.x + 'px', top: shape.head.y + 'px', width: shape.head.width + 'px' });
          root.appendChild(head);
          head.querySelectorAll('.char').forEach(function (char, i) {
            extra.push(char.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-150%)', opacity: 0 }],
              { duration: 650, delay: Math.min(i * 20, 500), easing: 'ease-in-out', fill: 'both' }));
          });
        }
        holder.innerHTML = shape.paper;
        content = holder.firstElementChild;
        setStyle(content, { width: shape.box.width + 'px', height: shape.box.height + 'px', margin: '0',
          padding: shape.padding, opacity: '1', '--folder': shape.colour, '--edge': shape.edge || '' });
        document.body.appendChild(host);
      }
      fly = flyClosed(shape, content, root);
      // boxes that were scrolled on the page, scrolled the same in the copy
      if (content) content.querySelectorAll('[data-left-scroll]').forEach(function (el) {
        var at = el.getAttribute('data-left-scroll').split(',');
        el.scrollLeft = +at[0]; el.scrollTop = +at[1];
      });
    } catch (_) {}
    if (!fly) {
      if (host) host.remove();
      returning = null; html.classList.remove('home-returning', 'back-label-out');
      return;
    }
    returning = fly.state;
    html.classList.add('back-label-out');
    function land() {
      if (landed) return;
      landed = true;
      arriveHome();
      fly.animations.concat(extra).forEach(function (a) { a.cancel(); });
      fly.stage.remove();
      if (host) host.remove();
      html.classList.remove('back-label-out');
    }
    fly.move.finished.then(land, land);
    setTimeout(land, 1800);
  }

  function arriveHome() {
    if (!returning || !document.body.classList.contains('home')) return;
    if (returning.replay) { replayClose(returning.replay); return; }
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
      if (state.swap && sheet) swapTab(sheet, state.swap);
      Promise.all(animations.map(function (a) { return a.finished; })).then(finish, finish);
      setTimeout(finish, 1700);
      addEventListener('pagehide', finish, { once: true });
    } catch (_) { finish(); }
  }

  // The file came home from a section home has no tab for: it lands showing
  // that section's tab, in that section's colour, on a stand-in sheet in
  // front of the folder's own. Once it has landed, the stand-in's tab drops
  // into the folder and the folder's own tab rises in its place, the same
  // slide Mosby uses to put tabs away.
  function swapTab(sheet, swap) {
    var realTab = sheet.querySelector('.folder-tab.is-own');
    if (!realTab) return;
    var ghost = sheet.cloneNode(true);
    ghost.removeAttribute('href');
    ghost.removeAttribute('data-k');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.style.setProperty('--pc', swap.colour);
    ghost.style.pointerEvents = 'none';
    var ghostTab = ghost.querySelector('.folder-tab.is-own');
    ghostTab.textContent = swap.label;
    sheet.after(ghost);
    var rows = [realTab.parentElement, ghostTab.parentElement];
    rows.forEach(function (row) { row.style.overflow = 'clip'; });
    realTab.style.transform = 'translateY(110%)';
    function done() {
      ghost.remove();
      rows[0].style.removeProperty('overflow');
      realTab.style.removeProperty('transform');
    }
    setTimeout(function () {
      ghostTab.animate([{ transform: 'none' }, { transform: 'translateY(110%)' }],
        { duration: 400, easing: 'cubic-bezier(.33,1,.68,1)', fill: 'forwards' });
      realTab.style.removeProperty('transform');
      realTab.animate([{ transform: 'translateY(110%)' }, { transform: 'none' }],
        { duration: 500, delay: 150, easing: 'cubic-bezier(.25,1,.5,1)', fill: 'backwards' })
        .finished.then(done, done);
    }, 700);
  }

  function arrive(page) {
    var permanentCover = ensureCover(page);
    resolveOpen(page.querySelector('.side-tabs'));
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
        // Once open it is the page's own cover, lying open: its inside, the
        // section's colour, flat to the viewport edge.
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
      var coverZ = ' translateZ(' + (0.5 + (state.fronts || []).length * 0.5) + 'px)';
      var fronts = (state.fronts || []).map(function (colour, n) {
        var sheetEl = document.createElement('div');
        sheetEl.className = 'file-flight-cover';
        var z = ' translateZ(' + (0.5 + n * 0.5) + 'px)';   /* nearest the picked sheet deepest */
        setStyle(sheetEl, { backgroundColor: colour, transform: closedPose + z });
        flight.appendChild(sheetEl);
        return { el: sheetEl, colour: colour, z: z };
      });
      cover = document.createElement('div');
      cover.className = 'file-flight-cover';
      setStyle(cover, {
        backgroundColor: state.cover, transform: closedPose + coverZ,
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
          { transform: closedPose + coverZ },
          // -180, not 180: the cover lifts toward the viewer and over. From a
          // flat start, +180 swung it back through the page, which then showed
          // in its place for the first half of the turn.
          { transform: 'translateY(0px) rotateX(-180deg)' + coverZ }
        ], timing);
        // outside (parent tab's colour) until edge-on, then its inside
        animate(cover, faces(state.cover, state.paper), { duration: timing.duration, fill: 'both' });
        fronts.forEach(function (f) {
          animate(f.el, [
            { transform: closedPose + f.z },
            { transform: 'translateY(0px) rotateX(-180deg)' + f.z }
          ], timing);
          // turned over they lie on top of the cover, so they show the
          // section's colour from edge-on too
          animate(f.el, faces(f.colour, state.paper), { duration: timing.duration, fill: 'both' });
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
    // Restored as it was left: finish the hand-off here too
    var html = document.documentElement, home = document.body.classList.contains('home');
    html.classList.remove('home-left');
    function backHome(state) {
      html.classList.add('home-returning');
      html.classList.remove('is-picking', 'home-returned');
      document.querySelectorAll('.folder.is-picked').forEach(function (f) {
        f.classList.remove('is-picked');
        f.style.removeProperty('transform');
      });
      // Still as the click that left hovered it: the folder lifted (its
      // number and title showing), the sheets in front of the clicked one
      // turned aside. neo-motion.js resets that only once home has landed,
      // so a fresh visit's resting stack is set here, at once.
      html.classList.add('no-folder-fade');
      document.querySelectorAll('.folder').forEach(function (f) {
        f.classList.remove('is-hovered', 'is-after', 'is-unfolded');
      });
      document.querySelectorAll('.folder-page.is-rotated').forEach(function (p) { p.classList.remove('is-rotated'); });
      void document.body.offsetWidth;
      html.classList.remove('no-folder-fade');
      returning = state;
      arriveHome();
    }
    // the back button's close, played on the file before it left (armBack)
    var handoff = readJSON(KEY);
    if (home && handoff && handoff.traverse && handoff.kind === 'close' && handoff.url === location.href &&
        Date.now() - handoff.time < 15000) {
      sessionStorage.removeItem(KEY);
      backHome(handoff);
      return;
    }
    // the forward button's leaving, played on home before it came here
    // (homeStep): open exactly as from the click
    var opening = null;
    if (!home && handoff && handoff.traverse && handoff.kind !== 'close' && handoff.url === location.href &&
        Date.now() - handoff.time < 15000) {
      sessionStorage.removeItem(KEY);
      opening = handoff;
    }
    var t = opening ? { open: true } : traversal();
    if (!t) return;
    if (t.close && home) backHome({ kind: 'close', replay: t.close });
    else if (t.open) {
      var page = document.querySelector('.frame > .page');
      var rail = page && page.querySelector('.side-tabs');
      if (!rail) return;
      incoming = opening || { pending: true, url: location.href, time: Date.now() };
      html.classList.add('file-arriving');
      fitRail(rail);
      if (!arrive(page)) return;
      // the title was left on show: letter it in again, as on a first visit
      var title = document.querySelector('.masthead h1');
      var chars = title ? Array.from(title.querySelectorAll('.char')) : [];
      if (chars.length) {
        title.style.setProperty('--title-delay', '0.65s');
        chars.forEach(function (c) { c.style.animation = 'none'; });
        void title.offsetWidth;
        chars.forEach(function (c) { c.style.removeProperty('animation'); });
      }
    }
  });

  // The back button from a file to home, in browsers with the Navigation
  // API. Leaving for another document cannot be held up, but a step back
  // within the same one can: so once someone has clicked or typed on the
  // file (Chrome skips steps a page adds unprompted), it adds one more
  // history step for this same address. Back from that step is held, the
  // file closes exactly as "back to Junk Drawer" closes it, and only then
  // does the browser go back to home, with forward still to come here.
  var guardKey = null;
  function armBack(e) {
    if (reduce || leaving || !window.navigation || !navigation.currentEntry) return;
    if (document.body.classList.contains('home') || !document.querySelector('.frame > .page .side-tab')) return;
    if (!navigator.userActivation || !navigator.userActivation.isActive) return;
    var cur = navigation.currentEntry;
    if (cur.key === guardKey) return;
    // a click that is about to leave the page anyway adds nothing
    var a = e && e.target && e.target.closest && e.target.closest('a[href]');
    if (a && bare(a.href) !== bare(location.href)) return;
    var home = document.querySelector('.topbar-home[href]');
    var prev = navigation.entries()[cur.index - 1];
    if (!home || !prev || bare(prev.url) !== bare(home.href)) return;
    history.pushState(history.state, '', location.href);
    guardKey = navigation.currentEntry.key;
  }
  if (window.navigation && !reduce) {
    ['pointerup', 'mousedown', 'keydown'].forEach(function (type) {
      addEventListener(type, armBack, true);
    });
    navigation.addEventListener('navigate', function (e) {
      if (e.navigationType !== 'traverse') return;
      if (document.body.classList.contains('home')) { homeStep(e); return; }
      if (!guardKey || !e.cancelable) return;
      var cur = navigation.currentEntry, entries = navigation.entries();
      if (cur.key !== guardKey) return;
      // home's own entries: the one it was clicked from, and the extra step
      // it added for forward (see depart). Back lands on the first of them.
      var hi = cur.index - 2;
      if (!entries[cur.index - 1] || !entries[hi]) return;
      while (hi > 0 && entries[hi - 1].url === entries[hi].url) hi--;
      var homeEntry = entries[hi];
      if (e.destination.index < hi || e.destination.index >= cur.index) return;
      e.preventDefault();
      var url = new URL(homeEntry.url);
      if (!closeHome(url, homeEntry.key)) navigation.traverseTo(homeEntry.key);
    });
  }
  // Home's two entries (see depart) are one page, so moving between them
  // stays here. Forward onto the second plays the click's leaving, then goes
  // on to the file after it. Neither move may restore a scroll position:
  // the leaving glides up from wherever home is.
  function homeStep(e) {
    if (window.top !== window || !e.destination.sameDocument || !e.canIntercept) return;
    var cur = navigation.currentEntry, entries = navigation.entries();
    var dest = entries[e.destination.index];
    if (!dest || dest.url !== cur.url) return;
    try { e.intercept({ scroll: 'manual' }); } catch (_) { return; }
    var next = entries[e.destination.index + 1];
    if (e.destination.index !== cur.index + 1 || !next || leaving) return;
    var sheets = Array.from(document.querySelectorAll('a.folder-page[href]'));
    var a = sheets.find(function (x) { return x.href === next.url; }) ||
      sheets.find(function (x) { return bare(x.href) === bare(next.url); });
    if (!a) return;
    setTimeout(function () {
      if (!depart(a, new URL(next.url), next.key)) navigation.traverseTo(next.key);
    }, 0);
  }
  // Home reached on its second entry (back from a file that was never
  // clicked on, so the file could not hold the step): step onto the first,
  // so that forward from here plays the leaving.
  function settleHome() {
    if (!window.navigation || window.top !== window || !document.body.classList.contains('home')) return;
    var cur = navigation.currentEntry, prev = cur && navigation.entries()[cur.index - 1];
    if (prev && prev.url === cur.url) navigation.traverseTo(prev.key);
  }
  addEventListener('pageshow', function () { setTimeout(settleHome, 0); });

  // Note this page's leaving, and a file's shape, for the page arrived at
  function noteLeaving(e) {
    try {
      sessionStorage.setItem(LEFT_KEY, JSON.stringify({ url: location.href, time: Date.now() }));
      if (document.body.classList.contains('home')) {
        // left for a file: if it comes back from the browser's cache, the
        // stack must not show for a frame as it was left (see pageshow)
        if (e.type === 'pagehide' && document.documentElement.classList.contains('is-picking'))
          document.documentElement.classList.add('home-left');
        return;
      }
      var page = document.querySelector('.frame > .page');
      var shape = page && shapeOf(page);
      if (!shape) return;
      // and what home needs to close it as "back to" does: the paper, the
      // title, and the file's own styles for them
      var head = document.querySelector('.masthead'), r = head && rect(head);
      // its addresses made absolute: home sits elsewhere, so a relative
      // image path would miss
      // Leave out what this page has hidden: some of it is hidden only by a
      // class on <body> (.has-rail .tabs, the old tab row), which the copy
      // on home does not have, so it would show up there again
      // A copy also keeps only what is written in the markup: what was typed
      // into a field, what was ticked or picked, and how far a box was
      // scrolled live on the elements, so they are written down too.
      var marked = [];
      function mark(el, name, value) { el.setAttribute(name, value); marked.push([el, name]); }
      page.querySelectorAll('*').forEach(function (el) {
        if (el.closest('script, style, template')) return;
        if (getComputedStyle(el).display === 'none') { mark(el, 'data-left-out', ''); return; }
        if (el.matches('input, textarea, select')) mark(el, 'data-left-field', '');
        if (el.scrollTop || el.scrollLeft) mark(el, 'data-left-scroll', el.scrollLeft + ',' + el.scrollTop);
      });
      var fields = page.querySelectorAll('[data-left-field]');
      var paper = paperOf(page);
      paper.querySelectorAll('[data-left-field]').forEach(function (copy, i) {
        var live = fields[i];
        if (!live) return;
        if (live.matches('textarea')) copy.textContent = live.value;
        else if (live.matches('select')) Array.from(copy.options).forEach(function (o, k) {
          if (live.options[k] && live.options[k].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected');
        });
        else if (/^(checkbox|radio)$/.test(live.type)) { if (live.checked) copy.setAttribute('checked', ''); else copy.removeAttribute('checked'); }
        else if (live.type !== 'file' && live.type !== 'password') copy.setAttribute('value', live.value);
        copy.removeAttribute('data-left-field');
      });
      marked.forEach(function (m) { m[0].removeAttribute(m[1]); });
      paper.querySelectorAll('[data-left-out]').forEach(function (el) { el.remove(); });
      paper.querySelectorAll('[src]').forEach(function (el) { el.setAttribute('src', el.src); });
      paper.querySelectorAll('[srcset]').forEach(function (el) { el.removeAttribute('srcset'); });
      shape.paper = paper.outerHTML;
      shape.padding = getComputedStyle(page).padding;
      shape.edge = getComputedStyle(page).getPropertyValue('--edge');
      if (head) shape.head = { html: head.outerHTML, x: r.x, y: r.y + scrollY, width: r.width };
      shape.css = Array.from(document.querySelectorAll('style')).map(function (s) { return s.textContent; }).join('\n');
      var shapes = readJSON(FILE_KEY) || {};
      shapes[bare(location.href)] = shape;
      sessionStorage.setItem(FILE_KEY, JSON.stringify(shapes));
    } catch (_) {}
  }
  // home fetches every face once it has loaded, so a file's paper closing
  // back onto it (replayClose) never waits on a font
  function warmHomeFonts() { if (document.body.classList.contains('home')) warmFonts(); }
  if (document.readyState === 'complete') warmHomeFonts(); else addEventListener('load', warmHomeFonts);
  addEventListener('pageswap', noteLeaving);
  addEventListener('pagehide', noteLeaving);
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
