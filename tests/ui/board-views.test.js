'use strict';
const { createLoader } = require('../helpers/modules.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/domain/tasks.js');
const B = require('../../src/storage/board-store.js');

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

// A small DOM model exercises the actual view code without loading Obsidian.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.className = '';
    this._text = '';
    this.value = '';
    this.scrollTop = 0;
    this.hidden = false;
    this.style = {};
    this.connected = false;
    this.classList = {
      add: (...items) => this.setClasses([...this.classes(), ...items]),
      remove: (...items) => this.setClasses(this.classes().filter((x) => !items.includes(x))),
      toggle: (item, force) => {
        const has = this.classes().includes(item),
          next = force === undefined ? !has : force;
        this.setClasses(
          next ? [...this.classes(), item] : this.classes().filter((x) => x !== item),
        );
        return next;
      },
      contains: (item) => this.classes().includes(item),
    };
  }
  classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }
  setClasses(items) {
    this.className = [...new Set(items)].join(' ');
  }
  get childNodes() {
    return this.children;
  }
  get isConnected() {
    return this.connected || !!this.parentNode?.isConnected;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value);
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentNode = this;
      this.children.push(child);
    }
  }
  prepend(child) {
    this.insertBefore(child, this.children[0]);
  }
  closest(selector) {
    return selector.startsWith('.') && this.classes().includes(selector.slice(1))
      ? this : this.parentNode?.closest(selector);
  }
  scrollIntoView() {}
  requestSubmit() { return this.onsubmit?.({ preventDefault() {} }); }
  getBoundingClientRect() {
    return { top: 20, bottom: 50, left: 20, right: 160 };
  }
  get firstElementChild() { return this.children[0]; }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...children);
  }
  insertBefore(child, before) {
    child.remove();
    child.parentNode = this;
    const i = this.children.indexOf(before);
    this.children.splice(i < 0 ? this.children.length : i, 0, child);
  }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(name, listener) {
    this.listeners ||= new Map();
    this.listeners.set(name, listener);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  querySelectorAll(selector) {
    const matches = (e) =>
      selector.startsWith('.') ? e.classes().includes(selector.slice(1))
        : selector === '[aria-selected="true"]' ? e.getAttribute('aria-selected') === 'true'
        : e.tagName === selector;
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture(
  render = async (app, text, node) => {
    node.textContent = text;
  },
) {
  const components = [];
  const notices = [];
  const pickers = [];
  class Component {
    constructor() {
      components.push(this);
      this.loaded = false;
    }
    load() {
      this.loaded = true;
    }
    unload() {
      this.loaded = false;
    }
  }
  const base = class {};
  const obs = {
    Plugin: base,
    PluginSettingTab: base,
    ItemView: base,
    FileView: base,
    Modal: base,
    FuzzySuggestModal: class {
      setPlaceholder(value) { this.placeholder = value; }
      open() { pickers.push(this); }
      onClose() {}
    },
    Notice: class { constructor(text) { notices.push(text); } },
    Component,
    TFile: class {},
    Scope: class { register(modifiers, key, handler) { this.handler = handler; this.modifiers = modifiers; this.key = key; } },
    MarkdownRenderer: { render },
    setIcon(node, name) {
      node.icon = name;
    },
    normalizePath: (x) => x,
  };
  const listeners = new Map();
  const document = {
    createElement: (tag) => Object.assign(new Element(tag), { ownerDocument: document }),
    activeElement: null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    defaultView: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
  };
  document.body = document.createElement('body');
  document.body.connected = true;
  document.listeners = listeners;
  const scope = {
    require: (name) => (name === 'obsidian' ? obs : require(name)),
    module: { exports: {} },
    console,
    document,
    setTimeout,
    clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    crypto: require('node:crypto').webcrypto,
  };
  const load = createLoader(scope);
  scope.module.exports = { PikoBoard: load('plugin.js'), ...load('features/boards/board-view.js'), ...load('features/journal/next-step.js') };
  return { ...scope.module.exports, components, document, obs, notices, pickers };
}
function boardFixture(tasks) {
  const f = fixture(),
    plugin = Object.create(f.PikoBoard.prototype);
  plugin.data = { order: [] };
  plugin.tasks = async () => tasks;
  plugin.projects = () => [
    { value: 'Projects/A', label: 'A' },
    { value: 'Projects/Empty', label: 'Empty' },
  ];
  plugin.api = () => ({ catalog: { statuses: () => [{ value: 'done', isCompleted: true }] } });
  plugin.note = async () => ({ nextAction: '' });
  plugin.journal = () => ({ syncNext() {} });
  plugin.disposeHistory = () => {};
  plugin.columnsFor = () => B.DEFAULT_COLUMNS;
  plugin.boards = { load: async () => ({ board: view.boardConfig }) };
  const view = new f.BoardView(null, plugin);
  view.root = new Element();
  view.root.connected = true;
  view.toolbar = new Element();
  view.domains = new Element();
  view.area = new Element();
  view.root.append(view.toolbar, view.domains, view.area);
  view.renderToolbar = f.BoardView.prototype.renderToolbar;
  view.makeCard = (task) => ({
    node: Object.assign(new Element(), { dataset: { path: task.path } }),
    title: new Element(),
    meta: new Element(),
    feed: new Element(),
    journal: { hidden: true },
    file: { path: task.path, basename: task.path },
    task,
  });
  return { ...f, plugin, view };
}

test('search keeps its input stable, intersects filters, preserves columns and clears empty results', async () => {
  const tasks = [
    { path: 'A', title: 'English', status: 'open', projects: ['[[Projects/A]]'], visibleTags: ['learn'] },
    { path: 'B', title: 'Other', status: 'in-progress', projects: [], visibleTags: ['learn'] },
    { path: 'C', title: 'English old', status: 'done', projects: ['[[Projects/A]]'], visibleTags: [], archived: true },
  ];
  const { view, plugin, document } = boardFixture(tasks);
  view.app = { vault: { getAbstractFileByPath: (path) => ({ path }) } };
  plugin.note = async (file) => ({ body: file.path === 'A' ? 'Найти преподавателя' : '', nextAction: '' });
  await view.refresh();
  const input = view.filterBar.input;
  document.activeElement = input;
  view.filters = { query: 'Преподавателя', project: 'Projects/A', tags: ['learn'], statuses: ['open'] };
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['A']);
  assert.equal(view.filterBar.input, input);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, 'Преподавателя');
  assert.deepEqual([...view.columns.keys()], ['open']);
  assert.equal(view.filterBar.result.textContent, '1 из 2');
  view.filters.query = 'no-match';
  await view.refresh();
  assert.equal(view.cards.size, 0);
  assert.equal(view.filterBar.result.textContent, 'Ничего не найдено');
  assert.equal(view.filterBar.controls.querySelectorAll('.pb-icon').some((e) => e.attributes['aria-label'] === 'Сбросить все фильтры'), true);
  view.filters = { project: '', tags: [], query: '', statuses: [] };
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['A', 'B']);
  assert.equal(view.filterBar.input, input);
  view.archive = true;
  view.filters.query = 'old';
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['C']);
});

