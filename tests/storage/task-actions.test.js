'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskActions } = require('../../src/features/tasks/task-actions.js');
const { TaskStore, settingsFrom, splitDocument } = require('../../src/storage/task-store.js');
const C = require('../../src/domain/tasks.js');

function fixture() {
  const disk = new Map(), files = new Map(), boards = new Map();
  const settings = settingsFrom({ autoArchive: false });
  const encode = (data, body = '\nDescription\n') => '---\n' + JSON.stringify(data) + '\n---\n' + body;
  const add = (name, extra = {}) => {
    const file = { path: name + '.md', basename: name, extension: 'md' };
    files.set(file.path, file);
    disk.set(file.path, encode({ title: name, tags: ['task'], status: 'open', ...extra }));
    return file;
  };
  const vault = {
    getAbstractFileByPath: (path) => files.get(path),
    getMarkdownFiles: () => [...files.values()],
    read: async (file) => disk.get(file.path),
    cachedRead: async (file) => disk.get(file.path),
    process: async (file, change) => {
      if (vault.beforeProcess) { const hook = vault.beforeProcess; vault.beforeProcess = null; hook(file); }
      if (vault.fail) throw new Error('DISK_FULL');
      disk.set(file.path, change(disk.get(file.path)));
    },
  };
  const store = new TaskStore({ app: { vault }, settings: () => settings,
    parseYaml: JSON.parse, stringifyYaml: JSON.stringify, getBoard: (id) => boards.get(id),
    now: () => new Date('2026-10-21T10:00:00Z') });
  const events = [], queues = new Map();
  let savedOrder = [];
  const plugin = { app: { vault }, store, data: { order: [] }, refresh() {}, tasks: () => store.list(),
    queue(file, job) {
      const next = (queues.get(file) || Promise.resolve()).catch(() => {}).then(job);
      queues.set(file, next);
      return next;
    },
    async persist() {
      if (plugin.failSave) throw new Error('SETTINGS_FULL');
      savedOrder = [...plugin.data.order];
    },
  };
  const actions = new TaskActions(plugin, (e) => events.push(e));
  const data = (file) => splitDocument(disk.get(file.path), JSON.parse).data;
  const edit = (file, patch, body) => {
    const current = splitDocument(disk.get(file.path), JSON.parse);
    disk.set(file.path, encode({ ...current.data, ...patch }, body ?? current.body));
  };
  return { actions, plugin, store, vault, disk, files, boards, settings, add, data, edit, events,
    saved: () => savedOrder };
}

