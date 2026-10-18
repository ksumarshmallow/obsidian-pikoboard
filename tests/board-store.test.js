'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BoardStore,
  makeBoard,
  normalizeBoard,
  parseBoard,
  serializeBoard,
  DEFAULT_COLUMNS,
} = require('../board-store');

function fixture() {
  const files = new Map(),
    disk = new Map(),
    folders = new Map();
  const add = (path, content = serializeBoard(makeBoard({ id: 'board-one' }))) => {
    const file = {
      path,
      extension: path.split('.').pop(),
      basename: path
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, ''),
    };
    files.set(path, file);
    disk.set(path, content);
    return file;
  };
  const vault = {
    getFiles: () => [...files.values()],
    getAbstractFileByPath: (path) => files.get(path) || folders.get(path),
    async read(file) {
      if (!disk.has(file.path)) throw new Error('Missing file');
      return disk.get(file.path);
    },
    async createFolder(path) {
      folders.set(path, { path, children: [] });
    },
    async create(path, text) {
      if (files.has(path)) throw new Error('Already exists');
      return add(path, text);
    },
    async process(file, callback) {
      if (!disk.has(file.path)) throw new Error('Missing file');
      disk.set(file.path, callback(disk.get(file.path)));
    },
  };
  const store = new BoardStore({ vault });
  return {
    store,
    add,
    disk,
    files,
    vault,
    rename(file, path) {
      files.delete(file.path);
      const content = disk.get(file.path);
      disk.delete(file.path);
      file.path = path;
      files.set(path, file);
      disk.set(path, content);
    },
  };
}

test('board files round-trip custom columns, emoji, no-icon, transparent colors and future fields', () => {
  const input = makeBoard({
    id: 'board-123',
    future: { preserve: ['anything'] },
    columns: [
      {
        value: 'waiting',
        label: ' Waiting ',
        kind: 'active',
        color: '#ABc',
        opacity: 0,
        icon: '⏳',
        future: true,
      },
      {
        value: 'finished',
        label: 'Finished',
        kind: 'done',
        color: '#123456',
        opacity: 0.3,
        icon: '',
      },
    ],
    tasksFolder: 'Work/Tasks',
    attachmentsFolder: '',
  });
  const result = parseBoard(serializeBoard(input));
  assert.equal(result.columns[0].color, '#aabbcc');
  assert.equal(result.columns[0].label, 'Waiting');
  assert.equal(result.columns[0].opacity, 0);
  assert.equal(result.columns[1].icon, '');
  assert.deepEqual(result.future, input.future);
  assert.equal(result.columns[0].future, true);
  assert.equal(result.attachmentsFolder, '');
});

test('a new board gets independent copies of the three default columns', () => {
  const a = makeBoard({ id: 'a' }),
    b = makeBoard({ id: 'b' });
  a.columns[0].label = 'Different';
  assert.equal(b.columns[0].label, 'backlog');
  assert.equal(DEFAULT_COLUMNS[0].label, 'backlog');
  assert.deepEqual(
    b.columns.map((c) => c.kind),
    ['todo', 'active', 'done'],
  );
});

test('invalid board and column identities or shapes are rejected before persistence', () => {
  const valid = makeBoard({ id: 'valid' });
  for (const invalid of [
    null,
    [],
    {},
    { ...valid, id: '' },
    { ...valid, id: '../board' },
    { ...valid, columns: [] },
    { ...valid, columns: Array(31).fill(valid.columns[0]) },
    { ...valid, columns: [valid.columns[0], valid.columns[0]] },
    { ...valid, columns: [{ ...valid.columns[0], value: '' }] },
    { ...valid, columns: [{ ...valid.columns[0], label: ' ' }] },
    { ...valid, columns: [{ ...valid.columns[0], kind: 'maybe' }] },
    { ...valid, columns: [{ ...valid.columns[0], color: 'url(x)' }] },
    { ...valid, columns: [{ ...valid.columns[0], opacity: -0.01 }] },
    { ...valid, columns: [{ ...valid.columns[0], opacity: 1.01 }] },
    { ...valid, columns: [{ ...valid.columns[0], opacity: NaN }] },
    { ...valid, columns: [{ ...valid.columns[0], opacity: '0.5' }] },
    { ...valid, columns: [{ ...valid.columns[0], icon: {} }] },
  ])
    assert.throws(() => normalizeBoard(invalid));
  assert.throws(() => makeBoard({ id: '' }));
});