test('a slow old search cannot overwrite newer results or the search field', async () => {
  const tasks = [{ path: 'A', title: 'Alpha', status: 'open', projects: [], visibleTags: [] }];
  const { view, plugin } = boardFixture(tasks);
  view.app = { vault: { getAbstractFileByPath: (path) => ({ path }) } };
  const gate = deferred();
  let calls = 0;
  plugin.note = () => ++calls === 1 ? gate.promise : Promise.resolve({});
  view.filters.query = 'alpha';
  const oldSearch = view.refresh();
  await tick();
  view.filters.query = 'missing';
  await view.refresh();
  gate.resolve({});
  await oldSearch;
  assert.equal(view.cards.size, 0);
  assert.equal(view.filterBar.input.value, 'missing');
  assert.equal(view.filterBar.result.textContent, 'Ничего не найдено');
});

test('applying a saved combination copies values and restores its archive scope', async () => {
  const { view } = boardFixture([]);
  await view.refresh();
  view.changed = () => {};
  const preset = { filters: { query: 'english', tags: ['learn'], statuses: ['done'] }, archive: true };
  view.filterBar.apply(preset);
  assert.equal(view.archive, true);
  assert.equal(view.mode, 'board');
  view.filters.tags.push('another');
  assert.deepEqual(preset.filters.tags, ['learn']);
  view.filterBar.reset();
  assert.equal(view.archive, true, 'clear filters stays within the current archive tab');
  assert.equal(view.filters.query, '');
  assert.equal(view.filters.statuses.length, 0);
});

test('filter controls retain keyboard focus after changing a selection', async () => {
  const { view, document } = boardFixture([]);
  await view.refresh();
  const tags = view.filterBar.controls.querySelectorAll('.pb-picker')[0];
  tags.focus();
  view.filters.tags = ['research'];
  await view.refresh();
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Фильтр по тегам');
  assert.notEqual(document.activeElement, tags, 'focus follows the replacement control');
  view.filterBar.input.focus();
  view.filters.query = 'new search';
  await view.refresh();
  assert.equal(document.activeElement, view.filterBar.input);
});

test('column checklist stays open for multiple changes, keeps one column, and restores all', async () => {
  const { view, document } = boardFixture([
    { path: 'A', status: 'open', projects: [], visibleTags: [] },
    { path: 'B', status: 'in-progress', projects: [], visibleTags: [] },
    { path: 'C', status: 'done', projects: [], visibleTags: [] },
  ]);
  let pending;
  view.changed = () => { pending = view.refresh(); };
  await view.refresh();
  const trigger = view.filterBar.columnButton;
  trigger.onclick();
  const popup = document.body.querySelector('.pb-multi-picker');
  assert.equal(popup.getAttribute('aria-multiselectable'), 'true');
  const options = popup.querySelectorAll('button');
  options[3].focus();
  options[3].onclick(); // Hide done.
  await pending;
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress']);
  assert.equal(document.activeElement, options[3]);
  assert.equal(options[3].getAttribute('aria-selected'), 'false');
  assert.equal(view.filterBar.columnButton, trigger);
  assert.equal(popup.isConnected, true);
  options[1].onclick(); // Hide backlog.
  await pending;
  assert.deepEqual([...view.columns.keys()], ['in-progress']);
  assert.deepEqual([...view.cards.keys()], ['B']);
  assert.equal(options[2].getAttribute('aria-disabled'), 'true');
  options[2].onclick(); // Last column cannot be unchecked.
  assert.deepEqual([...view.filters.statuses], ['in-progress']);
  options[0].onclick();
  await pending;
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress', 'done']);
  assert.deepEqual([...view.cards.keys()], ['A', 'B', 'C']);
  assert.equal(popup.isConnected, true);
  popup.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(popup.isConnected, false);
  assert.equal(document.activeElement, trigger);
});

