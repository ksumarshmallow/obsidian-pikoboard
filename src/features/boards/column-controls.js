'use strict';
const { Scope } = require('obsidian');
const { statusMark, el, button, icon } = require('../../ui/elements.js');
const { positionPopup, floatingPopup } = require('../../ui/menus.js');

const COLUMN_ICONS = [
  ['inbox', 'Входящие'],
  ['circle-dashed', 'В процессе'],
  ['circle-check', 'Готово'],
  ['clock', 'Часы'],
  ['star', 'Звезда'],
  ['flag', 'Флаг'],
  ['bookmark', 'Закладка'],
  ['lightbulb', 'Идея'],
  ['flask-conical', 'Исследование'],
  ['rocket', 'Ракета'],
  ['heart', 'Сердце'],
  ['coffee', 'Кофе'],
  ['briefcase-business', 'Работа'],
  ['house', 'Дом'],
  ['book-open', 'Книга'],
  ['plane', 'Путешествие'],
  ['message-circle', 'Сообщение'],
  ['pause', 'Пауза'],
  ['eye', 'Проверка'],
  ['archive', 'Архив'],
];
const COLUMN_EMOJI = [
  '✨',
  '💡',
  '📥',
  '📝',
  '🎯',
  '🚀',
  '👀',
  '⏳',
  '✅',
  '📚',
  '💻',
  '🏠',
  '🌿',
  '💜',
  '☕',
  '🧘',
  '🧠',
  '✈️',
  '🎨',
  '🐈',
];
function symbolPicker(parent, column, onChange, app) {
  const wrap = el(parent, 'div', 'pb-symbol-wrap');
  let popup = null,
    cleanup = () => {};
  const trigger = button(wrap, '', () => (popup ? close(true) : open()), 'pb-symbol-trigger');
  trigger.setAttribute('aria-label', 'Выбрать значок');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  const paint = () => {
    trigger.replaceChildren();
    statusMark(trigger, column.icon || 'plus');
    trigger.classList.toggle('is-empty', !column.icon);
  };
  paint();
  function close(focus = false) {
    if (!popup) return;
    cleanup();
    popup._dispose();
    popup = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus && trigger.isConnected) trigger.focus();
  }
  function select(value) {
    column.icon = value;
    paint();
    onChange();
    close(true);
  }
  function open() {
    popup = floatingPopup(trigger, 'pb-symbol-popover');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Значок столбца');
    trigger.setAttribute('aria-expanded', 'true');
    const doc = trigger.ownerDocument;
    const tabs = el(popup, 'div', 'pb-symbol-tabs');
    const grid = el(popup, 'div', 'pb-symbol-grid');
    const custom = el(popup, 'form', 'pb-symbol-custom');
    const entry = el(custom, 'input');
    entry.placeholder = 'Свой эмодзи';
    entry.setAttribute('aria-label', 'Свой эмодзи');
    entry.maxLength = 16;
    const use = icon(custom, 'arrow-up', 'Выбрать эмодзи', () => custom.requestSubmit());
    use.disabled = true;
    const valid = () => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(entry.value);
    entry.oninput = () => {
      use.disabled = !valid();
    };
    custom.onsubmit = (e) => {
      e.preventDefault();
      if (valid()) select(entry.value.trim());
    };
    const draw = (emoji) => {
      grid.replaceChildren();
      custom.hidden = !emoji;
      icons.setAttribute('aria-pressed', String(!emoji));
      emojis.setAttribute('aria-pressed', String(emoji));
      for (const [value, label] of emoji ? COLUMN_EMOJI.map((x) => [x, x]) : COLUMN_ICONS) {
        const choice = button(grid, '', () => select(value), 'pb-symbol-choice');
        statusMark(choice, value);
        choice.setAttribute('aria-label', label);
        choice.setAttribute('aria-pressed', String(column.icon === value));
      }
      positionPopup(popup, trigger);
    };
    const icons = button(tabs, 'Иконки', () => draw(false));
    const emojis = button(tabs, 'Эмодзи', () => draw(true));
    button(popup, 'Без значка', () => select(''), 'pb-symbol-none');
    const outside = (e) => {
      if (!wrap.contains(e.target) && !popup?.contains(e.target)) close();
    };
    const escape = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const scope = app?.keymap ? new Scope() : null;
    if (scope) {
      scope.register([], 'Escape', (e) => {
        escape(e);
        return false;
      });
      app.keymap.pushScope(scope);
    }
    popup.onkeydown = (e) => {
      escape(e);
      if (!popup || e.target === entry) return;
      const choices = [...grid.children],
        i = choices.indexOf(doc.activeElement);
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
      if (delta !== undefined) {
        e.preventDefault();
        choices[(Math.max(0, i) + delta + choices.length) % choices.length]?.focus();
      }
    };
    const observer = new MutationObserver(() => {
      if (!trigger.isConnected) close();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    doc.addEventListener('pointerdown', outside, true);
    cleanup = () => {
      doc.removeEventListener('pointerdown', outside, true);
      observer.disconnect();
      if (scope) app.keymap.popScope(scope);
    };
    draw(!!column.icon && !/^[a-z][a-z0-9-]*$/.test(column.icon));
    (grid.querySelector('[aria-pressed="true"]') || grid.firstElementChild)?.focus();
  }
  wrap._dispose = () => close();
  return trigger;
}
function columnColors(parent, column, onChange) {
  const colors = ['#9ba8c4', '#a99bea', '#83aa96', '#c5a374', '#c28ea7', '#7baabd'];
  const palette = el(parent, 'div', 'pb-color-palette');
  const paint = () =>
    palette
      .querySelectorAll('[data-color]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === column.color)));
  for (const value of colors) {
    const swatch = button(
      palette,
      '',
      () => {
        column.color = value;
        custom.value = value;
        paint();
        onChange();
      },
      'pb-color-swatch',
    );
    swatch.style.setProperty('--swatch', value);
    swatch.dataset.color = value;
    swatch.setAttribute('aria-label', 'Цвет ' + value);
  }
  const custom = el(palette, 'input', 'pb-color-custom');
  custom.type = 'color';
  custom.value = column.color;
  custom.setAttribute('aria-label', 'Свой цвет');
  custom.oninput = () => {
    column.color = custom.value;
    paint();
    onChange();
  };
  paint();
  return palette;
}

module.exports = { symbolPicker, columnColors };
