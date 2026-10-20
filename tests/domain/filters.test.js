'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/domain/filters.js');
const task = { title: 'Изучить английский', path: 'Tasks/English.md', status: 'open',
  projects: ['[[Projects/growth]]'], visibleTags: ['языки', 'research'] };

test('search combines all words across title, project, tags and task content', () => {
  const note = { body: 'Сравнить преподавателей', nextAction: '- [ ] Пробное занятие',
    updates: [{ text: 'Нашёл хороший курс' }], tail: '[[Материалы]]' };
  for (const query of ['АНГЛИЙСКИЙ growth', 'нашел КУРС', 'пробное занятие', '#языки', 'Материалы', '  преподават  '])
    assert.equal(F.matchesTask(task, { query }, note), true, query);
  assert.equal(F.matchesTask(task, { query: 'английский стоматолог' }, note), false);
  assert.equal(F.matchesTask(task, { query: 'Преподаватели' }), false);
  assert.equal(F.matchesTask(task, { query: '[.*' }, note), false, 'input is plain text, not a regular expression');
});

test('projects, all selected tags and any selected statuses intersect with text', () => {
  const f = { project: 'Projects/growth', tags: ['research', 'языки'], statuses: ['open', 'in-progress'], query: 'английский' };
  assert.equal(F.matchesTask(task, f), true);
  assert.equal(F.matchesTask(task, { ...f, statuses: ['done'] }), false);
  assert.equal(F.matchesTask(task, { ...f, tags: ['health'] }), false);
  assert.equal(F.matchesTask(task, { ...f, project: '__none__' }), false);
  assert.equal(F.matchesTask({ ...task, status: 'review' }, { statuses: ['in-progress'] }, {}, 'in-progress'), true,
    'the overview filters by displayed column, including custom active statuses');
  assert.equal(F.matchesTask({ status: 'open', projects: [], visibleTags: [] },
    { project: '__none__', tags: ['__none__'] }), true);
});

test('filters normalize saved state without sharing mutable arrays', () => {
  const source = { project: 42, tags: ['a', 'a', null], statuses: 'done', query: null };
  assert.deepEqual(F.normalizeFilters(source), { project: '', tags: ['a'], statuses: [], query: '' });
  assert.equal(F.hasFilters({ query: '   ' }), false);
  assert.equal(F.hasFilters({ statuses: ['done'] }), true);
  assert.equal(F.sameFilters({ tags: ['a', 'b'], query: 'ЁЖ' }, { tags: ['b', 'a'], query: ' еж ' }), true);
  const clean = F.normalizeFilters(source);
  clean.tags.push('b');
  assert.deepEqual(source.tags, ['a', 'a', null]);
  assert.equal(F.renamedProject('Projects/growth', 'Projects', 'Planner/Projects'), 'Planner/Projects/growth');
  assert.equal(F.renamedProject('Projects/growth', 'Projects/growth.md', 'Projects/learning.md'), 'Projects/learning');
  assert.equal(F.renamedProject('Projects/growth-2', 'Projects/growth.md', 'Projects/learning.md'), 'Projects/growth-2');
});