test('column visibility survives focus and archive, custom empty columns stay selectable', async () => {
  const { view } = boardFixture([
    task('A', 'open', 'work'), task('B', 'in-progress', 'work'),
    { ...task('C', 'done', 'work'), archived: true },
  ]);
  view.file = { path: 'Work.pikoboard', basename: 'Work' };
  view.boardConfig = { id: 'work', columns: customColumns() };
  view.filters.statuses = ['waiting', 'in-progress'];
  await view.refresh();
  assert.deepEqual([...view.columns.keys()], ['in-progress', 'waiting']);
  assert.equal(view.columns.get('waiting').count.textContent, '0');
  view.mode = 'focus';
  await view.refresh();
  assert.equal(view.columns.size, 4);
  view.mode = 'board';
  view.archive = true;
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['C']);
  assert.equal(view.filterBar.columnButton, null);
  view.archive = false;
  await view.refresh();
  assert.deepEqual([...view.columns.keys()], ['in-progress', 'waiting']);
  view.filters.statuses = ['removed-column'];
  await view.refresh();
  assert.equal(view.columns.size, 4, 'deleted selections recover to all columns');
});

test('tag multi-select keeps the same popup across choices and closes only on dismissal', async () => {
  const { view, document } = boardFixture([
    { path: 'Both', status: 'open', projects: [], visibleTags: ['alpha', 'beta'] },
    { path: 'One', status: 'open', projects: [], visibleTags: ['alpha'] },
  ]);
  let pending;
  view.changed = () => { pending = view.refresh(); };
  await view.refresh();
  const trigger = view.filterBar.tagsButton;
  trigger.onclick();
  const popup = document.body.querySelector('.pb-multi-picker');
  const options = popup.querySelectorAll('button');
  options[2].onclick();
  await pending;
  assert.deepEqual([...view.filters.tags], ['alpha']);
  assert.equal(popup.isConnected, true);
  options[3].onclick();
  await pending;
  assert.deepEqual([...view.filters.tags], ['alpha', 'beta']);
  assert.deepEqual([...view.cards.keys()], ['Both']);
  assert.equal(view.filterBar.tagsButton, trigger);
  assert.equal(popup.isConnected, true);
  assert.equal(options[2].getAttribute('aria-selected'), 'true');
  assert.equal(options[3].getAttribute('aria-selected'), 'true');
  document.listeners.get('pointerdown')({ target: view.filterBar.input });
  assert.equal(popup.isConnected, false);
});

test('focus includes every active in-progress task despite saved domain/tag filters and shows no false badges', async () => {
  const tasks = [
    { path: 'A', status: 'in-progress', projects: ['[[Projects/A]]'], visibleTags: ['work'] },
    { path: 'B', status: 'in-progress', projects: ['[[Projects/B]]'], visibleTags: [] },
    { path: 'Unassigned', status: 'in-progress', projects: [], visibleTags: [] },
    { path: 'Backlog', status: 'open', projects: ['[[Projects/A]]'], visibleTags: ['work'] },
    { path: 'Done', status: 'done', projects: ['[[Projects/A]]'], visibleTags: ['work'] },
    { path: 'Archived', status: 'in-progress', projects: [], visibleTags: [], archived: true },
  ];
  const { view } = boardFixture(tasks);
  view.mode = 'focus';
  view.filters = { project: 'Projects/A', tags: ['work'] };
  view.recent.add('Done');
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['A', 'B', 'Unassigned']);
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress', 'done']);
  assert.equal(view.columns.get('open').count.textContent, '0');
  assert.equal(view.columns.get('done').count.textContent, '0');
  assert.equal(view.columns.get('in-progress').count.textContent, '3');
  assert.equal(view.domains.hidden, true);
  assert.equal(view.toolbar.textContent.includes('В работе · 3'), true);
  for (const card of view.cards.values())
    assert.equal(card.meta.textContent.includes('Вне фильтра'), false);
  assert.deepEqual(
    view.filters,
    { project: 'Projects/A', tags: ['work'] },
    'focus does not destroy the saved board lens',
  );
  view.mode = 'board';
  view.recent.clear();
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['Backlog', 'A', 'Done']);
  assert.equal(view.domains.hidden, false);
  assert.equal(
    view.domains.textContent.includes('Empty0'),
    true,
    'an empty domain remains available for its first task',
  );
});

