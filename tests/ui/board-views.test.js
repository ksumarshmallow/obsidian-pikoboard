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
  querySelectorAll(selector) {
    const matches = (e) =>
      selector.startsWith('.') ? e.classes().includes(selector.slice(1)) : false;
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}
function fixture(
  render = async (app, text, node) => {
    node.textContent = text;
  },
) {
  const components = [];
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
    FuzzySuggestModal: base,
    Component,
    TFile: class {},
    MarkdownRenderer: { render },
    setIcon(node, name) {
      node.icon = name;
    },
    normalizePath: (x) => x,
  };
  const document = { createElement: (tag) => new Element(tag), activeElement: null };
  const scope = {
    require: (name) => (name === 'obsidian' ? obs : require(name)),
    module: { exports: {} },
    console,
    document,
    setTimeout,
    clearTimeout,
    crypto: require('node:crypto').webcrypto,
  };
  const load = createLoader(scope);
  scope.module.exports = { PikoBoard: load('plugin.js'), ...load('features/boards/board-view.js'), ...load('features/journal/next-step.js') };
  return { ...scope.module.exports, components, document, obs };
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
