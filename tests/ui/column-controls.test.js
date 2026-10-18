'use strict';
const { createLoader } = require('../helpers/modules.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/storage/board-store.js');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const event = (properties = {}) => ({ preventDefault() {}, stopPropagation() {}, ...properties });

function fixture(input = {}) {
  const listeners = new Map(),
    frames = new Map(),
    notices = [];
  const listenerTarget = (prefix) => ({
    addEventListener(type, fn) {
      const key = prefix + type;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(prefix + type)?.delete(fn);
      if (!listeners.get(prefix + type)?.size) listeners.delete(prefix + type);
    },
  });
  const doc = {
    ...listenerTarget('doc:'),
    activeElement: null,
    defaultView: {
      ...listenerTarget('win:'),
      innerWidth: 1000,
      innerHeight: 800,
      requestAnimationFrame(fn) {
        const id = frames.size + 1;
        frames.set(id, fn);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
  };
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.attrs = {};
      this.className = '';
      this._text = '';
      this.hidden = false;
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.offsetWidth = 250;
      this.offsetHeight = 300;
      this.scrollLeft = 0;
      this.classList = {
        add: (...names) => {
          this.className = [...new Set([...this.classes(), ...names])].join(' ');
        },
        remove: (...names) => {
          this.className = this.classes()
            .filter((n) => !names.includes(n))
            .join(' ');
        },
        contains: (name) => this.classes().includes(name),
        toggle: (name, force) => {
          const next = force ?? !this.classes().includes(name);
          this.classList[next ? 'add' : 'remove'](name);
          return next;
        },
      };
    }
    classes() {
      return this.className.split(/\s+/).filter(Boolean);
    }
    addClass(name) {
      this.classList.add(name);
    }
    get parentElement() {
      return this.parentNode;
    }
    get firstElementChild() {
      return this.children[0];
    }
    get isConnected() {
      return this === doc.body || !!this.parentNode?.isConnected;
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(text) {
      this.replaceChildren();
      this._text = String(text);
    }
    append(...children) {
      for (const c of children) {
        c.remove();
        c.parentNode = this;
        this.children.push(c);
      }
    }
    replaceChildren(...children) {
      for (const c of this.children) c.parentNode = null;
      this.children = [];
      this._text = '';
      this.append(...children);
    }
    empty() {
      this.replaceChildren();
    }
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
        this.parentNode = null;
      }
    }
    matches(selector) {
      return selector.split(',').some((s) => {
        s = s.trim();
        if (s.startsWith('.')) return this.classes().includes(s.slice(1));
        const match = s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (match) {
          const value = match[1].startsWith('data-')
            ? this.dataset[match[1].slice(5)]
            : this.attrs[match[1]];
          return match[2] === undefined ? value !== undefined : value === match[2];
        }
        return this.tagName === s;
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((c) => [
        ...(c.matches(selector) ? [c] : []),
        ...c.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    closest(selector) {
      return this.matches(selector) ? this : this.parentNode?.closest(selector) || null;
    }
    contains(node) {
      return node === this || this.children.some((c) => c.contains(node));
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }
    focus() {
      doc.activeElement = this;
    }
    select() {}
    requestSubmit() {
      return this.onsubmit?.(event());
    }
    getBoundingClientRect() {
      return this.rect || { left: 100, right: 350, top: 100, bottom: 140, width: 250, height: 40 };
    }
    setPointerCapture(id) {
      this.capture = id;
    }
    hasPointerCapture(id) {
      return this.capture === id;
    }
    releasePointerCapture() {
      this.capture = undefined;
    }
  }
  doc.createElement = (tag) => new Element(tag);
  doc.body = new Element();
  class Modal {
    constructor(app) {
      this.app = app;
      this.modalEl = new Element();
      this.modalEl.className = 'modal';
      this.contentEl = new Element();
      this.modalEl.append(this.contentEl);
      doc.body.append(this.modalEl);
    }
    close() {
      this.closed = true;
      this.onClose?.();
      this.modalEl.remove();
    }
  }
  const base = class {};
  const obs = {
    Plugin: base,
    PluginSettingTab: base,
    ItemView: base,
    FileView: base,
    Modal,
    FuzzySuggestModal: base,
    Notice: class {
      constructor(text) {
        notices.push(text);
      }
    },
    setIcon(node, name) {
      node.icon = name;
    },
    Scope: class {
      register() {}
    },
  };
  const scope = {
    require: (name) => (name === 'obsidian' ? obs : require(name)),
    module: { exports: {} },
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    crypto: require('node:crypto').webcrypto,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  const load = createLoader(scope);
  scope.module.exports = { ...load('features/boards/board-settings.js'), ...load('features/boards/board-view.js'), ...load('features/boards/column-controls.js') };
  const board = B.makeBoard({ id: 'board', ...input });
  let disk = B.serializeBoard(board),
    writes = 0,
    refreshes = 0,
    tasks = [];
  const file = { path: 'Work.pikoboard', basename: 'Work', extension: 'pikoboard' };
  const vault = {
    getFiles: () => [file],
    getAbstractFileByPath: (path) => (path === file.path ? file : null),
    read: async () => disk,
    async process(_file, change) {
      disk = change(disk);
      writes++;
    },
  };
  const plugin = {
    app: { vault },
    settings: { tasksFolder: 'Tasks', attachmentsFolder: 'Files' },
    boards: new B.BoardStore({ vault }),
    tasks: async () => tasks,
    refresh: () => {
      refreshes++;
    },
  };
  return {
    ...scope.module.exports,
    Element,
    doc,
    listeners,
    frames,
    notices,
    board,
    file,
    plugin,
    data: () => B.parseBoard(disk),
    source: () => disk,
    external: (board) => {
      disk = B.serializeBoard(board);
    },
    tasks: (value) => {
      tasks = value;
    },
    writes: () => writes,
    refreshes: () => refreshes,
    dispatch(type, properties = {}) {
      for (const fn of [...(listeners.get('doc:' + type) || [])])
        fn(event({ type, ...properties }));
    },
  };
}

test('adding a column validates first, stores active semantics once and retains stable IDs on retry', async () => {
  const f = fixture(),
    modal = new f.AddColumnModal(f.plugin, f.file);
  await modal.onOpen();
  assert.equal(await modal.save(), false);
  assert.equal(f.writes(), 0);
  modal.column.label = 'Review';
  modal.column.icon = '👀';
  const id = modal.column.value;
  const originalSave = f.plugin.boards.save.bind(f.plugin.boards);
  let fail = true;
  f.plugin.boards.save = (...args) =>
    fail ? Promise.reject(new Error('Disk temporarily unavailable')) : originalSave(...args);
  assert.equal(await modal.save(), false);
  assert.equal(modal.closed, undefined);
  fail = false;
  assert.equal(await modal.save(), true);
  const data = f.data();
  assert.equal(data.columns.length, 4);
  assert.equal(data.columns.at(-1).value, id);
  assert.equal(data.columns.at(-1).kind, 'active');
  assert.equal(data.columns.at(-1).icon, '👀');
  assert.deepEqual(data.columns.slice(0, 3), f.board.columns);
});

test('double submission cannot duplicate a pending new column and the thirty-column limit writes nothing', async () => {
  const f = fixture(),
    modal = new f.AddColumnModal(f.plugin, f.file);
  await modal.onOpen();
  modal.column.label = 'Review';
  const pending = deferred(),
    originalSave = f.plugin.boards.save.bind(f.plugin.boards);
  f.plugin.boards.save = async (...args) => {
    await pending.promise;
    return originalSave(...args);
  };
  const first = modal.save();
  assert.equal(await modal.save(), false);
  pending.resolve();
  await first;
  assert.equal(f.writes(), 1);
  assert.equal(f.data().columns.length, 4);
  const full = fixture({
    columns: Array.from({ length: 30 }, (_, i) => ({ ...B.DEFAULT_COLUMNS[0], value: 'c' + i })),
  });
  const blocked = new full.AddColumnModal(full.plugin, full.file);
  await blocked.onOpen();
  blocked.column.label = 'Overflow';
  assert.equal(await blocked.save(), false);
  assert.equal(full.writes(), 0);
});

test('saving closes the symbol popup and locks every control until an error restores editable draft state', async () => {
  const f = fixture(),
    modal = new f.AddColumnModal(f.plugin, f.file);
  await modal.onOpen();
  const name = modal.contentEl.querySelector('[aria-label="Название столбца"]');
  name.value = 'Review';
  name.oninput();
  const controls = modal.contentEl.querySelectorAll('button,input,textarea,select');
  controls.forEach((control) => {
    control.disabled = false;
  });
  const originallyDisabled = modal.contentEl.querySelector('.pb-color-swatch');
  originallyDisabled.disabled = true;
  modal.contentEl.querySelector('.pb-symbol-trigger').onclick();
  assert.ok(f.doc.body.querySelector('.pb-symbol-popover'));
  const pending = deferred();
  f.plugin.boards.save = async () => {
    await pending.promise;
    throw new Error('Write failed');
  };
  const result = modal.save();
  assert.equal(f.doc.body.querySelector('.pb-symbol-popover'), null);
  assert.equal(f.listeners.size, 0);
  assert.ok(controls.every((control) => control.disabled));
  assert.equal(await modal.save(), false);
  pending.resolve();
  assert.equal(await result, false);
  assert.equal(modal.closed, undefined);
  assert.equal(name.value, 'Review');
  assert.equal(modal.column.label, 'Review');
  assert.equal(name.disabled, false);
  assert.equal(originallyDisabled.disabled, true);
  assert.equal(modal.saveButton.disabled, false);
  assert.equal(modal.error.textContent, 'Write failed');
  assert.equal(f.writes(), 0);
});

test('column appearance settings retain semantic roles, and occupied or newly occupied columns cannot be removed', async () => {
  const f = fixture(),
    modal = new f.BoardSettingsModal(f.plugin, f.file);
  await modal.onOpen();
  const labels = modal.contentEl.querySelectorAll('input').map((e) => e.attrs['aria-label']);
  assert.equal(
    labels.some((s) => s?.startsWith('Тип')),
    false,
  );
  assert.equal(modal.contentEl.textContent.includes('Хранение'), false);
  assert.equal(
    modal.contentEl.querySelectorAll('[aria-label="Передвинуть столбец вверх"]').length,
    0,
  );
  f.tasks([{ board: 'board', status: 'done', archived: true }]);
  await modal.contentEl.querySelector('[aria-label="Удалить столбец done"]').onclick();
  assert.equal(modal.board.columns.length, 3);
  f.tasks([]);
  await modal.contentEl.querySelector('[aria-label="Удалить столбец done"]').onclick();
  assert.equal(modal.board.columns.length, 2);
  f.tasks([{ board: 'board', status: 'done' }]);
  assert.equal(await modal.save(), false);
  assert.equal(f.writes(), 0);
  assert.deepEqual(
    f.data().columns.map((c) => c.kind),
    ['todo', 'active', 'done'],
  );
});

test('folder settings distinguish root from inherited folders and never alter column values or roles', async () => {
  const f = fixture({ tasksFolder: 'Old tasks' }),
    modal = new f.BoardStorageModal(f.plugin, f.file);
  await modal.onOpen();
  const input = modal.contentEl.querySelector('[aria-label="Новые задачи"]');
  input.value = '';
  input.oninput();
  assert.equal(await modal.save(), true);
  assert.equal(f.data().tasksFolder, '');
  assert.deepEqual(f.data().columns, f.board.columns);
  const inherited = new f.BoardStorageModal(f.plugin, f.file);
  await inherited.onOpen();
  inherited.contentEl.querySelector('[aria-label="Вернуть общую папку"]').onclick();
  assert.equal(inherited.contentEl.querySelector('[aria-label="Новые задачи"]').value, 'Tasks');
  assert.equal(await inherited.save(), true);
  assert.equal(f.data().tasksFolder, undefined);
});

test('stale dialogs preserve external board changes and invalid folder paths never write', async () => {
  const f = fixture(),
    modal = new f.BoardStorageModal(f.plugin, f.file);
  await modal.onOpen();
  modal.board.tasksFolder = '../outside';
  assert.equal(await modal.save(), false);
  assert.equal(f.writes(), 0);
  modal.board.tasksFolder = 'Valid';
  const changed = f.data();
  changed.columns[0].label = 'Changed elsewhere';
  f.external(changed);
  assert.equal(await modal.save(), false);
  assert.equal(f.writes(), 0);
  assert.equal(f.data().columns[0].label, 'Changed elsewhere');
  assert.equal(modal.closed, undefined);
});

test('one symbol popup handles icons, custom emoji and no-icon without losing other draft fields', () => {
  const f = fixture(),
    parent = new f.Element(),
    column = { label: 'Keep name', color: '#123456', icon: 'inbox' };
  f.doc.body.append(parent);
  let changed = 0;
  const trigger = f.symbolPicker(parent, column, () => changed++, f.plugin.app);
  assert.equal(
    parent.querySelectorAll('input').length,
    0,
    'custom emoji typing belongs inside the popup',
  );
  trigger.onclick();
  let popup = f.doc.body.querySelector('.pb-symbol-popover');
  popup
    .querySelectorAll('button')
    .find((b) => b.textContent === 'Эмодзи')
    .onclick();
  const input = popup.querySelector('[aria-label="Свой эмодзи"]');
  input.value = '🦉';
  input.oninput();
  input.parentNode.requestSubmit();
  assert.equal(column.icon, '🦉');
  assert.equal(f.doc.body.querySelector('.pb-symbol-popover'), null);
  assert.equal(f.listeners.size, 0);
  trigger.onclick();
  popup = f.doc.body.querySelector('.pb-symbol-popover');
  popup.querySelector('.pb-symbol-none').onclick();
  assert.equal(column.icon, '');
  trigger.onclick();
  popup = f.doc.body.querySelector('.pb-symbol-popover');
  popup.querySelector('[aria-label="Часы"]').onclick();
  assert.equal(column.icon, 'clock');
  assert.equal(changed, 3);
  assert.equal(column.label, 'Keep name');
  assert.equal(column.color, '#123456');
});

function boardView(f) {
  const view = new f.BoardView(null, f.plugin);
  view.app = f.plugin.app;
  view.file = f.file;
  view.boardConfig = f.board;
  view.refresh = async () => {};
  view.area = new f.Element();
  f.doc.body.append(view.area);
  view.area.rect = { left: 0, right: 900, top: 0, bottom: 500, width: 900, height: 500 };
  view.columns = new Map(
    f.board.columns.map((column, i) => {
      const col = new f.Element(),
        header = new f.Element('header');
      col.rect = {
        left: i * 300,
        right: (i + 1) * 300,
        top: 0,
        bottom: 500,
        width: 300,
        height: 500,
      };
      col.append(header);
      view.area.append(col);
      view.bindColumnDrag(header, col, column.value);
      return [column.value, { col, header }];
    }),
  );
  return view;
}

test('moving columns changes only order and rejects stale positions and self drops', async () => {
  const f = fixture(),
    view = boardView(f);
  assert.equal(await view.moveColumn('done', 'open', false), true);
  assert.deepEqual(
    f.data().columns.map((c) => c.value),
    ['done', 'open', 'in-progress'],
  );
  assert.deepEqual(f.data().columns[0], f.board.columns[2]);
  assert.equal(await view.moveColumn('done', 'done'), false);
  assert.equal(await view.moveColumn('missing', 'open'), false);
  assert.equal(f.writes(), 1);
  const latest = f.data();
  latest.columns[1].label = 'Elsewhere';
  f.external(latest);
  assert.equal(await view.moveColumn('done', 'in-progress', true), false);
  assert.equal(f.data().columns[1].label, 'Elsewhere');
  assert.equal(f.writes(), 1);
  assert.equal(view.moving, false);
});

test('column reorder catches an atomic save conflict and cannot run for aggregate or archived views', async () => {
  const f = fixture(),
    view = boardView(f),
    process = f.plugin.app.vault.process;
  f.plugin.app.vault.process = async (file, change) => {
    const changed = f.data();
    changed.tasksFolder = 'Concurrent';
    f.external(changed);
    return process(file, change);
  };
  assert.equal(await view.moveColumn('done', 'open'), false);
  assert.equal(f.data().tasksFolder, 'Concurrent');
  assert.deepEqual(
    f.data().columns.map((c) => c.value),
    ['open', 'in-progress', 'done'],
  );
  assert.equal(view.moving, false);
  view.archive = true;
  assert.equal(await view.moveColumn('done', 'open'), false);
  view.archive = false;
  view.file = null;
  assert.equal(await view.moveColumn('done', 'open'), false);
});

test('column pointer cancellation clears capture, highlights and listeners without saving', () => {
  for (const cancel of ['pointercancel', 'Escape', 'close']) {
    const f = fixture(),
      view = boardView(f),
      { header, col } = view.columns.get('open');
    header.onpointerdown(
      event({ button: 0, target: header, clientX: 30, clientY: 20, pointerId: 1 }),
    );
    f.dispatch('pointermove', { clientX: 600, clientY: 20 });
    assert.equal(view.dragColumn, 'open');
    assert.equal(header.capture, 1);
    if (cancel === 'Escape') f.dispatch('keydown', { key: 'Escape' });
    else if (cancel === 'close') view.cancelColumnDrag();
    else f.dispatch(cancel);
    assert.equal(view.dragColumn, null);
    assert.equal(header.capture, undefined);
    assert.equal(col.classList.contains('pb-column-dragging'), false);
    assert.equal(view.area.querySelectorAll('.pb-column-before,.pb-column-after').length, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.frames.size, 0);
    assert.equal(f.writes(), 0);
  }
});

test('column dragging ignores controls and card drags; pointer drop and keyboard shortcut share the reorder contract', () => {
  const f = fixture(),
    view = boardView(f),
    { header } = view.columns.get('open'),
    changes = [];
  view.moveColumn = (...args) => {
    changes.push(args);
  };
  const button = new f.Element('button');
  header.append(button);
  header.onpointerdown(
    event({ button: 0, target: button, clientX: 20, clientY: 20, pointerId: 1 }),
  );
  assert.equal(f.listeners.size, 0);
  view.dragPath = 'Task.md';
  header.onpointerdown(
    event({ button: 0, target: header, clientX: 20, clientY: 20, pointerId: 1 }),
  );
  assert.equal(f.listeners.size, 0);
  view.dragPath = null;
  header.onpointerdown(
    event({ button: 0, target: header, clientX: 20, clientY: 20, pointerId: 1 }),
  );
  f.dispatch('pointermove', { clientX: 850, clientY: 20 });
  f.dispatch('pointerup');
  assert.deepEqual(changes[0], ['open', 'done', true]);
  header.onkeydown(event({ key: 'ArrowRight', altKey: true, target: header }));
  assert.deepEqual(changes[1], ['open', 'in-progress', true]);
  header.onkeydown(event({ key: 'ArrowLeft', altKey: true, target: header }));
  assert.equal(changes.length, 2, 'first column cannot move farther left');
});
