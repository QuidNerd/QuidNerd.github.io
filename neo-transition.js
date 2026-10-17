/* A cross-document handoff: keep the clicked cover's pose, then move and
   open that cover together. The normal HTML links still own navigation. */
(function () {
  'use strict';
  var KEY = 'junk-drawer:flight';
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

  addEventListener('pagereveal', function (e) {
    reveal = e.viewTransition ? e.viewTransition.finished.catch(function () {}) : Promise.resolve();
    if (startFlight) reveal.then(startFlight);
  });

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
      gap: fs.getPropertyValue('--tgap').trim() || '14px'
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); }
    catch (_) { return false; }
    leaving = true;
    // A click can land halfway through hover. Freeze that exact rendered pose
    // so it cannot advance while the next document is being prepared.
    band.style.transition = 'none';
    band.style.transform = state.coverTransform;
    band.style.setProperty('--held-light', state.light);
    document.documentElement.classList.add('is-picking');
    folder.classList.add('is-picked');
    folder.querySelectorAll('.folder-page').forEach(function (other) {
      if (other !== sheet) other.style.visibility = 'hidden';
    });
    // Keep the selected cover still. Only its labels and the other files leave.
    setTimeout(function () { location.assign(url.href); }, 260);
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
      try { sessionStorage.setItem(HOME_KEY, JSON.stringify({ width: innerWidth, height: innerHeight, targets: targets })); } catch (_) {}
    }
    // Only measure at rest: home return animations temporarily transform the stack.
    if (!returning) measure();
    if (document.fonts) document.fonts.ready.then(function () { if (!returning) measure(); });
    addEventListener('resize', function () { setTimeout(function () { if (!returning) measure(); }, 180); });
    addEventListener('neo:home-opened', measure);
    addEventListener('neo:home-layout', measure);
  }

  function closeHome(url) {
    var page = document.querySelector('.frame > .page');
    if (!page || reduce || leaving || document.documentElement.classList.contains('file-arriving')) return false;
    var active = page.querySelector('.side-tab.is-active') || page.querySelector('.side-tab');
    if (!active) return false;
    leaving = true;
    var box = rect(page), tab = metric(active), colour = getComputedStyle(page, '::before').backgroundColor;
    var target = null;
    try {
      var layout = JSON.parse(sessionStorage.getItem(HOME_KEY));
      if (layout && layout.width === innerWidth && layout.height === innerHeight) {
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
    Object.assign(flight.style, { left: '0', top: '0', width: length + 'px', height: box.width + 'px',
      transform: 'translate(' + (box.x + box.width) + 'px,' + box.y + 'px) rotate(90deg)' });
    var windowEl = document.createElement('div');
    windowEl.className = 'file-flight-window'; windowEl.style.backgroundColor = colour;
    var content = page.cloneNode(true);
    content.classList.remove('is-sliding'); content.classList.add('file-flight-content');
    content.querySelectorAll('.side-tabs, .page-cover').forEach(function (el) { el.remove(); });
    content.removeAttribute('id');
    content.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
    Object.assign(content.style, { width: box.width + 'px', height: box.height + 'px', margin: '0',
      padding: getComputedStyle(page).padding, opacity: '1', '--folder': colour });
    windowEl.appendChild(content); flight.appendChild(windowEl);
    var labels = Array.from(page.querySelectorAll('.side-tab')).map(function (original) {
      var m = metric(original), style = getComputedStyle(original), copy = document.createElement('span');
      copy.className = 'file-flight-tab'; copy.textContent = original.textContent;
      Object.assign(copy.style, { left: original.offsetLeft + 'px', bottom: 'calc(100% - 2px)',
        height: m.height, width: m.width, fontSize: m.fontSize, padding: m.padding,
        color: style.color, backgroundColor: style.backgroundColor, transform: style.transform,
        '--file-tab-shoulder': m.shoulder });
      flight.appendChild(copy);
      return { el: copy, active: original === active, left: original.offsetLeft, transform: style.transform };
    });
    var cover = document.createElement('div');
    cover.className = 'file-flight-cover';
    Object.assign(cover.style, { backgroundColor: colour, transform: 'rotateX(-180deg)' });
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
    var timing = { duration: 1500, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
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
      if (selected) selected.querySelectorAll('.folder-band > *, .folder-tab.is-own').forEach(function (el) {
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
      Object.assign(flight.style, {
        left: '0', top: '0',
        transform: 'translate(' + state.box.x + 'px,' + state.box.y + 'px)',
        width: state.box.width + 'px', height: state.box.height + 'px'
      });
      var windowEl = document.createElement('div');
      windowEl.className = 'file-flight-window';
      windowEl.style.backgroundColor = state.paper;
      var content = page.cloneNode(true);
      content.classList.add('file-flight-content');
      content.querySelectorAll('.side-tabs, .page-cover').forEach(function (el) { el.remove(); });
      content.removeAttribute('id');
      content.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
      Object.assign(content.style, {
        width: dest.width + 'px', height: dest.height + 'px',
        padding: getComputedStyle(page).padding, margin: '0',
        '--folder': state.paper, '--edge': getComputedStyle(page).getPropertyValue('--edge')
      });
      windowEl.appendChild(content);
      flight.appendChild(windowEl);
      var label = document.createElement('span');
      label.className = 'file-flight-tab';
      label.textContent = state.label;
      Object.assign(label.style, {
        left: state.tabX + 'px', height: state.tab.height, width: state.tab.width,
        fontSize: state.tab.fontSize, padding: state.tab.padding,
        color: state.ink, backgroundColor: state.paper,
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
        Object.assign(copy.style, {
          left: tab.offsetLeft + 'px', bottom: 'calc(100% - 2px)',
          height: m.height, width: m.width, fontSize: m.fontSize, padding: m.padding,
          color: s.color, backgroundColor: s.backgroundColor, opacity: '0',
          '--file-tab-shoulder': m.shoulder
        });
        flight.appendChild(copy);
        neighbours.push({ el: copy, index: i, transform: s.transform });
      });
      cover = document.createElement('div');
      cover.className = 'file-flight-cover';
      Object.assign(cover.style, {
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
        var timing = { duration: 1500, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
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
    document.querySelectorAll('.folder-page').forEach(function (sheet) { sheet.style.removeProperty('visibility'); });
    document.querySelectorAll('.folder-band').forEach(function (band) {
      band.style.removeProperty('transition');
      band.style.removeProperty('transform');
      band.style.removeProperty('--held-light');
    });
  });
  window.neoFileTransition = { depart: depart, arrive: arrive, fitRail: fitRail, ensureCover: ensureCover,
    revealRail: revealRail, closeHome: closeHome, arriveHome: arriveHome, rememberHome: rememberHome };
})();