test('drop targets use vertical card order in every filter and exclude the dragged card', () => {
  const { BoardView } = fixture(),
    view = Object.create(BoardView.prototype);
  view.mode = 'focus';
  view.dragPath = 'drag';
  const node = (name, left, top, width = 100, height = 80) => ({
    dataset: { path: name },
    getBoundingClientRect: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }),
  });
  const first = node('first', 0, 0),
    second = node('second', 120, 0),
    third = node('third', 0, 100),
    drag = node('drag', 120, 100),
    list = { children: [first, second, third, drag] };
  let target = view.dropTarget(list, 30, 130);
  assert.equal(target.anchor, 'first');
  assert.equal(target.after, false);
  target = view.dropTarget(list, 210, 30);
  assert.equal(target.anchor, 'third');
  assert.equal(target.after, true);
  target = view.dropTarget(list, 125, 20);
  assert.equal(target.anchor, 'third');
  assert.equal(target.after, false);
  assert.notEqual(view.dropTarget(list, 125, 150).anchor, 'drag');
  assert.equal(view.dropTarget({ children: [drag] }, 30, 20).anchor, null);
  view.mode = 'board';
  const vertical = { children: [node('top', 0, 0), node('middle', 0, 100), node('last', 0, 200)] };
  target = view.dropTarget(vertical, 130, 500);
  assert.equal(target.anchor, 'middle');
  assert.equal(target.after, false);
  target = view.dropTarget(vertical, 300, 0);
  assert.equal(target.anchor, 'last');
  assert.equal(target.after, true);
});

test('empty-board load failure clears detached layout state and recovery rebuilds connected columns', async () => {
  const { view, plugin } = boardFixture([]);
  await view.refresh();
  const oldColumns = view.columns;
  plugin.tasks = async () => {
    throw new Error('temporary failure');
  };
  await view.refresh();
  assert.equal(view.columns, null);
  assert.equal(view.layoutMode, null);
  assert.equal(view.overviewSignature, null);
  assert.equal(view.area.textContent, 'temporary failure');
  plugin.tasks = async () => [{ path: 'Recovered', status: 'open', projects: [], visibleTags: [] }];
  await view.refresh();
  assert.notEqual(view.columns, oldColumns);
  assert.equal(view.cards.get('Recovered').node.isConnected, true);
  assert.equal(view.area.textContent.includes('temporary failure'), false);
});

test('history renders commit atomically and a stale render cannot replace a newer result', async () => {
  const slow = deferred(),
    started = deferred();
  const f = fixture(async (app, text, node) => {
    if (text === 'Old') {
      started.resolve();
      await slow.promise;
    }
    node.textContent = text;
  });
  const plugin = Object.create(f.PikoBoard.prototype);
  plugin.app = {};
  plugin.journal = () => ({ syncNext() {} });
  let text = 'Old';
  plugin.note = async () => ({
    updates: [{ id: text, at: '2026-10-18T12:00:00Z', text }],
    nextAction: '',
  });
  const container = new Element();
  container.connected = true;
  container.textContent = 'Previous complete feed';
  container.scrollTop = 17;
  const old = plugin.history(container, { path: 'Task.md' });
  await started.promise;
  assert.equal(container.textContent, 'Previous complete feed');
  text = 'New';
  await plugin.history(container, { path: 'Task.md' });
  assert.equal(container.textContent.includes('New'), true);
  assert.equal(container.scrollTop, 17);
  slow.resolve();
  await old;
  assert.equal(container.textContent.includes('Old'), false);
  assert.equal(container.textContent.includes('New'), true);
  assert.equal(f.components[0].loaded, false);
  assert.equal(f.components[1].loaded, true);
  plugin.disposeHistory(container);
  assert.equal(f.components[1].loaded, false);
});

test('history change then undo during rendering keeps the previously committed feed intact', async () => {
  const slow = deferred(),
    started = deferred();
  const f = fixture(async (app, text, node) => {
    if (text === 'Transient') {
      started.resolve();
      await slow.promise;
    }
    node.textContent = text;
  });
  const plugin = Object.create(f.PikoBoard.prototype);
  plugin.app = {};
  plugin.journal = () => ({ syncNext() {} });
  let text = 'Original';
  plugin.note = async () => ({
    updates: [{ id: text, at: '2026-10-18T12:00:00Z', text }],
    nextAction: '',
  });
  const container = new Element();
  container.connected = true;
  await plugin.history(container, { path: 'Task.md' });
  const committed = container.textContent;
  text = 'Transient';
  const pending = plugin.history(container, { path: 'Task.md' });
  await started.promise;
  text = 'Original';
  await plugin.history(container, { path: 'Task.md' });
  slow.resolve();
  await pending;
  assert.equal(container.textContent, committed);
  assert.equal(f.components[1].loaded, false);
});

