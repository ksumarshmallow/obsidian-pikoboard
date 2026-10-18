'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TaskStore,
  settingsFrom,
  migrateSettings,
  folderPath,
  splitDocument,
} = require('../task-store');
const C = require('../core');

// JSON objects are valid YAML. Obsidian supplies the production YAML codec;
// this fixture exercises storage/atomicity without shipping another YAML library.
const encode = (data, body = '\n') => '---\n' + JSON.stringify(data) + '\n---\n' + body;
function fixture(options = {}) {
  const files = new Map(),
    directories = new Map(),
    disk = new Map(),
    locks = new Map();
  let clock = new Date('2026-01-10T12:00:00Z'),
    config = settingsFrom(options.settings);
  const add = (path, data, body) => {
    const file = { path, basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' };
    files.set(path, file);
    disk.set(path, encode(data, body));
    return file;
  };
  const vault = {
    getMarkdownFiles: () => [...files.values()],
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
    async create(path, source) {
      if (files.has(path)) throw Error('Already exists');
      const file = add(path, {});
      disk.set(path, source);
      return file;
    },
    async process(file, change) {
      const work = (locks.get(file.path) || Promise.resolve())
        .catch(() => {})
        .then(() => {
          if (vault.beforeProcess) {
            const hook = vault.beforeProcess;
            vault.beforeProcess = null;
            hook(file);
          }
          const next = change(disk.get(file.path));
          disk.set(file.path, next);
        });
      locks.set(file.path, work);
      return work;
    },
  };
  let saved = 0;
  const store = new TaskStore({
    app: { vault },
    settings: () => config,
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
    now: () => clock,
    archiveSchedule: options.archiveSchedule || {},
    onScheduleChange: async () => saved++,
  });
  return {
    store,
    vault,
    disk,
    add,
    saved: () => saved,
    at: (value) => {
      clock = new Date(value);
    },
    configure: (patch) => {
      config = settingsFrom({ ...config, ...patch });
    },
    data: (path) => splitDocument(disk.get(path), JSON.parse).data,
  };
}
test('standalone store creates tasks with no plugin manager, default empty project and due', async () => {
  const f = fixture();
  const task = await f.store.tasks.create({ title: 'New task', status: 'open' });
  assert.equal(task.path, 'Задачи/New task.md');
  assert.deepEqual(task.projects, []);
  assert.equal(task.due, undefined);
  assert.deepEqual(task.tags, ['task']);
  assert.equal((await f.store.tasks.list()).length, 1);
});
test('fresh tasks create the configured nested folder and safe unique names concurrently', async () => {
  const f = fixture({ settings: { tasksFolder: 'Projects/Inbox' } });
  const [a, b] = await Promise.all(
    [1, 2].map(() => f.store.tasks.create({ title: 'A/B', status: 'open' })),
  );
  assert.equal(a.path, 'Projects/Inbox/A B.md');
  assert.equal(b.path, 'Projects/Inbox/A B 2.md');
  assert.equal(a.title, 'A/B');
  assert.ok(f.vault.getAbstractFileByPath('Projects/Inbox'));
});
test('new task in done records a completion timestamp; optional project and due are retained', async () => {
  const f = fixture();
  const task = await f.store.tasks.create({
    title: 'Example',
    status: 'done',
    projects: ['[[Project]]'],
    due: '2026-01-20',
  });
  assert.equal(task.completedDate, '2026-01-10T12:00:00.000Z');
  assert.deepEqual(task.projects, ['[[Project]]']);
  assert.equal(task.due, '2026-01-20');
});
test('legacy task identification works outside the task folder; projects and ordinary notes are excluded', async () => {
  const f = fixture();
  f.add('Project/Legacy.md', {
    tags: ['task', 'research'],
    status: 'in-progress',
    projects: '[[Project]]',
  });
  f.add('Projects/Project.md', { type: 'project' });
  f.add('Задачи/Ordinary note.md', {});
  const tasks = await f.store.tasks.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Legacy');
  assert.deepEqual(tasks[0].projects, ['[[Project]]']);
});
test('frontmatter changes preserve unknown metadata and the complete description, history, next step and attachments', async () => {
  const f = fixture();
  const file = f.add(
    'Task.md',
    { tags: ['task'], custom: { keep: [1, 'two'] }, status: 'open' },
    '\n## Body\n![[Files/example.png]]\n',
  );
  let source = C.setNextAction(f.disk.get(file.path), '', '- [ ] Compare [[Research]]');
  source = C.appendUpdate(source, {
    id: 'sample',
    at: '2026-01-09T10:00:00Z',
    text: 'Read **this**\n[[Material]]',
  });
  f.disk.set(file.path, source);
  const body = splitDocument(source, JSON.parse).body;
  await f.store.tasks.update(file.path, {
    status: 'in-progress',
    title: 'Changed',
    due: '2026-01-15',
  });
  assert.equal(splitDocument(f.disk.get(file.path), JSON.parse).body, body);
  assert.deepEqual(f.data(file.path).custom, { keep: [1, 'two'] });
  assert.equal((await f.store.tasks.get(file.path)).title, 'Changed');
});
test('atomic patches preserve a concurrent body edit and independent property writes', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task'] }, 'Old');
  f.vault.beforeProcess = () =>
    f.disk.set('Task.md', encode({ tags: ['task'], custom: 'external' }, 'Newest body'));
  await Promise.all([
    f.store.tasks.update('Task.md', { due: '2026-01-18' }),
    f.store.tasks.update('Task.md', { projects: ['[[Project]]'] }),
  ]);
  assert.equal(splitDocument(f.disk.get('Task.md'), JSON.parse).body, 'Newest body');
  assert.equal(f.data('Task.md').custom, 'external');
  assert.equal(f.data('Task.md').due, '2026-01-18');
  assert.deepEqual(f.data('Task.md').projects, ['[[Project]]']);
});
test('clearing dates/projects and changing visible tags preserve identification and archive tags', async () => {
  const f = fixture();
  f.add('Task.md', {
    tags: ['task', 'archived', 'old'],
    due: '2026-01-12',
    projects: ['[[Project]]'],
  });
  await f.store.tasks.clearDue('Task.md');
  await f.store.tasks.update('Task.md', { projects: [], tags: ['new'] });
  assert.equal(f.data('Task.md').due, undefined);
  assert.equal(f.data('Task.md').projects, undefined);
  assert.deepEqual(f.data('Task.md').tags, ['task', 'archived', 'new']);
});
test('regular tag editing cannot archive a task or remove its task identity', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task'] });
  const task = await f.store.tasks.update('Task.md', { tags: ['archived', 'visible'] });
  assert.deepEqual(task.tags, ['task', 'visible']);
  assert.equal(task.archived, false);
});
test('completion clock is not reset by editing details; reopening removes it and recompletion resets it', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task'], status: 'open' });
  await f.store.tasks.update('Task.md', { status: 'done' });
  f.at('2026-01-11T12:00:00Z');
  await f.store.tasks.update('Task.md', { title: 'Still done', status: 'done' });
  assert.equal(f.data('Task.md').completedDate, '2026-01-10T12:00:00.000Z');
  await f.store.tasks.update('Task.md', { status: 'open' });
  assert.equal(f.data('Task.md').completedDate, undefined);
  await f.store.tasks.update('Task.md', { status: 'done' });
  assert.equal(f.data('Task.md').completedDate, '2026-01-11T12:00:00.000Z');
});
test('autoarchive applies only after seven full days and preserves files', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task'], status: 'done', completedDate: '2026-01-03T12:00:00.001Z' });
  assert.equal(await f.store.archiveExpired(), 0);
  f.at('2026-01-10T12:00:00.001Z');
  assert.equal(await f.store.archiveExpired(), 1);
  assert.ok(f.disk.has('Task.md'));
  assert.equal((await f.store.tasks.get('Task.md')).archived, true);
  assert.equal(await f.store.archiveExpired(), 0);
});
test('unfinished, undated, malformed completion dates and disabled autoarchive are not archived', async () => {
  const f = fixture();
  f.add('Open.md', { tags: ['task'], status: 'open', completedDate: '2000-01-01' });
  f.add('No date.md', { tags: ['task'], status: 'done' });
  f.add('Invalid date.md', { tags: ['task'], status: 'done', completedDate: 'wrong' });
  assert.equal(await f.store.archiveExpired(), 0);
  f.add('Old.md', { tags: ['task'], status: 'done', completedDate: '2000-01-01' });
  f.configure({ autoArchive: false });
  assert.equal(await f.store.archiveExpired(), 0);
});
test('restoring an archived done task grants a fresh grace period', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task', 'archived'], status: 'done', completedDate: '2000-01-01' });
  await f.store.tasks.archive('Task.md', false);
  assert.equal(await f.store.archiveExpired(), 0);
  assert.equal((await f.store.tasks.get('Task.md')).archived, false);
});
test('archive rechecks the current status inside the atomic write', async () => {
  const f = fixture();
  f.add('Task.md', { tags: ['task'], status: 'done', completedDate: '2000-01-01' });
  f.vault.beforeProcess = () =>
    f.disk.set('Task.md', encode({ tags: ['task'], status: 'in-progress' }));
  assert.equal(await f.store.archiveExpired(), 0);
  assert.equal((await f.store.tasks.get('Task.md')).status, 'in-progress');
});
test('legacy archive deadline is retained until a task is reopened', async () => {
  const deadline = Date.parse('2026-01-11T10:00:00Z');
  const f = fixture({ archiveSchedule: { 'Task.md': { after: deadline } } });
  f.add('Task.md', { tags: ['task'], status: 'done', completedDate: '2026-01-03' });
  assert.equal(await f.store.archiveExpired(), 0);
  await f.store.tasks.update('Task.md', { status: 'open' });
  assert.equal(f.saved(), 1);
  assert.equal(f.store.archiveSchedule['Task.md'], undefined);
  await f.store.tasks.update('Task.md', { status: 'done' });
  f.at('2026-01-11T11:00:00Z');
  assert.equal(await f.store.archiveExpired(), 0);
});
test('corrupt YAML is not overwritten and does not hide healthy tasks', async () => {
  const f = fixture();
  f.add('Good.md', { tags: ['task'] });
  const bad = f.add('Bad.md', {});
  f.disk.set(bad.path, '---\ninvalid {\n---\nKeep this');
  const before = f.disk.get(bad.path);
  assert.equal((await f.store.tasks.list()).length, 1);
  assert.equal(f.store.errors.length, 1);
  await assert.rejects(f.store.tasks.update(bad.path, { status: 'done' }));
  assert.equal(f.disk.get(bad.path), before);
});
test('non-task notes and missing files cannot be accidentally updated', async () => {
  const f = fixture();
  f.add('Note.md', { title: 'Ordinary note' });
  const before = f.disk.get('Note.md');
  assert.equal(await f.store.tasks.get('Missing.md'), null);
  await assert.rejects(f.store.tasks.update('Note.md', { status: 'done' }), /не найдена/);
  await assert.rejects(f.store.tasks.update('Missing.md', { title: 'Oops' }), /не найдена/);
  assert.equal(f.disk.get('Note.md'), before);
});
test('property-based task identity and custom fields are migrated without needing TaskNotes at runtime', async () => {
  const settings = migrateSettings({
    tasksFolder: 'Inbox',
    taskIdentificationMethod: 'property',
    taskPropertyName: 'kind',
    taskPropertyValue: 'action',
    fieldMapping: { title: 'name', status: 'state', archiveTag: 'archive' },
    customStatuses: [
      { value: 'finished', isCompleted: true, autoArchive: true, autoArchiveDelay: 10080 },
    ],
    privateToken: 'never copied',
  });
  assert.equal(settings.privateToken, undefined);
  assert.equal(settings.archiveDays, 7);
  const f = fixture({ settings });
  f.add('Legacy.md', { kind: 'action', name: 'Legacy', state: 'finished', tags: ['archive'] });
  assert.equal((await f.store.tasks.get('Legacy.md')).status, 'done');
  assert.equal((await f.store.tasks.get('Legacy.md')).archived, true);
  const task = await f.store.tasks.create({ title: 'New', status: 'open' });
  assert.equal(f.data(task.path).kind, 'action');
  assert.equal(f.data(task.path).name, 'New');
});
test('task folder rejects traversal, absolute paths and hidden configuration directories', () => {
  for (const path of ['../Outside', '/tmp', '.obsidian/plugins', 'Tasks/../Other', 'A//B'])
    assert.throws(() => folderPath(path));
  assert.equal(folderPath('Tasks/Research/'), 'Tasks/Research');
  assert.equal(folderPath(''), '');
});
test('invalid title and status are rejected before writing a file', async () => {
  const f = fixture();
  await assert.rejects(f.store.tasks.create({ title: '', status: 'open' }));
  await assert.rejects(f.store.tasks.create({ title: 'Example', status: 'invalid' }));
  assert.equal(f.disk.size, 0);
});
