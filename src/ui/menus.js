'use strict';
const { Notice, Scope, setIcon } = require('obsidian');
const { statusMark, el, button } = require('./elements.js');
const { errorMessage } = require('./format.js');

function positionPopup(popup, anchor) {
  const win = anchor.ownerDocument.defaultView;
  popup.style.position = 'fixed';
  const r = anchor.getBoundingClientRect(),
    left = popup.dataset.align === 'end' ? r.right - popup.offsetWidth : r.left;
  popup.style.left = Math.max(12, Math.min(left, win.innerWidth - popup.offsetWidth - 12)) + 'px';
  const room = win.innerHeight - r.bottom - 12;
  popup.style.top =
    (room >= Math.min(popup.offsetHeight, 200)
      ? r.bottom + 5
      : Math.max(12, r.top - popup.offsetHeight - 5)) + 'px';
  if (popup.dataset.fitViewport === 'true') {
    const top = r.bottom + 5 + popup.offsetHeight <= win.innerHeight - 12
      ? r.bottom + 5 : r.top - popup.offsetHeight - 5;
    popup.style.top = Math.max(12, Math.min(top, win.innerHeight - popup.offsetHeight - 12)) + 'px';
  }
}
function floatingPopup(anchor, cls) {
  const doc = anchor.ownerDocument,
    win = doc.defaultView;
  const layer = el(anchor.closest('.modal') || doc.body, 'div', 'pikoboard pb-floating-layer');
  const popup = el(layer, 'div', 'pb-popover ' + cls);
  const reposition = (e) => {
    if (!anchor.isConnected) return;
    if (e && popup.contains(e.target)) return;
    positionPopup(popup, anchor);
  };
  win.addEventListener('resize', reposition);
  doc.addEventListener('scroll', reposition, true);
  const observer = new ResizeObserver(() => reposition());
  observer.observe(anchor);
  popup._dispose = () => {
    observer.disconnect();
    win.removeEventListener('resize', reposition);
    doc.removeEventListener('scroll', reposition, true);
    layer.remove();
  };
  return popup;
}
let activeActionMenu = null;
function actionMenu(anchor, items, label = 'Entry actions', app) {
  const previous = activeActionMenu;
  if (previous) {
    previous.close();
    if (previous.anchor === anchor) return;
  }
  const doc = anchor.ownerDocument,
    popup = floatingPopup(anchor, 'pb-action-menu');
  popup.dataset.align = 'end';
  popup.setAttribute('role', 'menu');
  popup.setAttribute('aria-label', label);
  anchor.setAttribute('aria-expanded', 'true');
  const choices = [];
  let closed = false,
    keyScope = null;
  const close = (focus = false) => {
    if (closed) return;
    closed = true;
    if (keyScope) app.keymap.popScope(keyScope);
    doc.removeEventListener('pointerdown', outside, true);
    doc.defaultView.removeEventListener('keydown', keyboard, true);
    observer.disconnect();
    popup._dispose();
    anchor.setAttribute('aria-expanded', 'false');
    if (activeActionMenu?.popup === popup) activeActionMenu = null;
    if (focus && anchor.isConnected) anchor.focus();
  };
  const outside = (e) => {
    if (!popup.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const keyboard = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close();
  };
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected) close();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  activeActionMenu = { anchor, popup, close };
  if (app?.keymap) {
    keyScope = new Scope();
    keyScope.register([], 'Escape', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return false;
    });
    app.keymap.pushScope(keyScope);
  }
  for (const item of items) {
    if (item.separator) {
      el(popup, 'div', 'pb-menu-separator').setAttribute('role', 'separator');
      continue;
    }
    const b = button(
      popup,
      '',
      () => {
        close(true);
        Promise.resolve()
          .then(item.action)
          .catch((e) => new Notice(errorMessage(e)));
      },
      'pb-menu-item' + (item.danger ? ' is-danger' : ''),
    );
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    setIcon(el(b, 'span', 'pb-menu-icon'), item.icon);
    el(b, 'span', 'pb-menu-label', item.label);
    choices.push(b);
  }
  popup.onkeydown = (e) => {
    const index = choices.indexOf(doc.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? choices.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices[n]?.focus();
    }
  };
  doc.addEventListener('pointerdown', outside, true);
  doc.defaultView.addEventListener('keydown', keyboard, true);
  positionPopup(popup, anchor);
  choices[0]?.focus();
  return activeActionMenu;
}
function picker(parent, label, aria, items, onChange, cls = '', options = {}) {
  const wrap = el(parent, 'div', 'pb-picker-wrap');
  const doc = parent.ownerDocument;
  let popup = null,
    cleanup = () => {};
  const trigger = button(wrap, '', () => (popup ? close() : open()), 'pb-picker ' + cls);
  trigger.setAttribute('aria-label', aria);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (options.icon) {
    const mark = el(trigger, 'span', 'pb-filter-icon');
    mark.setAttribute('aria-hidden', 'true');
    setIcon(mark, options.icon);
  }
  const caption = el(trigger, 'span', 'pb-picker-label', label);
  setIcon(el(trigger, 'span', 'pb-chevron'), 'chevron-down');
  const choices = () => typeof items === 'function' ? items() : items;
  trigger._isOpen = () => !!popup;
  trigger._update = (text) => {
    caption.textContent = text;
    if (!popup) return;
    const current = choices();
    [...popup.querySelectorAll('button')].forEach((b, index) => {
      b.setAttribute('aria-selected', String(!!current[index]?.selected));
      b.setAttribute('aria-disabled', String(!!current[index]?.disabled));
    });
  };
  function close(focus = false, notify = true) {
    if (!popup) return;
    cleanup();
    popup._dispose();
    popup = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
    if (notify) options.onClose?.();
  }
  function open() {
    popup = floatingPopup(trigger, '');
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', aria);
    if (options.multiple) {
      popup.setAttribute('aria-multiselectable', 'true');
      popup.classList.add('pb-multi-picker');
    }
    choices().forEach((i) => {
      const b = button(
        popup,
        i.label,
        () => {
          const current = choices().find((item) => item.value === i.value);
          if (!current || current.disabled) return;
          if (!options.multiple) close(true);
          Promise.resolve(onChange(i)).catch((e) => new Notice(errorMessage(e)));
        },
        'pb-option',
      );
      if (i.icon) {
        const mark = el(b, 'span', 'pb-status-icon');
        statusMark(mark, i.icon);
        mark.setAttribute('aria-hidden', 'true');
        b.prepend(mark);
      }
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(!!i.selected));
      b.setAttribute('aria-disabled', String(!!i.disabled));
      if (options.multiple) {
        const check = el(b, 'span', 'pb-option-check');
        check.setAttribute('aria-hidden', 'true');
        setIcon(check, 'check');
      }
    });
    positionPopup(popup, trigger);
    trigger.setAttribute('aria-expanded', 'true');
    const outside = (e) => {
      if (!wrap.contains(e.target) && !popup?.contains(e.target)) close();
    };
    doc.addEventListener('pointerdown', outside);
    cleanup = () => doc.removeEventListener('pointerdown', outside);
    popup.onkeydown = (e) => {
      const opts = [...popup.querySelectorAll('button')],
        index = opts.indexOf(doc.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const n =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? opts.length - 1
              : (index + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        opts[n]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') close();
    };
    (popup.querySelector('[aria-selected="true"]') || popup.firstElementChild)?.focus();
  }
  trigger.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!popup) open();
    }
  };
  wrap._dispose = () => close(false, false);
  return trigger;
}

function closeActionMenu() {
  activeActionMenu?.close();
}

module.exports = { positionPopup, floatingPopup, actionMenu, picker, closeActionMenu };