test('one card disclosure hides and reveals the next step and history together without losing the draft', async () => {
  const f = fixture(async (app, text, node) => {
    const paragraph = new Element('p');
    paragraph.textContent = text;
    node.append(paragraph);
  });
  const file = Object.assign(new f.obs.TFile(), { path: 'Task.md', basename: 'Task' });
  const listeners = new Set();
  const model = {
    next: '- [ ] Read the notes', update: 'Unsent comment',
    subscribe(fn) { listeners.add(fn); fn(); return () => listeners.delete(fn); },
    async prepareNext() { this.nextDraft = this.next; this.nextBase = this.next; },
    async save() {},
  };
  let reads = 0;
  const app = { vault: { getAbstractFileByPath: () => file } };
  const plugin = {
    app, journal: () => model,
    async history(feed) { reads++; feed.textContent = 'Previous comment'; },
  };
  const view = new f.BoardView(null, plugin);
  view.app = app;
  const card = view.makeCard({ path: file.path });
  await tick();
  assert.equal(card.journal.hidden, true);
  assert.equal(card.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(card.nextWrap.parentNode, card.journal);
  assert.equal(card.feed.parentNode, card.journal);
  assert.equal(card.meta.parentNode, card.node);
  assert.equal(card.head.parentNode, card.node);
  assert.equal(card.node.querySelectorAll('.pb-next-toggle').length, 0);
  await card.toggle.onclick();
  assert.equal(card.journal.hidden, false);
  assert.equal(card.nextWrap.hidden, false);
  assert.equal(card.nextWrap.querySelector('.pb-next-text').textContent, model.next);
  assert.equal(card.feed.textContent, 'Previous comment');
  assert.equal(card.composer.input.value, 'Unsent comment');
  await card.nextWrap.querySelector('.pb-next-edit').onclick();
  assert.equal(card.composer.mode, 'next');
  assert.equal(card.composer.input.value, model.next);
  await card.toggle.onclick();
  assert.equal(card.journal.hidden, true);
  model.next = '- [x] Read the notes';
  for (const listener of listeners) listener();
  await tick();
  assert.equal(card.journal.hidden, true);
  await card.toggle.onclick();
  assert.equal(card.journal.hidden, false);
  assert.equal(card.nextWrap.querySelector('.pb-next-text').textContent, model.next);
  assert.equal(model.update, 'Unsent comment');
  assert.equal(reads, 3);
  card.nextWrap._dispose();
  card.composer.dispose();
});

test('next-step rendering ignores late old Markdown and disposes its component', async () => {
  const slow = deferred(),
    started = deferred();
  const f = fixture(async (app, text, node) => {
    if (text === 'Old step') {
      started.resolve();
      await slow.promise;
    }
    const paragraph = new Element('p');
    paragraph.textContent = text;
    node.append(paragraph);
  });
  let listener;
  const model = {
    next: 'Old step',
    busy: false,
    subscribe(fn) {
      listener = fn;
      fn();
      return () => {
        listener = null;
      };
    },
    complete() {},
  };
  const plugin = { app: {}, journal: () => model },
    parent = new Element();
  parent.connected = true;
  const wrap = f.nextStep(parent, plugin, { path: 'Task.md' }, () => {});
  await started.promise;
  model.next = 'New step';
  listener();
  await tick();
  const content = wrap.querySelectorAll('.pb-next-text')[0];
  assert.equal(content.textContent, 'New step');
  slow.resolve();
  await tick();
  assert.equal(content.textContent, 'New step');
  assert.equal(f.components[0].loaded, false);
  wrap._dispose();
  assert.equal(listener, null);
  assert.equal(f.components[1].loaded, false);
});

test('the single board layout keeps interactive cards in status columns, project filtering and normal order', async () => {
  const tasks = [
    { path: 'Next', status: 'open', projects: ['[[Projects/A]]'], visibleTags: [] },
    { path: 'Working', status: 'in-progress', projects: ['[[Projects/A]]'], visibleTags: [] },
    { path: 'Finished', status: 'done', projects: ['[[Projects/A]]'], visibleTags: [] },
    { path: 'Other', status: 'open', projects: ['[[Projects/B]]'], visibleTags: [] },
    {
      path: 'Archived',
      status: 'done',
      projects: ['[[Projects/A]]'],
      visibleTags: [],
      archived: true,
    },
  ];
  const { view } = boardFixture(tasks);
  view.mode = 'board';
  view.filters.project = 'Projects/A';
  await view.refresh();
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress', 'done']);
  assert.deepEqual([...view.cards.keys()], ['Next', 'Working', 'Finished']);
  for (const [status, path] of [
    ['open', 'Next'],
    ['in-progress', 'Working'],
    ['done', 'Finished'],
  ]) {
    const column = view.columns.get(status),
      card = view.cards.get(path);
    assert.equal(column.count.textContent, '1');
    assert.equal(card.node.parentNode, column.list);
    assert.equal(card.node.isConnected, true);
    assert.ok(card.feed);
    assert.ok(card.journal);
  }
  assert.equal(view.toolbar.textContent.includes('Компактно'), false);
  assert.equal(view.toolbar.textContent.includes('Доска'), false);
  assert.equal(view.area.classList.contains('pb-overview'), true);
  view.filters.project = '';
  await view.refresh();
  assert.equal(view.columns.get('open').count.textContent, '2');
  assert.equal(view.cards.has('Archived'), false);
  view.mode = 'board';
  await view.refresh();
  assert.deepEqual(
    view.columns.get('open').list.children.map((node) => node.dataset.path),
    ['Next', 'Other'],
  );
  assert.equal(view.cards.size, 4);
});

const customColumns = () => [
  ...B.DEFAULT_COLUMNS,
  {
    value: 'waiting',
    label: 'Waiting',
    kind: 'active',
    color: '#123456',
    opacity: 0.12,
    icon: '⏳',
  },
];
const task = (path, status, board = '') => ({
  path,
  status,
  board,
  projects: [],
  visibleTags: [],
  isActive: ['in-progress', 'waiting'].includes(status),
  isCompleted: status === 'done',
});

test('date badges refresh at midnight and when completing, reopening, or archiving a task', async () => {
  const t = { ...task('Dated', 'open'), due: '2026-10-20' };
  const { view } = boardFixture([t]);
  await view.refresh();
  const card = view.cards.get('Dated');
  const before = new Date(2026, 9, 20, 23, 59);
  view.updateCard(card, before);
  const today = card.meta.querySelectorAll('.pb-due')[0];
  assert.equal(today.textContent, 'Сегодня');
  assert.equal(today.classList.contains('pb-due-today'), true);
  view.updateCard(card, before);
  assert.equal(card.meta.querySelectorAll('.pb-due')[0], today, 'unchanged dates do not rebuild metadata');

  const after = new Date(2026, 9, 21, 0, 0);
  view.updateCard(card, after);
  let badge = card.meta.querySelectorAll('.pb-due')[0];
  assert.equal(badge.classList.contains('pb-due-overdue'), true);
  assert.match(badge.attributes['aria-label'], /^Просрочено/);
  card.task = { ...card.task, status: 'custom-finished', isCompleted: true };
  view.updateCard(card, after);
  assert.equal(card.meta.querySelectorAll('.pb-due')[0].classList.contains('pb-due-overdue'), false);
  card.task = { ...card.task, isCompleted: false };
  view.updateCard(card, after);
  assert.equal(card.meta.querySelectorAll('.pb-due')[0].classList.contains('pb-due-overdue'), true);
  card.task = { ...card.task, archived: true };
  view.updateCard(card, after);
  assert.equal(card.meta.querySelectorAll('.pb-due')[0].classList.contains('pb-due-overdue'), false);
  card.task = { ...card.task, due: undefined };
  view.updateCard(card, after);
  assert.equal(card.meta.querySelectorAll('.pb-due').length, 0);
});

test('a named board isolates its tasks and renders its exact columns, colors, emoji and no-icon option', async () => {
  const tasks = [
    task('A', 'open', 'work'),
    task('Waiting', 'waiting', 'work'),
    task('Other', 'waiting', 'home'),
    task('Loose', 'open'),
  ];
  const { view } = boardFixture(tasks);
  view.file = { path: 'Projects/Work.pikoboard', basename: 'Work' };
  view.boardConfig = { id: 'work', columns: customColumns() };
  view.boardConfig.columns[0] = { ...view.boardConfig.columns[0], icon: '', opacity: 0 };
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['A', 'Waiting']);
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress', 'done', 'waiting']);
  assert.equal(view.columns.get('waiting').col.style.background, 'rgba(18,52,86,0.12)');
  assert.equal(
    view.columns.get('waiting').col.querySelectorAll('.pb-status-icon')[0].textContent,
    '⏳',
  );
  assert.equal(view.columns.get('open').col.querySelectorAll('.pb-status-icon').length, 0);
  assert.equal(view.columns.get('open').col.style.background, 'rgba(155,168,196,0)');
  assert.equal(view.getDisplayText(), 'Work');
});

