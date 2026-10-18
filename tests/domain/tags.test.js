'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/domain/tasks.js');
const system = ['task', 'archived'];
test('inline hashtag input cleans separators and supports nested multilingual tags', () => {
  assert.deepEqual(
    C.taskTags('  #ресерч, #demo/nested\n #sample-tag #мой_тег  ', ['task', 'old'], system),
    ['task', 'ресерч', 'demo/nested', 'sample-tag', 'мой_тег'],
  );
});
test('clearing visible tags preserves existing task and archived flags', () => {
  assert.deepEqual(C.taskTags('', ['task', 'archived', 'old'], system), ['task', 'archived']);
  assert.deepEqual(C.taskTags('#new', ['task', 'old'], system), ['task', 'new']);
});
test('typing protected tags cannot add archive or identification flags', () => {
  assert.deepEqual(C.taskTags('#ARCHIVED #task #visible', ['task'], system), ['task', 'visible']);
  assert.deepEqual(C.taskTags('#task #archived', [], system), []);
  assert.deepEqual(C.taskTags('#new', ['#Task', '#ARCHIVED'], system), ['Task', 'ARCHIVED', 'new']);
});
test('tags deduplicate case-insensitively after Unicode normalization', () => {
  assert.deepEqual(
    C.taskTags('#Ресерч #ресерч #EXAMPLE #example #cafe\u0301 #café', ['task'], system),
    ['task', 'Ресерч', 'EXAMPLE', 'café'],
  );
});
test('bare hashtag tokens are ignored and custom protected tags are supported', () => {
  assert.deepEqual(
    C.taskTags(
      ' # ## , #new ',
      ['todo/item', 'done/archive', 'old'],
      new Set(['todo/item', 'done/archive']),
    ),
    ['todo/item', 'done/archive', 'new'],
  );
});
test('invalid tags fail before a caller can persist a partial normalization', () => {
  for (const input of ['#123', '#bad!', '#bad//nested', '#bad/', '#/bad', '#one#two'])
    assert.throws(
      () => C.taskTags(input, ['task'], system),
      (error) => error.code === 'INVALID_TAG',
    );
  const existing = ['task', 'old'],
    input = ['#new', '#second'];
  C.taskTags(input, existing, system);
  assert.deepEqual(existing, ['task', 'old']);
  assert.deepEqual(input, ['#new', '#second']);
});
