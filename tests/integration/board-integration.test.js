'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../src/storage/board-store.js');
const S = require('../../src/storage/task-store.js');
const C = require('../../src/domain/tasks.js');

// Both production stores share one vault, including atomic edits and file renames.
// JSON is valid YAML; the real app provides the YAML codec.
function fixture(settings = {}) {
  const files = new Map(),
    directories = new Map(),
    disk = new Map(),
    locks = new Map();
  let clock = new Date('2026-01-10T12:00:00Z');
  const fileAt = (path) => ({
    path,
    extension: path.split('.').pop(),
    basename: path
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, ''),
  });
  const vault = {
    getFiles: () => [...files.values()],
    getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === 'md'),
    getAbstractFileByPath: (path) => files.get(path) || directories.get(path),
    async read(file) {
      if (!disk.has(file.path)) throw Error('Missing file');
      return disk.get(file.path);
    },
    async cachedRead(file) {
      return this.read(file);
    },
    async createFolder(path) {
      directories.set(path, { path });
    },
    async create(path, text) {
      if (files.has(path) || directories.has(path)) throw Error('Already exists');
      const file = fileAt(path);
      files.set(path, file);
      disk.set(path, text);
      return file;
    },
    async rename(file, path) {
      const text = disk.get(file.path);
      disk.delete(file.path);
      files.delete(file.path);
      Object.assign(file, fileAt(path));
      files.set(path, file);
      disk.set(path, text);
    },
    async process(file, change) {
      const work = (locks.get(file.path) || Promise.resolve())
        .catch(() => {})
        .then(() => disk.set(file.path, change(disk.get(file.path))));
      locks.set(file.path, work);
      return work;
    },
  };
  const boards = new B.BoardStore({ vault });
  const tasks = new S.TaskStore({
    app: { vault },
    settings: () => S.settingsFrom(settings),
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
    getBoard: (id) => boards.get(id)?.board,
    now: () => clock,
  });
  return {
    boards,
    tasks,
    vault,
    disk,
    at: (date) => {
      clock = new Date(date);
    },
  };
}
const columns = () => [
  { value: 'later', label: 'Later', kind: 'todo', color: '#aabbcc', opacity: 0.04, icon: '' },
  { value: 'review', label: 'Review', kind: 'active', color: '#af8cdd', opacity: 0.09, icon: '👀' },
  {
    value: 'released',
    label: 'Released',
    kind: 'done',
    color: '#8caa99',
    opacity: 0.03,
    icon: 'check',
  },
];

test('two file boards in arbitrary folders keep distinct tasks even when sharing the task folder', async () => {
  const f = fixture({ tasksFolder: 'Shared tasks' });
  const a = await f.boards.create({
    id: 'board-a',
    title: 'Work',
    folder: 'Projects/Work',
    columns: columns(),
  });
  const b = await f.boards.create({
    id: 'board-b',
    title: 'Home',
    folder: 'Life',
    columns: columns(),
  });
  const taskA = await f.tasks.create({ title: 'Same title', board: a.board.id, status: 'later' });
  const taskB = await f.tasks.create({ title: 'Same title', board: b.board.id, status: 'later' });
  assert.equal(a.file.path, 'Projects/Work/Work.pikoboard');
  assert.equal(b.file.path, 'Life/Home.pikoboard');
  assert.equal(taskA.path, 'Shared tasks/Same title.md');
  assert.equal(taskB.path, 'Shared tasks/Same title 2.md');
  const all = await f.tasks.list();
  assert.deepEqual(
    all.filter((t) => t.board === a.board.id).map((t) => t.path),
    [taskA.path],
  );
  assert.deepEqual(
    all.filter((t) => t.board === b.board.id).map((t) => t.path),
    [taskB.path],
  );
});

test('renaming and moving the board retains task identity, Markdown history and next-step links', async () => {
  const f = fixture();
  const record = await f.boards.create({
    id: 'stable-id',
    title: 'Original',
    columns: columns(),
    tasksFolder: 'Work/Tasks',
  });
  const task = await f.tasks.create({
    title: 'Research',
    board: record.board.id,
    status: 'review',
  });
  const taskFile = f.vault.getAbstractFileByPath(task.path);
  await f.vault.process(taskFile, (text) =>
    C.appendUpdate(C.setNextAction(text, '', '- [ ] Compare [[Materials/Research]]'), {
      id: 'entry',
      at: '2026-01-09T10:00:00Z',
      text: '**Findings**\n![[Files/chart.png]]',
    }),
  );
  const before = f.disk.get(task.path);
  await f.vault.rename(record.file, 'Archive/Renamed.pikoboard');
  const reloaded = await f.boards.load(record.file);
  assert.equal(reloaded.board.id, 'stable-id');
  assert.equal((await f.tasks.get(task.path)).board, 'stable-id');
  assert.equal((await f.tasks.get(task.path)).isActive, true);
  assert.equal(f.disk.get(task.path), before);
  const created = await f.tasks.create({
    title: 'Next research',
    board: 'stable-id',
    status: 'later',
  });
  assert.equal(created.path, 'Work/Tasks/Next research.md');
});