test('unknown task status remains visible in its own recovery column instead of becoming backlog', async () => {
  const { view } = boardFixture([
    task('Known', 'open', 'work'),
    task('Lost status', 'cancelled', 'work'),
  ]);
  view.file = { path: 'Work.pikoboard', basename: 'Work' };
  view.boardConfig = { id: 'work', columns: customColumns() };
  await view.refresh();
  const unknown = view.columns.get('__unknown__');
  assert.ok(unknown);
  assert.equal(view.cards.get('Lost status').node.parentNode, unknown.list);
  assert.equal(view.columns.get('open').count.textContent, '1');
  assert.equal(unknown.count.textContent, '1');
  assert.equal(unknown.col.querySelectorAll('.pb-add-task').length, 0);
});

test('all-tasks focus uses semantic roles from custom boards and keeps three vertical status columns', async () => {
  const tasks = [
    task('Waiting', 'waiting', 'work'),
    task('Standard', 'in-progress'),
    task('Done', 'done', 'work'),
    task('Later', 'open', 'work'),
  ];
  const { view, plugin } = boardFixture(tasks);
  plugin.columnsFor = () => customColumns();
  view.mode = 'focus';
  await view.refresh();
  assert.deepEqual([...view.columns.keys()], ['open', 'in-progress', 'done']);
  assert.deepEqual([...view.cards.keys()], ['Waiting', 'Standard']);
  assert.equal(view.columns.get('in-progress').count.textContent, '2');
  assert.equal(view.columns.get('open').count.textContent, '0');
  assert.equal(view.columns.get('done').count.textContent, '0');
});

