'use strict';
const { setIcon } = require('obsidian');
const F = require('../../domain/filters.js');
const { el, button, icon } = require('../../ui/elements.js');
const { actionMenu, picker } = require('../../ui/menus.js');
const { AskModal, ConfirmMessageModal } = require('../../ui/dialogs.js');

class FilterBar {
  constructor(view) {
    this.view = view;
    this.node = el(view.root, 'div', 'pb-filter-bar');
    view.root.insertBefore(this.node, view.area);
    const search = el(this.node, 'div', 'pb-search');
    setIcon(el(search, 'span', 'pb-search-icon'), 'search');
    this.input = el(search, 'input', 'pb-search-input');
    this.input.type = 'search';
    this.input.placeholder = 'Поиск задач';
    this.input.setAttribute('aria-label', 'Поиск задач');
    this.input.value = view.filters.query || '';
    this.clear = icon(search, 'x', 'Очистить поиск', () => this.setQuery(''));
    this.input.oninput = (e) => {
      // Keep the same input node and caret while results and counts change.
      view.filters.query = this.input.value;
      this.clear.hidden = !this.input.value;
      clearTimeout(this.timer);
      if (!e.isComposing) this.timer = setTimeout(() => view.changed(), 120);
    };
    this.input.oncompositionend = () => this.input.oninput({});
    this.input.onkeydown = (e) => {
      if (e.key === 'Escape' && this.input.value) {
        e.preventDefault();
        e.stopPropagation();
        this.setQuery('');
      }
    };
    this.controls = el(this.node, 'div', 'pb-filter-controls');
    this.result = el(this.node, 'span', 'pb-filter-result');
    this.result.setAttribute('role', 'status');
    this.result.setAttribute('aria-live', 'polite');
  }
  setQuery(value) {
    clearTimeout(this.timer);
    this.input.value = value;
    this.view.filters.query = value;
    this.input.focus();
    this.view.changed();
  }
  scope() {
    return this.view.boardConfig?.id || '__all__';
  }
  presets() {
    return this.view.plugin.savedFilters?.list(this.scope()) || [];
  }
  selected() {
    return this.presets().find((x) => x.archive === this.view.archive && F.sameFilters(x.filters, this.view.filters));
  }
  apply(preset) {
    clearTimeout(this.timer);
    this.view.filters = F.normalizeFilters(preset.filters);
    this.view.archive = preset.archive;
    this.view.mode = 'board';
    this.view.changed();
  }
  reset() {
    clearTimeout(this.timer);
    this.view.filters = F.normalizeFilters();
    this.view.changed();
  }
  save(preset, rename = false) {
    const scope = this.scope(), filters = F.normalizeFilters(this.view.filters), archive = this.view.archive;
    new AskModal(this.view.app, rename ? 'Название подборки' : 'Сохранить подборку', 'Название подборки',
      (name) => this.view.plugin.savedFilters.save(scope, name, filters, archive, rename ? preset.id : undefined),
      rename ? preset.name : '',
    ).open();
  }
  menu(anchor) {
    const selected = this.selected();
    const items = this.presets().map((p) => ({
      label: p.name, icon: p.id === selected?.id ? 'check' : 'bookmark', action: () => this.apply(p),
    }));
    if (items.length) items.push({ separator: true });
    items.push({ label: 'Сохранить подборку…', icon: 'bookmark-plus', action: () => this.save() });
    if (selected) items.push(
      { label: 'Переименовать подборку', icon: 'pencil', action: () => this.save(selected, true) },
      { label: 'Удалить подборку', icon: 'trash-2', danger: true, action: async () => {
        const scope = this.scope();
        const confirmed = await new Promise((resolve) => new ConfirmMessageModal(
          this.view.app, 'Удалить подборку?', selected.name, 'Удалить', resolve, true,
        ).open());
        if (confirmed) await this.view.plugin.savedFilters.remove(scope, selected.id);
      } },
    );
    actionMenu(anchor, items, 'Подборки', this.view.app);
  }
  update() {
    const v = this.view, f = F.normalizeFilters(v.filters);
    this.node.hidden = v.mode === 'focus' && !v.archive;
    if (this.input.value !== f.query) this.input.value = f.query;
    this.clear.hidden = !f.query;
    const tags = [...new Set([...v.allTasks.flatMap((t) => t.visibleTags), ...f.tags])]
      .filter((t) => t !== '__none__').sort();
    const statuses = [...v.boardColumns()];
    if (v.allTasks.some((t) => v.columnForTask(t) === '__unknown__'))
      statuses.push({ value: '__unknown__', label: 'Без столбца', icon: 'circle-help' });
    for (const value of f.statuses)
      if (!statuses.some((s) => s.value === value)) statuses.push({ value, label: value });
    const selected = this.selected();
    const signature = JSON.stringify([f.project, f.tags, f.statuses, F.hasFilters(f), tags, statuses, this.presets(), selected?.id]);
    if (signature === this.signature) return;
    this.signature = signature;
    const focusedLabel = this.controls.contains?.(document.activeElement)
      ? document.activeElement.getAttribute('aria-label') : null;
    this.controls.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
    this.controls.replaceChildren();
    const tagsButton = picker(this.controls, f.tags.length ? f.tags.map((t) => t === '__none__' ? 'Без тегов' : '#' + t).join(', ') : 'Все теги',
      'Фильтр по тегам', [
        { value: '', label: 'Все теги', selected: !f.tags.length },
        ...['__none__', ...tags].map((t) => ({ value: t, label: t === '__none__' ? 'Без тегов' : '#' + t, selected: f.tags.includes(t) })),
      ], ({ value }) => {
        v.filters.tags = !value ? [] : f.tags.includes(value) ? f.tags.filter((x) => x !== value)
          : value === '__none__' ? [value] : [...f.tags.filter((x) => x !== '__none__'), value];
        v.changed();
      }, 'pb-filter' + (f.tags.length ? ' is-active' : ''));
    const statusButton = picker(this.controls, f.statuses.length ? statuses.filter((s) => f.statuses.includes(s.value)).map((s) => s.label).join(', ') : 'Все статусы',
      'Фильтр по статусам', [
        { value: '', label: 'Все статусы', selected: !f.statuses.length },
        ...statuses.map((s) => ({ ...s, selected: f.statuses.includes(s.value) })),
      ], ({ value }) => {
        v.filters.statuses = !value ? [] : f.statuses.includes(value) ? f.statuses.filter((x) => x !== value) : [...f.statuses, value];
        v.changed();
      }, 'pb-filter' + (f.statuses.length ? ' is-active' : ''));
    const saved = button(this.controls, '', () => this.menu(saved), 'pb-saved-filter' + (selected ? ' is-active' : ''));
    setIcon(el(saved, 'span'), 'bookmark');
    el(saved, 'span', 'pb-picker-label', selected?.name || 'Подборки');
    saved.setAttribute('aria-label', 'Подборки' + (selected ? ' · ' + selected.name : ''));
    saved.setAttribute('title', selected?.name || 'Подборки');
    saved.setAttribute('aria-haspopup', 'menu');
    if (F.hasFilters(f)) icon(this.controls, 'x', 'Сбросить все фильтры', () => this.reset());
    if (focusedLabel) {
      const target = [tagsButton, statusButton, saved].find((b) => b.getAttribute('aria-label') === focusedLabel);
      (target || this.input).focus();
    }
  }
  showResult(count, total, error = '') {
    this.result.textContent = error || (F.hasFilters(this.view.filters) ? count ? `${count} из ${total}` : 'Ничего не найдено' : '');
    this.result.classList.toggle('is-error', !!error);
  }
  dispose() {
    clearTimeout(this.timer);
    this.controls.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
    this.node.remove();
  }
}
module.exports = { FilterBar };