test('column appearance and title edits retain status identity and the original completion clock', async () => {
  const f = fixture();
  const record = await f.boards.create({ id: 'board', title: 'Board', columns: columns() });
  const task = await f.tasks.create({ title: 'Delivered', board: 'board', status: 'released' });
  const original = f.disk.get(task.path);
  record.board.columns[2] = {
    ...record.board.columns[2],
    label: 'Finished',
    color: '#6750ff',
    opacity: 0,
    icon: '',
  };
  await f.boards.save(record.file, record.board, f.disk.get(record.file.path));
  const reloaded = await f.tasks.get(task.path);
  assert.equal(reloaded.status, 'released');
  assert.equal(reloaded.isCompleted, true);
  assert.equal(reloaded.completedDate, '2026-01-10T12:00:00.000Z');
  assert.equal(f.disk.get(task.path), original);
  const finalColumn = f.boards.get('board').board.columns[2];
  assert.equal(finalColumn.icon, '');
  assert.equal(finalColumn.opacity, 0);
});

test('custom done columns archive after the grace period and reopening starts a new completion cycle', async () => {
  const f = fixture();
  await f.boards.create({ id: 'board', title: 'Board', columns: columns() });
  const task = await f.tasks.create({ title: 'Task', board: 'board', status: 'review' });
  await f.tasks.update(task.path, { status: 'released' });
  f.at('2026-01-17T11:59:59Z');
  assert.equal(await f.tasks.archiveExpired(), 0);
  await f.tasks.update(task.path, { status: 'review' });
  f.at('2026-01-17T12:00:00Z');
  assert.equal(await f.tasks.archiveExpired(), 0);
  assert.equal((await f.tasks.get(task.path)).completedDate, undefined);
  await f.tasks.update(task.path, { status: 'released' });
  f.at('2026-01-24T12:00:00Z');
  assert.equal(await f.tasks.archiveExpired(), 1);
  assert.ok(f.vault.getAbstractFileByPath(task.path));
});

test('copied duplicate board identities cannot silently join task populations or receive new tasks', async () => {
  const f = fixture();
  const record = await f.boards.create({ id: 'board', title: 'Board', columns: columns() });
  const task = await f.tasks.create({ title: 'Existing', board: 'board', status: 'review' });
  const before = f.disk.get(task.path);
  await f.vault.create('Copied.pikoboard', f.disk.get(record.file.path));
  await f.boards.list();
  assert.equal(f.boards.get('board'), null);
  await assert.rejects(f.boards.load(record.file), /ID/);
  await assert.rejects(
    f.tasks.create({ title: 'Unsafe', board: 'board', status: 'review' }),
    /Доска не найдена/,
  );
  assert.equal((await f.tasks.list()).length, 1, 'existing tasks remain accessible for recovery');
  assert.equal(f.disk.get(task.path), before);
});

test('folder overrides affect only future task locations; existing task Markdown is never moved', async () => {
  const f = fixture({ tasksFolder: 'Default' });
  const record = await f.boards.create({ id: 'board', title: 'Board', columns: columns() });
  const before = await f.tasks.create({ title: 'Before', board: 'board', status: 'later' });
  record.board.tasksFolder = '';
  await f.boards.save(record.file, record.board);
  const after = await f.tasks.create({ title: 'After', board: 'board', status: 'later' });
  assert.equal(before.path, 'Default/Before.md');
  assert.equal(after.path, 'After.md');
  assert.ok(f.vault.getAbstractFileByPath(before.path));
  assert.equal((await f.tasks.get(before.path)).board, 'board');
});

test('invalid board folders and task-folder overrides fail before any vault writes', async () => {
  for (const bad of [
    '../outside',
    '/absolute',
    '.obsidian/plugins',
    'safe/../outside',
    'safe//nested',
    'bad\u0000path',
  ]) {
    const f = fixture();
    await assert.rejects(f.boards.create({ id: 'board', title: 'Board', folder: bad }));
    assert.equal(f.disk.size, 0);
    await assert.rejects(f.boards.create({ id: 'board', title: 'Board', tasksFolder: bad }));
    assert.equal(f.disk.size, 0);
  }
});
