'use strict';
const { Scope, Notice, getIconIds, setIcon } = require('obsidian');
const { statusMark, el, button, icon } = require('./elements.js');
const { floatingPopup, positionPopup } = require('./menus.js');
const { iconCatalog, searchIcons, iconPreferences, iconId } = require('../domain/icons.js');

const EMOJI = ['✨', '💡', '📥', '📝', '🎯', '🚀', '👀', '⏳', '✅', '📚', '💻', '🏠', '🌿', '💜', '☕', '🧘', '🧠', '✈️', '🎨', '🐈'];
const PAGE_SIZE = 84;
const GRID_COLUMNS = 6;

function symbolPicker(parent, column, onChange, plugin) {
  const app = plugin.app;
  const wrap = el(parent, 'div', 'pb-symbol-wrap');
  let popup = null, cleanup = () => {};
  const trigger = button(wrap, '', () => popup ? close(true) : open(), 'pb-symbol-trigger');
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
  const preferences = () => iconPreferences(plugin.data?.iconPicker);
  async function savePreferences(next) {
    const previous = plugin.data.iconPicker;
    plugin.data.iconPicker = next;
    try {
      await plugin.persist();
      return true;
    } catch (_) {
      if (plugin.data.iconPicker === next) plugin.data.iconPicker = previous;
      new Notice('Не удалось сохранить избранное и недавние иконки.');
      return false;
    }
  }
  function select(value, remember = true) {
    column.icon = value;
    paint();
    onChange();
    close(true);
    if (value && remember) {
      const prefs = preferences();
      prefs.recent = [value, ...prefs.recent.filter((id) => id !== value)].slice(0, 24);
      void savePreferences(prefs);
    }
  }
  function open() {
    const catalog = iconCatalog(getIconIds());
    const byId = new Map(catalog.map((item) => [item.id, item]));
    let tab = 'all', active = byId.get(iconId(column.icon)) || catalog[0], items = [], shown = 0;
    let savingFavorite = false;
    popup = floatingPopup(trigger, 'pb-symbol-popover');
    const openedPopup = popup;
    popup.dataset.fitViewport = 'true';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Значок столбца');
    trigger.setAttribute('aria-expanded', 'true');
    const doc = trigger.ownerDocument;
    const searchRow = el(popup, 'div', 'pb-symbol-search');
    setIcon(el(searchRow, 'span', 'pb-symbol-search-icon'), 'search');
    const search = el(searchRow, 'input');
    search.type = 'text';
    search.value = '';
    search.placeholder = 'Найти иконку…';
    search.setAttribute('aria-label', 'Найти иконку');
    search.setAttribute('autocomplete', 'off');
    search.spellcheck = false;
    const clear = icon(searchRow, 'x', 'Очистить поиск', () => {
      search.value = '';
      draw();
      search.focus();
    });
    const tabs = el(popup, 'div', 'pb-symbol-tabs');
    const tabButtons = new Map();
    const changeTab = (value) => {
      tab = value;
      draw();
    };
    for (const [value, label] of [['all', 'Все'], ['favorites', 'Избранное'], ['recent', 'Недавние']]) {
      const b = button(tabs, label, () => changeTab(value));
      b.setAttribute('aria-label', value === 'favorites' ? 'Избранные иконки' : label + ' иконки');
      tabButtons.set(value, b);
    }
    const emojiTab = icon(tabs, 'smile', 'Эмодзи', () => changeTab('emoji'));
    tabButtons.set('emoji', emojiTab);
    const results = el(popup, 'div', 'pb-symbol-results');
    const grid = el(results, 'div', 'pb-symbol-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Иконки');
    const empty = el(results, 'div', 'pb-symbol-empty');
    const more = button(results, 'Ещё иконки', () => appendPage(), 'pb-symbol-more');
    const custom = el(popup, 'form', 'pb-symbol-custom');
    const entry = el(custom, 'input');
    entry.placeholder = 'Свой эмодзи';
    entry.setAttribute('aria-label', 'Свой эмодзи');
    entry.maxLength = 16;
    const use = icon(custom, 'arrow-up', 'Выбрать эмодзи', () => custom.requestSubmit());
    use.disabled = true;
    const valid = () => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(entry.value);
    entry.oninput = () => { use.disabled = !valid(); };
    custom.onsubmit = (e) => {
      e.preventDefault();
      if (valid()) select(entry.value.trim(), false);
    };
    const footer = el(popup, 'div', 'pb-symbol-footer');
    const preview = el(footer, 'span', 'pb-symbol-preview');
    const name = el(footer, 'span', 'pb-symbol-name');
    const favorite = icon(footer, 'star', 'Добавить в избранное', async () => {
      if (!active || savingFavorite) return;
      savingFavorite = true;
      favorite.disabled = true;
      const prefs = preferences(), id = active.id;
      prefs.favorites = prefs.favorites.includes(id)
        ? prefs.favorites.filter((value) => value !== id) : [...prefs.favorites, id];
      await savePreferences(prefs);
      savingFavorite = false;
      if (popup === openedPopup) {
        const position = results.scrollTop;
        draw();
        results.scrollTop = position;
        favorite.focus();
      }
    });
    favorite.classList.add('pb-symbol-favorite');
    button(popup, 'Без значка', () => select(''), 'pb-symbol-none');

    function previewIcon(item) {
      active = item;
      preview.replaceChildren();
      if (item) statusMark(preview, item.id);
      name.textContent = item?.label || '';
      name.setAttribute('title', item ? item.id : '');
      const saved = item && preferences().favorites.includes(item.id);
      favorite.setAttribute('aria-label', (saved ? 'Убрать из избранного' : 'Добавить в избранное') + (item ? ': ' + item.label : ''));
      favorite.setAttribute('aria-pressed', String(!!saved));
      favorite.disabled = !item || savingFavorite;
    }
    function appendPage() {
      const favorites = preferences().favorites;
      const end = Math.min(items.length, shown + PAGE_SIZE);
      for (const item of items.slice(shown, end)) {
        const choice = button(grid, '', () => select(item.id, tab !== 'emoji'), 'pb-symbol-choice');
        statusMark(el(choice, 'span', 'pb-symbol-glyph'), item.id);
        choice.dataset.icon = item.id;
        choice.setAttribute('aria-label', item.label);
        choice.setAttribute('title', item.label);
        choice.setAttribute('aria-pressed', String(iconId(column.icon) === item.id));
        choice.onfocus = choice.onmouseenter = () => { if (tab !== 'emoji') previewIcon(item); };
        if (favorites.includes(item.id)) {
          const mark = el(choice, 'span', 'pb-symbol-saved');
          setIcon(mark, 'star');
          mark.setAttribute('aria-hidden', 'true');
        }
      }
      shown = end;
      more.hidden = shown >= items.length;
    }
    function draw() {
      const prefs = preferences();
      const source = tab === 'all' ? catalog : tab === 'emoji'
        ? EMOJI.map((id) => ({ id, label: id }))
        : prefs[tab === 'favorites' ? 'favorites' : 'recent'].map((id) => byId.get(id)).filter(Boolean);
      items = tab === 'emoji' ? source : searchIcons(source, search.value);
      grid.replaceChildren();
      shown = 0;
      results.scrollTop = 0;
      appendPage();
      tabButtons.forEach((b, value) => b.setAttribute('aria-pressed', String(value === tab)));
      empty.hidden = items.length > 0;
      empty.textContent = search.value.trim() && tab !== 'emoji' ? 'Ничего не найдено'
        : tab === 'favorites' ? 'Пока нет избранного'
        : tab === 'recent' ? 'Пока нет недавних иконок' : 'Нет доступных иконок';
      custom.hidden = tab !== 'emoji';
      popup.classList.toggle('is-emoji', tab === 'emoji');
      footer.hidden = tab === 'emoji';
      searchRow.hidden = tab === 'emoji';
      clear.hidden = !search.value;
      if (tab !== 'emoji' && !items.some((item) => item.id === active?.id)) active = items[0];
      previewIcon(active);
      positionPopup(popup, trigger);
    }
    search.oninput = () => draw();
    results.onscroll = () => {
      if (results.scrollTop + results.clientHeight >= results.scrollHeight - 64 && shown < items.length) appendPage();
    };
    const outside = (e) => {
      if (!wrap.contains(e.target) && !popup?.contains(e.target)) close();
    };
    const escape = (e) => {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const scope = app?.keymap ? new Scope() : null;
    if (scope) {
      scope.register([], 'Escape', (e) => { escape(e); return false; });
      app.keymap.pushScope(scope);
    }
    popup.onkeydown = (e) => {
      if (e.key === 'Escape') return escape(e);
      if (e.isComposing) return;
      const choices = [...grid.children];
      if (e.target === search) {
        if (e.key === 'ArrowDown') { e.preventDefault(); choices[0]?.focus(); }
        else if (e.key === 'Enter' && items[0]) { e.preventDefault(); select(items[0].id); }
        return;
      }
      const index = choices.indexOf(doc.activeElement);
      if (index < 0) return;
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLUMNS, ArrowUp: -GRID_COLUMNS }[e.key];
      if (delta !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        const next = index + delta;
        if (next < 0) search.focus();
        else {
          if (next >= shown && shown < items.length) appendPage();
          const target = grid.children[Math.min(next, grid.children.length - 1)];
          target?.focus();
          target?.scrollIntoView?.({ block: 'nearest' });
        }
      }
    };
    const focusOutside = (e) => {
      if (!wrap.contains(e.target) && !popup?.contains(e.target)) close();
    };
    const observer = new MutationObserver(() => { if (!trigger.isConnected) close(); });
    observer.observe(doc.body, { childList: true, subtree: true });
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', focusOutside, true);
    cleanup = () => {
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', focusOutside, true);
      observer.disconnect();
      if (scope) app.keymap.popScope(scope);
    };
    draw();
    search.focus();
  }
  trigger.onkeydown = (e) => {
    if (e.key === 'ArrowDown' && !popup) { e.preventDefault(); open(); }
  };
  wrap._dispose = () => close();
  return trigger;
}

module.exports = { symbolPicker };