test('unreadable board config fails closed and recovers without leaking tasks from other boards', async () => {
  const { view, plugin } = boardFixture([
    task('Mine', 'open', 'work'),
    task('Other', 'open', 'home'),
  ]);
  view.file = { path: 'Work.pikoboard', basename: 'Work' };
  const board = { id: 'work', columns: customColumns() };
  view.boardConfig = board;
  await view.refresh();
  plugin.boards.load = async () => {
    throw new Error('Invalid board');
  };
  await view.refresh();
  assert.equal(view.cards.size, 0);
  assert.equal(view.area.textContent, 'Invalid board');
  plugin.boards.load = async () => ({ board });
  await view.refresh();
  assert.deepEqual([...view.cards.keys()], ['Mine']);
  assert.equal(view.cards.get('Mine').node.isConnected, true);
});

test('a slow earlier board read cannot replace newer columns or report a stale error', async () => {
  for (const fail of [false, true]) {
    const { view, plugin } = boardFixture([task('Task', 'waiting', 'work')]);
    view.file = { path: 'Work.pikoboard', basename: 'Work' };
    const old = deferred();
    let calls = 0;
    const newest = { id: 'work', columns: customColumns() };
    plugin.boards.load = async () => {
      if (++calls === 1) {
        await old.promise;
        if (fail) throw new Error('Old failure');
        return { board: { id: 'work', columns: B.DEFAULT_COLUMNS } };
      }
      return { board: newest };
    };
    const pending = view.refresh();
    await tick();
    await view.refresh();
    old.resolve();
    await pending;
    assert.deepEqual(view.boardConfig, newest);
    assert.equal(view.boardError, '');
    assert.equal(view.cards.get('Task').node.parentNode, view.columns.get('waiting').list);
  }
});

test('dragging on all-tasks maps semantic target to the task own board and retains ordering', async () => {
  const tasks = [task('First', 'waiting', 'work'), task('Second', 'released', 'work')];
  const { view, plugin, obs } = boardFixture(tasks);
  const columns = [
    { value: 'later', kind: 'todo' },
    { value: 'waiting', kind: 'active' },
    { value: 'released', kind: 'done' },
  ];
  const files = new Map(
    tasks.map((t) => [t.path, Object.assign(new obs.TFile(), { path: t.path })]),
  );
  view.app = { vault: { getAbstractFileByPath: (path) => files.get(path) } };
  view.allTasks = tasks;
  plugin.columnsFor = () => columns;
  const changes = [];
  plugin.patch = async (file, patch) => {
    changes.push([file.path, patch.status]);
  };
  plugin.persist = async () => {};
  plugin.refresh = () => {};
  view.refresh = async () => {};
  await view.moveCard('First', 'done', 'Second', true);
  assert.deepEqual(changes, [['First', 'released']]);
  assert.deepEqual([...plugin.data.order], ['Second', 'First']);
  assert.equal(view.moving, false);
  changes.length = 0;
  await view.moveCard('First', 'in-progress', 'Second', false);
  assert.deepEqual(
    changes,
    [],
    'reordering within the aggregate active column retains its exact custom status',
  );
  assert.deepEqual([...plugin.data.order], ['First', 'Second']);
});


function creationFixture(keymap) {
  const f = fixture();
  const view = new f.BoardView({}, {});
  view.app = { keymap };
  const col = f.document.createElement('section');
  const list = f.document.createElement('div');
  const add = f.document.createElement('button');
  add.className = 'pb-add-task';
  col.append(list, add);
  f.document.body.append(col);
  view.columns = new Map([['open', { col, list }]]);
  const submissions = [];
  const template = { path: 'Templates/Research.md', basename: 'Research' };
  view.plugin = {
    app: {}, templates: { list: async () => [{ label: 'Research', file: template }] },
    submitTask: async (...args) => { submissions.push(args); return new f.obs.TFile(); },
  };
  view.beginCreate('open');
  return { ...f, view, col, list, add, submissions, template, row: col.querySelector('.pb-create-row'), input: col.querySelector('.pb-create-input') };
}
const keyEvent = (key, extra = {}) => ({ key, preventDefault() {}, stopPropagation() {}, ...extra });

test('quick creation keeps focus and selected template for consecutive tasks, with explicit removal', async () => {
  const f = creationFixture();
  assert.equal(f.col.children[0], f.row);
  assert.equal(f.document.activeElement, f.input);
  const choice = f.row.querySelector('.pb-template-choice');
  const selecting = choice.onclick();
  await tick();
  assert.equal(f.row._picking, true);
  const picker = f.pickers.at(-1);
  picker.onClose();
  picker.onChooseItem(picker.items[0]);
  await selecting;
  assert.equal(f.row._template, f.template);
  assert.equal(f.document.activeElement, f.input);
  for (const title of ['First', 'Second']) {
    f.input.value = title;
    f.input.oninput();
    f.input.onkeydown(keyEvent('Enter'));
    await tick();
    assert.equal(f.input.value, '');
    assert.equal(f.document.activeElement, f.input);
    assert.equal(f.row.hidden, false);
  }
  assert.deepEqual(f.submissions.map((x) => [x[0], x[1], x[3]]), [['First', 'open', f.template], ['Second', 'open', f.template]]);
  f.row.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Убрать шаблон').onclick();
  assert.equal(f.row._template, null);
  assert.equal(choice.textContent, 'Шаблон');
});