test('path configuration rejects traversal, hidden folders and absolute paths', () => {
  for (const path of [
    '../Tasks',
    'Tasks/../Other',
    '/Tasks',
    '.obsidian/plugins',
    'Work/.hidden',
    'a//b',
    'C:\\Tasks',
    'a\u0000b',
  ]) {
    for (const key of ['tasksFolder', 'attachmentsFolder'])
      assert.throws(() => makeBoard({ id: 'one', [key]: path }));
  }
  const board = makeBoard({
    id: 'one',
    tasksFolder: 'Work\\Tasks/',
    attachmentsFolder: ' Files/Images ',
  });
  assert.equal(board.tasksFolder, 'Work/Tasks');
  assert.equal(board.attachmentsFolder, 'Files/Images');
});

test('creating a board works in nested folders, keeps task files untouched and resolves name collisions', async () => {
  const f = fixture();
  f.add('Existing task.md', '# Task\n');
  const [a, b] = await Promise.all([
    f.store.create({ title: 'Work', folder: 'Boards/Projects', id: 'a' }),
    f.store.create({ title: 'Work', folder: 'Boards/Projects', id: 'b' }),
  ]);
  assert.equal(a.file.path, 'Boards/Projects/Work.pikoboard');
  assert.equal(b.file.path, 'Boards/Projects/Work 2.pikoboard');
  assert.equal(f.disk.get('Existing task.md'), '# Task\n');
  assert.equal((await f.store.list()).length, 2);
  assert.equal(f.store.get('a').file, a.file);
});

test('unsafe creation paths and file/folder collisions leave existing content untouched', async () => {
  const f = fixture();
  f.add('Notes', 'keep');
  await assert.rejects(f.store.create({ title: 'Board', folder: 'Notes/Boards', id: 'a' }));
  await assert.rejects(f.store.create({ title: '.hidden', folder: '', id: 'b' }));
  await assert.rejects(f.store.create({ title: 'Board', folder: '../outside', id: 'c' }));
  await assert.rejects(f.store.create({ title: 'Board\nUnsafe', folder: '', id: 'd' }));
  assert.deepEqual([...f.disk], [['Notes', 'keep']]);
});

test('moving or renaming a board preserves identity and removing a file drops cached lookup', async () => {
  const f = fixture(),
    record = await f.store.create({ title: 'Before', id: 'stable' });
  f.rename(record.file, 'Elsewhere/After.pikoboard');
  assert.equal(f.store.get('stable').file.path, 'Elsewhere/After.pikoboard');
  const loaded = await f.store.load(record.file);
  assert.equal(loaded.board.id, 'stable');
  f.files.delete(record.file.path);
  assert.equal(f.store.get('stable'), null);
});

test('malformed board files are diagnosed while valid boards remain available', async () => {
  const f = fixture(),
    broken = f.add('Broken.pikoboard', '{ nope');
  f.add('Good.pikoboard');
  const result = await f.store.list();
  assert.equal(result.length, 1);
  assert.equal(result[0].file.path, 'Good.pikoboard');
  assert.deepEqual(
    f.store.errors.map((e) => e.path),
    ['Broken.pikoboard'],
  );
  await assert.rejects(f.store.load(broken), /JSON/);
});

test('copied board IDs cannot silently share tasks or be claimed by another new board', async () => {
  const f = fixture(),
    a = f.add('First.pikoboard'),
    b = f.add('Copy.pikoboard');
  f.add('Other.pikoboard', serializeBoard(makeBoard({ id: 'other' })));
  const result = await f.store.list();
  assert.equal(result.length, 1);
  assert.equal(result[0].board.id, 'other');
  assert.equal(f.store.errors.length, 2);
  assert.equal(f.store.get('board-one'), null);
  await assert.rejects(f.store.load(a), /несколькими/);
  await assert.rejects(f.store.load(b), /несколькими/);
  await assert.rejects(f.store.create({ title: 'Third', id: 'board-one' }), /уже существует/);
});

test('save preserves newer unknown root and column fields when a caller only supplies known values', async () => {
  const f = fixture(),
    original = makeBoard({ id: 'one', future: 'keep' });
  original.columns[0].future = { keep: true };
  const file = f.add('Board.pikoboard', serializeBoard(original));
  const next = makeBoard({ id: 'one' });
  next.columns[0].label = 'Renamed';
  const result = await f.store.save(file, next);
  assert.equal(result.board.future, 'keep');
  assert.deepEqual(result.board.columns[0].future, { keep: true });
  assert.equal(result.board.columns[0].label, 'Renamed');
  assert.equal(result.board.columns[0].value, 'open');
});