test('undo changes only touched fields, preserving new body, history and unrelated metadata', async () => {
  const f = fixture(), file = f.add('Task');
  await f.actions.patch(file, { due: '2026-10-23', projects: ['[[Growth]]'] });
  const body = C.appendUpdate('Fresh description', { id: 'entry', at: '2026-10-21T10:00:00Z', text: 'New comment' });
  f.edit(file, { custom: 'keep', title: 'Renamed title' }, body);
  await f.actions.undo();
  assert.equal(f.data(file).due, undefined);
  assert.equal(f.data(file).projects, undefined);
  assert.equal(f.data(file).custom, 'keep');
  assert.equal(f.data(file).title, 'Renamed title');
  assert.equal(splitDocument(f.disk.get(file.path), JSON.parse).body, body);
  assert.equal(f.actions.last, null);
});
test('drag to another column undoes status and position in one action', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B'), c = f.add('C');
  await f.actions.move(a, 'done', c.path, true);
  assert.equal(f.data(a).status, 'done');
  assert.ok(f.data(a).completedDate);
  assert.deepEqual(f.plugin.data.order, [b.path, c.path, a.path]);
  assert.equal(f.events.length, 1);
  await f.actions.undo();
  assert.equal(f.data(a).status, 'open');
  assert.equal(f.data(a).completedDate, undefined);
  assert.deepEqual(f.saved(), [a.path, b.path, c.path]);
});
test('reordering in one column survives a rename and preserves a newly created task', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B'), c = f.add('C');
  await f.actions.move(b, 'open', c.path, true);
  const old = b.path, text = f.disk.get(old);
  f.files.delete(old); f.disk.delete(old); b.path = 'Renamed.md';
  f.files.set(b.path, b); f.disk.set(b.path, text);
  const d = f.add('D');
  f.plugin.data.order = [d.path, a.path, c.path, b.path];
  await f.actions.undo();
  assert.deepEqual(f.saved(), [d.path, a.path, b.path, c.path]);
});
test('archive undo preserves tags and completion date; unarchive undo restores the archive', async () => {
  const f = fixture(), file = f.add('Done', { status: 'done', completedDate: '2026-10-20T10:00:00Z', tags: ['task', 'research'] });
  await f.actions.patch(file, { archived: true });
  assert.equal((await f.store.get(file.path)).archived, true);
  await f.actions.undo();
  assert.deepEqual(f.data(file).tags, ['task', 'research']);
  assert.equal(f.data(file).completedDate, '2026-10-20T10:00:00Z');
  await f.store.update(file.path, { archived: true });
  await f.actions.patch(file, { archived: false });
  assert.equal(f.data(file).completedDate, '2026-10-21T10:00:00.000Z');
  await f.actions.undo();
  assert.equal((await f.store.get(file.path)).archived, true);
  assert.equal(f.data(file).completedDate, '2026-10-20T10:00:00Z');
});
test('external field conflict is detected atomically and rolls back the order restoration', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B');
  await f.actions.move(a, 'done', b.path, true);
  const record = f.actions.last;
  f.vault.beforeProcess = () => f.edit(a, { status: 'in-progress' });
  await assert.rejects(f.actions.undo(), /изменил/);
  assert.equal(f.data(a).status, 'in-progress');
  assert.deepEqual(f.saved(), [b.path, a.path]);
  assert.equal(f.actions.last, record);
});
test('no-op and failed actions do not replace last undo; old notifications cannot undo newer changes', async () => {
  const f = fixture(), file = f.add('Task');
  await f.actions.patch(file, { due: '2026-10-22' });
  const first = f.actions.last;
  await f.actions.patch(file, { due: '2026-10-22' });
  assert.equal(f.actions.last, first);
  f.vault.fail = true;
  await assert.rejects(f.actions.patch(file, { title: 'Fail' }), /DISK_FULL/);
  assert.equal(f.actions.last, first);
  f.vault.fail = false;
  await f.actions.patch(file, { title: 'Fresh' });
  assert.equal(await f.actions.undo(first), false);
  assert.equal(f.data(file).title, 'Fresh');
  await f.actions.undo();
  assert.equal(f.data(file).title, 'Task');
  assert.equal(f.data(file).due, '2026-10-22');
});
test('failed undo stays retryable and failed order save never changes status during undo', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B');
  await f.actions.move(a, 'done', b.path, true);
  f.plugin.failSave = true;
  await assert.rejects(f.actions.undo(), /SETTINGS_FULL/);
  assert.equal(f.data(a).status, 'done');
  assert.deepEqual(f.plugin.data.order, [b.path, a.path]);
  f.plugin.failSave = false; f.vault.fail = true;
  await assert.rejects(f.actions.undo(), /DISK_FULL/);
  assert.deepEqual(f.saved(), [b.path, a.path]);
  f.vault.fail = false;
  assert.equal(await f.actions.undo(), true);
});
test('partially failed drag still offers undo for the status that was committed', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B');
  f.plugin.failSave = true;
  await assert.rejects(f.actions.move(a, 'done', b.path, true), /SETTINGS_FULL/);
  assert.equal(f.data(a).status, 'done');
  assert.equal(f.actions.last.order, undefined);
  f.plugin.failSave = false;
  await f.actions.undo();
  assert.equal(f.data(a).status, 'open');
});
test('a failed rollback retains only the remaining field undo and can be retried', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B');
  await f.actions.move(a, 'done', b.path, true);
  f.vault.beforeProcess = () => { f.vault.fail = true; f.plugin.failSave = true; };
  await assert.rejects(f.actions.undo(), /Позиция возвращена/);
  assert.deepEqual(f.saved(), [a.path, b.path]);
  assert.equal(f.data(a).status, 'done');
  assert.equal(f.actions.last.order, undefined);
  f.plugin.failSave = false; f.vault.fail = false;
  await f.actions.undo();
  assert.equal(f.data(a).status, 'open');
});
test('rapid functional tag edits serialize and undo removes only the last added tag', async () => {
  const f = fixture(), file = f.add('Task');
  await Promise.all(['one', 'two'].map((tag) => f.actions.patch(file, (t) => ({ tags: [...t.tags, tag] }))));
  assert.deepEqual(f.data(file).tags, ['task', 'one', 'two']);
  await f.actions.undo();
  assert.deepEqual(f.data(file).tags, ['task', 'one']);
});
test('undo refuses deleted files, replaced files, changed mappings and removed destination columns', async () => {
  const f = fixture(), file = f.add('Task');
  await f.actions.patch(file, { due: '2026-10-22' });
  f.files.delete(file.path);
  await assert.rejects(f.actions.undo(), /удалена/);
  f.files.set(file.path, { ...file });
  await assert.rejects(f.actions.undo(), /заменена/);
  f.files.set(file.path, file);
  f.settings.fieldMapping = { ...f.settings.fieldMapping, due: 'deadline' };
  await assert.rejects(f.actions.undo(), /Настройки/);
  f.settings.fieldMapping.due = 'due';
  const board = { id: 'test', columns: [{ value: 'later', kind: 'todo' }, { value: 'done', kind: 'done' }] };
  f.boards.set(board.id, board);
  f.edit(file, { board: board.id, status: 'later' });
  await f.actions.patch(file, { status: 'done' });
  board.columns.shift();
  await assert.rejects(f.actions.undo(), /Неизвестный статус/);
  assert.equal(f.data(file).status, 'done');
});
test('external reorder conflict does not overwrite current card ordering', async () => {
  const f = fixture(), a = f.add('A'), b = f.add('B'), c = f.add('C');
  await f.actions.move(a, 'open', c.path, true);
  f.plugin.data.order = [c.path, b.path, a.path];
  await assert.rejects(f.actions.undo(), /Порядок/);
  assert.deepEqual(f.plugin.data.order, [c.path, b.path, a.path]);
});
