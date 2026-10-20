'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SavedFilters } = require('../../src/storage/saved-filters.js');

function fixture() {
  let disk = {}, refreshes = 0;
  const plugin = { data: { drafts: { a: 'unfinished' } }, persist: async () => {
    disk = JSON.parse(JSON.stringify(plugin.data));
  }, refresh: () => refreshes++ };
  return { plugin, store: new SavedFilters(plugin), disk: () => disk, refreshes: () => refreshes };
}
test('saved combinations survive reloading, stay local to their board and do not modify drafts', async () => {
  const { plugin, store, disk } = fixture();
  const filters = { project: 'Projects/growth', statuses: ['open'], tags: ['learn'], query: 'урок' };
  await store.save('board-a', 'Учёба', filters, false);
  await store.save('board-b', 'Учёба', {}, true);
  filters.tags.push('changed-after-save');
  const reloaded = new SavedFilters({ data: disk() });
  assert.equal(reloaded.list('board-a').length, 1);
  assert.deepEqual(reloaded.list('board-a')[0].filters.tags, ['learn']);
  assert.equal(reloaded.list('board-b')[0].archive, true);
  assert.equal(reloaded.list('__all__').length, 0);
  assert.deepEqual(plugin.data.drafts, { a: 'unfinished' });
  const copy = reloaded.list('board-a')[0];
  copy.filters.tags.push('outside');
  assert.deepEqual(reloaded.list('board-a')[0].filters.tags, ['learn']);
});
test('rename, duplicate validation, removal and concurrent saves preserve other combinations', async () => {
  const { store } = fixture();
  await Promise.all([store.save('a', 'Первый', {}, false), store.save('a', 'Второй', { query: 'q' }, true)]);
  const first = store.list('a')[0], second = store.list('a')[1];
  await assert.rejects(store.save('a', 'ПЕРВЫЙ', {}, false), /already exists/);
  await store.save('a', 'Новое название', first.filters, false, first.id);
  assert.equal(store.list('a')[0].id, first.id);
  await store.remove('wrong-board', first.id);
  assert.equal(store.list('a').length, 2);
  await store.remove('a', first.id);
  assert.equal(store.list('a')[0].id, second.id);
  await assert.rejects(store.save('a', 'Возврат', {}, false, first.id), /deleted/);
});
test('failed disk writes roll back state and the next save can recover', async () => {
  const { plugin, store } = fixture();
  await store.save('a', 'Оригинал', {}, false);
  const original = store.list('a')[0], persist = plugin.persist;
  plugin.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(store.remove('a', original.id), /disk full/);
  assert.equal(store.list('a')[0].id, original.id);
  await assert.rejects(store.save('a', 'Новая', {}, false), /disk full/);
  assert.equal(store.list('a').length, 1);
  plugin.persist = persist;
  await store.save('a', 'Новая', {}, false);
  assert.equal(store.list('a').length, 2);
});
test('project and folder renames update saved project paths while board identities stay stable', async () => {
  const { store } = fixture();
  await store.save('stable-board-id', 'Учёба', { project: 'Projects/growth' }, false);
  await store.renameProject('Projects', 'Planner/Projects');
  await store.renameProject('Planner/Projects/growth.md', 'Planner/Projects/learning.md');
  assert.equal(store.list('stable-board-id')[0].filters.project, 'Planner/Projects/learning');
});
