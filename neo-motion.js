/* ============================================================
   NEO-MOTION — the shared motion layer.

   The CSS already had one verb: PRESS. Everything that moved,
   moved because it was clicked. That is input. This file adds
   the missing half — OUTPUT — so a computed answer arrives
   instead of silently replacing the previous text.

   Three verbs, and that is deliberately all:
     arrive   a result landed        (stamp)
     shutter  a panel replaced       (wipe)
     jolt     the page said no       (shake)

   The hazard bar is the fourth thing here, and it is not a verb —
   it is the only motion allowed to loop, and only while waiting.
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---------- TOPBAR: SCROLL TO CURRENT ----------
     The nav sits in a fixed order, so on a narrow screen the current page's
     chip can start off the right edge — leaving the reader unable to see where
     they are in the hierarchy. On load, scroll the bar just far enough to bring
     the current chip fully into view (right-aligned, with a little breathing
     room). It only scrolls when the chip actually overflows, so on a wide
     screen where everything fits, nothing moves. Runs once — it does not fight
     the reader if they scroll the bar themselves afterwards. */
  function scrollNavToCurrent() {
    var links = document.querySelector('.topbar-links');
    var here = links && links.querySelector('.here');
    if (!here) return;
    var pad = 12;
    var overflowRight = here.getBoundingClientRect().right
                      - links.getBoundingClientRect().right;
    if (overflowRight > 0) links.scrollLeft += overflowRight + pad;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mountHazard();
      scrollNavToCurrent();
    });
  } else {
    mountHazard();
    scrollNavToCurrent();
  }
})();
