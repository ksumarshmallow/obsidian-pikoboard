'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskTemplates, templateContent } = require('../../src/storage/task-templates.js');
const { TaskStore, settingsFrom } = require('../../src/storage/task-store.js');
const C = require('../../src/domain/tasks.js');
const yaml = (data, body = '') => '---\n' + JSON.stringify(data) + '\n---\n' + body;

function fixture() {
  const disk = new Map();
  const file = (path) => ({ path, basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const plugin = {
    settings: settingsFrom(),
    store: { systemTags: () => ['task', 'archived'] },
    app: { vault: {
      getMarkdownFiles: () => [...disk.keys()].map(file),
      read: async (f) => { if (!disk.has(f.path)) throw new Error('File missing'); return disk.get(f.path); },
    } },
    async uniqueNote(folder, name, content) {
      let path = `${folder}/${name}.md`, n = 2;
      while (disk.has(path)) path = `${folder}/${name} ${n++}.md`;
      disk.set(path, content);
      return file(path);
    },
  };
  return { disk, file, plugin, store: new TaskTemplates(plugin, JSON.parse, JSON.stringify) };
}

test('template snapshot copies reusable content, resets checklists and drops task identity and history', () => {
  let source = yaml({ title: 'Private title', status: 'done', due: '2026-10-22', board: 'b', projects: ['[[P]]'], tags: ['task', 'ARCHIVED', 'research', 'Research'] }, '## Research\n- [x] Compare\n```md\n- [x] Example\n```\n![[Attachments/file.pdf]]');
  source = C.setNextAction(source, '', '- [x] Review\n- [ ] Decide');
  source = C.appendUpdate(source, { id: 'message', at: '2026-10-20T10:00:00Z', text: 'Private history' });
  source += '\nTail material';
  const result = templateContent(source, JSON.parse, ['task', 'archived']);
  assert.deepEqual(result.tags, ['research']);
  assert.match(result.details, /- \[ \] Compare/);
  assert.match(result.details, /```md\n- \[x\] Example/);
  assert.match(result.details, /!\[\[Attachments\/file.pdf\]\]/);
  assert.match(result.details, /Tail material/);
  const note = C.readNote(result.details);
  assert.equal(note.nextAction, '- [ ] Review\n- [ ] Decide');
  assert.equal(note.updates.length, 0);
  assert.doesNotMatch(result.details, /Private|2026|ARCHIVED|status|projects/);
});

test('malformed history is rejected instead of becoming part of a template', () => {
  assert.throws(() => templateContent(yaml({}, 'Body\n<!-- pikoboard:updates:start -->\nBroken'), JSON.parse), /HISTORY_FORMAT/);
});

test('templates are stored as separate editable notes and listed only from the configured folder', async () => {
  const f = fixture();
  f.disk.set('Task.md', yaml({ tags: ['task', 'research'] }, '- [x] Compare'));
  const saved = await f.store.save('Research', f.file('Task.md'));
  f.disk.set('Other/Outside.md', yaml({ 'pikoboard-template': true }));
  f.disk.set('Templates/PikoBoard/Regular note.md', 'Ordinary note');
  f.disk.set('Templates/PikoBoard/Broken.md', '---\n{broken\n---\n');
  assert.deepEqual((await f.store.list()).map((x) => x.file.path), ['Templates/PikoBoard/Research.md']);
  assert.equal(f.disk.get('Task.md'), yaml({ tags: ['task', 'research'] }, '- [x] Compare'));
  assert.deepEqual(await f.store.read(saved), { tags: ['research'], details: '- [ ] Compare' });
  // Changes made in Obsidian apply to the next task, not an old cached snapshot.
  f.disk.set(saved.path, yaml({ 'pikoboard-template': true, tags: ['fresh'] }, 'Edited content'));
  assert.deepEqual(await f.store.read(saved), { tags: ['fresh'], details: 'Edited content' });
  const copies = await Promise.all([f.store.save('Research'), f.store.save('Research')]);
  assert.equal(new Set(copies.map((x) => x.path)).size, 2);
});

test('missing or unmarked templates fail before task creation; root folder does not include ordinary notes', async () => {
  const f = fixture();
  f.plugin.settings.templatesFolder = '';
  f.disk.set('Ordinary.md', yaml({ tags: ['task'] }, 'Task'));
  f.disk.set('Template.md', yaml({ 'pikoboard-template': true }, 'Template'));
  assert.equal((await f.store.list()).length, 1);
  await assert.rejects(f.store.read(f.file('Ordinary.md')), /template/);
  await assert.rejects(f.store.read(f.file('Missing.md')), /missing/);
});

test('templates cannot be recognized as tasks even with a copied system tag or property', () => {
  for (const settings of [{}, { taskIdentificationMethod: 'property', taskPropertyName: 'type', taskPropertyValue: 'task' }]) {
    const store = new TaskStore({ app: {}, settings: () => settingsFrom(settings) });
    assert.equal(store.isTask({ 'pikoboard-template': true, type: 'task', tags: ['task'] }), false);
  }
  assert.throws(() => settingsFrom({ templatesFolder: '../outside' }));
});
