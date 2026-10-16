/* A cross-document handoff: keep the clicked cover's pose, then move and
   open that cover together. The normal HTML links still own navigation. */
(function () {
  'use strict';
  var KEY = 'junk-drawer:flight';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var incoming = null, leaving = false, reveal = null, startFlight = null;
  try {
    incoming = JSON.parse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    var nav = performance.getEntriesByType('navigation')[0];
    if (!incoming || incoming.url !== location.href || Date.now() - incoming.time > 15000 ||
        (nav && nav.type !== 'navigate') || reduce) incoming = null;
  } catch (_) { incoming = null; }
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
        var move = animate(flight, [
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
        animate(label, [{ left: state.tabX + 'px' }, { left: activeOffset + 'px' }], timing);
        animate(content, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 200, fill: 'both' });
        // The 5% hover highlight fades away as the same front turns over.
        cover.style.setProperty('--cover-light', '0');
        move.finished.then(finish, finish);
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
    leaving = false;
    document.querySelectorAll('.folder-page').forEach(function (sheet) { sheet.style.removeProperty('visibility'); });
    document.querySelectorAll('.folder-band').forEach(function (band) {
      band.style.removeProperty('transition');
      band.style.removeProperty('transform');
      band.style.removeProperty('--held-light');
    });
  });
  window.neoFileTransition = { depart: depart, arrive: arrive, fitRail: fitRail, ensureCover: ensureCover };
})();
