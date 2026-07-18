/* ============================================================
   NEO-SELECT — a dropdown whose OPEN MENU we control.

   A native <select> can be styled shut, but the popup list is
   drawn by the OS and ignores CSS, which is why it kept looking
   like 2011. This keeps the real <select> in the DOM (so all
   existing value/onchange code keeps working untouched) and
   renders a button + listbox on top of it.

   Usage: neoSelect.upgrade(selectEl) or neoSelect.upgradeAll(root)
   Skips anything marked [data-neo-skip].
   ============================================================ */
(function (global) {
  var openMenu = null;

  function closeOpen() {
    if (!openMenu) return;
    openMenu.wrap.classList.remove('open');
    openMenu.list.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }

  document.addEventListener('click', function (e) {
    if (openMenu && !openMenu.wrap.contains(e.target)) closeOpen();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openMenu) { openMenu.btn.focus(); closeOpen(); }
  });

  function labelOf(sel) {
    var o = sel.options[sel.selectedIndex];
    return o ? o.textContent : '';
  }

  function upgrade(sel) {
    if (!sel || sel.dataset.neoDone === '1' || sel.hasAttribute('data-neo-skip')) return;
    sel.dataset.neoDone = '1';

    var wrap = document.createElement('div');
    wrap.className = 'neo-select';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'neo-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="neo-select-label"></span><span class="neo-select-caret"></span>';

    var list = document.createElement('div');
    list.className = 'neo-select-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(btn);
    wrap.appendChild(list);

    var labelEl = btn.querySelector('.neo-select-label');

    function syncLabel() { labelEl.textContent = labelOf(sel); }

    function buildList() {
      list.innerHTML = '';
      Array.prototype.forEach.call(sel.options, function (opt, i) {
        var item = document.createElement('div');
        item.className = 'neo-select-option';
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        if (opt.disabled) item.classList.add('is-disabled');
        if (i === sel.selectedIndex) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        }
        item.addEventListener('click', function () {
          if (opt.disabled) return;
          sel.selectedIndex = i;
          syncLabel();
          // fire the same events the page's own handlers listen for
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          closeOpen();
          btn.focus();
        });
        list.appendChild(item);
      });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = openMenu && openMenu.wrap === wrap;
      closeOpen();
      if (wasOpen) return;
      buildList();
      list.hidden = false;
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      openMenu = { wrap: wrap, list: list, btn: btn };
      var cur = list.querySelector('.is-selected');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    });

    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var n = sel.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1);
        if (n < 0 || n >= sel.options.length) return;
        if (sel.options[n].disabled) return;
        sel.selectedIndex = n;
        syncLabel();
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // the page may repopulate options later (team lists are built by JS)
    sel.addEventListener('change', syncLabel);
    sel.neoSync = syncLabel;
    syncLabel();
  }

  function upgradeAll(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('select'), upgrade);
  }

  function syncAll(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('select'), function (s) {
      if (s.neoSync) s.neoSync();
    });
  }

  global.neoSelect = { upgrade: upgrade, upgradeAll: upgradeAll, syncAll: syncAll };
})(window);