test('Escape, empty titles, IME and Shift+Enter do not create tasks; cancelling picker preserves input', async () => {
  const f = creationFixture();
  await f.row.requestSubmit();
  f.input.value = 'Draft';
  f.input.onkeydown(keyEvent('Enter', { isComposing: true }));
  f.input.onkeydown(keyEvent('Enter', { shiftKey: true }));
  assert.equal(f.submissions.length, 0);
  const selecting = f.row.querySelector('.pb-template-choice').onclick();
  await tick();
  f.pickers.at(-1).onClose();
  await selecting;
  assert.equal(f.input.value, 'Draft');
  assert.equal(f.document.activeElement, f.input);
  f.input.onkeydown(keyEvent('Escape'));
  assert.equal(f.row.hidden, true);
  assert.equal(f.document.activeElement, f.add);
  f.view.beginCreate('open');
  assert.equal(f.input.value, 'Draft');
});

test('failed creation retains title and template; repeated Enter during saving creates only once', async () => {
  const f = creationFixture(), pending = deferred();
  let calls = 0;
  f.row._template = f.template;
  f.input.value = 'Keep me';
  f.view.plugin.submitTask = async () => { calls++; await pending.promise; throw new Error('Disk full'); };
  const first = f.row.requestSubmit();
  await f.row.requestSubmit();
  assert.equal(calls, 1);
  assert.equal(f.input.readOnly, true);
  pending.resolve();
  await first;
  assert.equal(f.input.value, 'Keep me');
  assert.equal(f.row._template, f.template);
  assert.equal(f.input.readOnly, false);
  assert.equal(f.document.activeElement, f.input);
  assert.deepEqual(f.notices, ['Disk full']);
});

test('template is loaded before file creation and contextual board, column and project take precedence', async () => {
  const f = fixture();
  const plugin = Object.create(f.PikoBoard.prototype), received = [];
  const file = new f.obs.TFile();
  Object.assign(plugin, {
    templates: { read: async () => ({ tags: ['research'], details: '## Checklist\n- [ ] Compare' }) },
    api: () => ({ tasks: { create: async (input) => { received.push(input); return { path: 'New.md' }; } } }),
    data: { order: ['Existing.md'] }, persist: async () => {}, refresh() {},
    app: { vault: { getAbstractFileByPath: () => file } },
  });
  const view = { boardConfig: { id: 'my-board' }, filters: { project: 'Projects/Study' }, recent: new Set(), refresh: async () => {}, revealNew() {} };
  assert.equal(await plugin.submitTask('My title', 'review', view, {}), file);
  assert.equal(received[0].board, 'my-board');
  assert.equal(received[0].status, 'review');
  assert.equal(received[0].title, 'My title');
  assert.equal(received[0].projects[0], '[[Projects/Study]]');
  assert.equal(received[0].tags[0], 'research');
  assert.match(received[0].details, /Compare/);
  assert.deepEqual([...plugin.data.order], ['New.md', 'Existing.md']);
  plugin.templates.read = async () => { throw new Error('Missing template'); };
  await assert.rejects(plugin.submitTask('Not created', 'open', view, {}), /Missing template/);
  assert.equal(received.length, 1);
});


test('Cmd/Ctrl+Enter has a temporary Obsidian scope that is removed on blur and view disposal', async () => {
  const pushed = [], popped = [], opened = [];
  const f = creationFixture({ pushScope: (scope) => pushed.push(scope), popScope: (scope) => popped.push(scope) });
  f.obs.Modal.prototype.open = function () { opened.push(this.file); };
  f.input.onfocus();
  f.input.onfocus();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].modifiers[0], 'Mod');
  assert.equal(pushed[0].key, 'Enter');
  // Empty and IME submissions cannot leave a pending open flag behind.
  pushed[0].handler(keyEvent('Enter', { isComposing: true }));
  pushed[0].handler(keyEvent('Enter'));
  f.input.value = 'Ordinary';
  await f.row.requestSubmit();
  assert.equal(opened.length, 0);
  f.input.value = 'Open immediately';
  pushed[0].handler(keyEvent('Enter'));
  await tick();
  assert.equal(opened.length, 1);
  assert.equal(f.row.hidden, true);
  assert.equal(popped.length, 1);
  f.input.onfocus();
  f.input.onblur();
  assert.equal(popped.length, 2);
  f.input.onfocus();
  f.row._dispose();
  assert.equal(popped.length, 3);
});

test('a task stays successfully created if layout persistence fails, without encouraging a duplicate retry', async () => {
  const f = fixture(), plugin = Object.create(f.PikoBoard.prototype), file = new f.obs.TFile();
  let creates = 0;
  Object.assign(plugin, {
    api: () => ({ tasks: { create: async () => { creates++; return { path: 'Created.md' }; } } }),
    data: { order: [] }, persist: async () => { throw new Error('Settings disk full'); },
    refresh() {}, app: { vault: { getAbstractFileByPath: () => file } },
  });
  assert.equal(await plugin.submitTask('Created', 'open'), file);
  assert.equal(creates, 1);
  assert.match(f.notices[0], /Задача создана/);
});
