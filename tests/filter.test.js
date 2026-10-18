'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core');
function fixture() {
  const source = fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8');
  const base = class {};
  const obs = {
    Plugin: base,
    PluginSettingTab: base,
    ItemView: base,
    Modal: base,
    FuzzySuggestModal: base,
  };
  const scope = { require: (n) => (n === 'obsidian' ? obs : C), module: { exports: {} }, console };
  vm.runInNewContext(source, scope);
  const plugin = Object.create(scope.module.exports.prototype);
  const project = { path: 'Проекты/Демо-проект/Демо-проект.md', basename: 'Демо-проект' };
  const raw = [
    {
      path: 'Проекты/Демо-проект/Проверить вариант.md',
      projects: ['[[Демо-проект]]'],
      tags: ['task', 'ресерч'],
    },
    { path: 'Задачи/что-то.md', projects: [], tags: ['task'] },
    { path: 'Задачи/задача 1.md', tags: ['task'] },
    { path: 'Задачи/Пример.md', projects: [], tags: ['task', 'быт'] },
  ];
  plugin.api = () => ({ tasks: { list: async () => raw } });
  plugin.systemTags = () => ['task', 'archived'];
  plugin.app = {
    vault: { getMarkdownFiles: () => [project] },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { type: 'project' } }),
      getFirstLinkpathDest: (target, sourcePath) => {
        assert.ok(sourcePath);
        return ['Демо-проект', 'Проекты/Демо-проект/Демо-проект'].includes(target) ? project : null;
      },
    },
  };
  return { plugin, raw };
}
test('project picker canonical path matches a task stored with a short wikilink', async () => {
  const { plugin } = fixture();
  const selected = plugin.projects()[0].value;
  assert.equal(selected, 'Проекты/Демо-проект/Демо-проект');
  const tasks = await plugin.tasks(),
    matched = tasks.filter((t) => C.taskMatches(t, { project: selected, tags: [] }));
  assert.equal(matched.length, 1);
  assert.equal(matched[0].path, 'Проекты/Демо-проект/Проверить вариант.md');
  assert.deepEqual([...matched[0].projects], ['[[Проекты/Демо-проект/Демо-проект]]']);
});
test('unassigned project handles both missing and empty project fields', async () => {
  const { plugin } = fixture();
  const tasks = await plugin.tasks();
  assert.equal(tasks.filter((t) => C.taskMatches(t, { project: '__none__', tags: [] })).length, 3);
  assert.equal(tasks.filter((t) => C.taskMatches(t, { project: '', tags: [] })).length, 4);
});
test('project and tags combine after system tags are removed', async () => {
  const { plugin } = fixture();
  const tasks = await plugin.tasks(),
    project = plugin.projects()[0].value;
  assert.equal(tasks.filter((t) => C.taskMatches(t, { project, tags: ['ресерч'] })).length, 1);
  assert.equal(tasks.filter((t) => C.taskMatches(t, { project, tags: ['быт'] })).length, 0);
  assert.equal(
    tasks.filter((t) => C.taskMatches(t, { project: '__none__', tags: ['__none__'] })).length,
    2,
  );
  assert.equal(
    tasks.some((t) => t.visibleTags.includes('task')),
    false,
  );
});