test('save rejects a stale editor without overwriting changes, including edits occurring before atomic process', async () => {
  const f = fixture(),
    file = f.add('Board.pikoboard');
  const baseline = f.disk.get(file.path),
    next = parseBoard(baseline);
  next.columns[0].label = 'Stale update';
  const external = { ...parseBoard(baseline), tasksFolder: 'New/Tasks' };
  f.disk.set(file.path, serializeBoard(external));
  await assert.rejects(f.store.save(file, next, baseline), /уже изменена/);
  assert.equal(f.disk.get(file.path), serializeBoard(external));
});

test('clearing folder overrides restores inheritance while empty paths still mean vault root', async () => {
  const f = fixture(),
    original = makeBoard({
      id: 'one',
      tasksFolder: 'Board/Tasks',
      attachmentsFolder: 'Board/Files',
      future: { preserved: true },
    }),
    file = f.add('Board.pikoboard', serializeBoard(original));
  const inherited = makeBoard({ id: 'one' });
  await f.store.save(file, inherited);
  let saved = parseBoard(f.disk.get(file.path));
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'tasksFolder'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'attachmentsFolder'), false);
  assert.deepEqual(saved.future, { preserved: true });
  await f.store.save(file, { ...inherited, tasksFolder: '', attachmentsFolder: '' });
  saved = parseBoard(f.disk.get(file.path));
  assert.equal(saved.tasksFolder, '');
  assert.equal(saved.attachmentsFolder, '');
});

test('save cannot replace invalid source or change an existing identity', async () => {
  const f = fixture(),
    broken = f.add('Broken.pikoboard', 'bad'),
    good = f.add('Good.pikoboard');
  await assert.rejects(f.store.save(broken, makeBoard({ id: 'replacement' })), /JSON/);
  const before = f.disk.get(good.path);
  await assert.rejects(f.store.save(good, makeBoard({ id: 'replacement' })), /ID/);
  assert.equal(f.disk.get(broken.path), 'bad');
  assert.equal(f.disk.get(good.path), before);
});

test('callers cannot mutate cached configuration without saving', async () => {
  const f = fixture(),
    record = await f.store.create({ title: 'Board', id: 'one' });
  record.board.columns[0].label = 'No save';
  const lookedUp = f.store.get('one');
  assert.equal(lookedUp.board.columns[0].label, 'backlog');
  lookedUp.board.columns[0].label = 'Still no save';
  assert.equal(f.store.get('one').board.columns[0].label, 'backlog');
});

function delayNextRead(vault) {
  const original = vault.read.bind(vault);
  let entered, release;
  const started = new Promise((resolve) => (entered = resolve)),
    waiting = new Promise((resolve) => (release = resolve));
  let first = true;
  vault.read = async (file) => {
    const text = await original(file);
    if (first) {
      first = false;
      entered();
      await waiting;
    }
    return text;
  };
  return { started, release };
}

test('a slow earlier scan cannot overwrite a newer board index', async () => {
  const f = fixture(),
    file = f.add('Board.pikoboard');
  const pending = delayNextRead(f.vault),
    oldScan = f.store.list();
  await pending.started;
  const changed = parseBoard(f.disk.get(file.path));
  changed.columns[0].label = 'Newest';
  f.disk.set(file.path, serializeBoard(changed));
  await f.store.list();
  pending.release();
  const oldResult = await oldScan;
  assert.equal(oldResult[0].board.columns[0].label, 'Newest');
  assert.equal(f.store.get('board-one').board.columns[0].label, 'Newest');
});

test('an in-flight scan cannot undo a board save in the identity cache', async () => {
  const f = fixture(),
    file = f.add('Board.pikoboard');
  await f.store.list();
  const pending = delayNextRead(f.vault),
    scan = f.store.list();
  await pending.started;
  const changed = parseBoard(f.disk.get(file.path));
  changed.columns[0].label = 'Saved';
  await f.store.save(file, changed);
  pending.release();
  const result = await scan;
  assert.equal(result[0].board.columns[0].label, 'Saved');
  assert.equal(f.store.get('board-one').board.columns[0].label, 'Saved');
});

test('creating a board invalidates an older index scan without losing the new board', async () => {
  const f = fixture();
  f.add('Existing.pikoboard');
  const pending = delayNextRead(f.vault),
    scan = f.store.list();
  await pending.started;
  await f.store.create({ title: 'New', id: 'new-board' });
  pending.release();
  const result = await scan;
  assert.equal(result.length, 2);
  assert.ok(f.store.get('new-board'));
});
