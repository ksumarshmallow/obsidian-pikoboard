'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/domain/tasks.js');
test('moving downward and upward has no off-by-one and survives saved-order reload', () => {
  let order = C.moveTaskOrder(['a', 'b', 'c'], 'a', 'c', true);
  assert.deepEqual(order, ['b', 'c', 'a']);
  order = C.moveTaskOrder(order, 'a', 'b');
  assert.deepEqual(order, ['a', 'b', 'c']);
  const tasks = ['c', 'b', 'a'].map((path) => ({ path }));
  assert.deepEqual(
    C.orderedTasks(tasks, JSON.parse(JSON.stringify(order))).map((t) => t.path),
    order,
  );
});
test('filtered reordering preserves hidden tasks and new task goes first', () => {
  const order = C.moveTaskOrder(['a', 'hidden', 'b', 'other-column'], 'b', 'a');
  assert.deepEqual(order, ['b', 'a', 'hidden', 'other-column']);
  assert.deepEqual(C.moveTaskOrder(order, 'new'), ['new', 'b', 'a', 'hidden', 'other-column']);
});
test('moving between columns retains relative order of every other card', () => {
  const tasks = [
    { path: 'a', status: 'open' },
    { path: 'b', status: 'done' },
    { path: 'c', status: 'done' },
  ];
  tasks[0].status = 'done';
  const order = C.moveTaskOrder(
    tasks.map((t) => t.path),
    'a',
    'c',
  );
  assert.deepEqual(
    C.orderedTasks(tasks, order)
      .filter((t) => t.status === 'done')
      .map((t) => t.path),
    ['b', 'a', 'c'],
  );
});
test('self-drop is a no-op and stale saved paths do not hide tasks', () => {
  assert.deepEqual(C.moveTaskOrder(['a', 'b'], 'a', 'a', true), ['a', 'b']);
  assert.deepEqual(
    C.orderedTasks([{ path: 'a' }, { path: 'new' }, { path: 'b' }], ['missing', 'b', 'a']).map(
      (t) => t.path,
    ),
    ['b', 'a', 'new'],
  );
});
