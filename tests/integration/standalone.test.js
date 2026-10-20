'use strict';
const { createLoader } = require('../helpers/modules.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../../src/domain/tasks.js');
const S = require('../../src/storage/task-store.js');
test('the committed bundle fully starts with only the Obsidian API', async () => {
  const registrations = [];
  const extensions = [];
  const viewFactories = new Map();
  const commands = new Map();
  class Plugin {
    async loadData() {
      return {};
    }
    async saveData() {}
    registerView(type, create) {
      registrations.push(type);
      viewFactories.set(type, create);
    }
    registerExtensions(names, type) {
      extensions.push({ names: [...names], type });
    }
    addSettingTab() {
      registrations.push('settings');
    }
    addCommand(command) {
      registrations.push(command.id);
      commands.set(command.id, command);
    }
    addRibbonIcon() {}
    registerEvent() {}
    register() {}
    registerInterval() {}
  }
  const base = class {};
  class ItemView {}
  class FileView {}
  const obs = {
    Plugin,
    PluginSettingTab: base,
    Modal: base,
    ItemView,
    FileView,
    FuzzySuggestModal: base,
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
  };
  const scope = {
    require: (name) => {
      assert.equal(
        name,
        'obsidian',
        'the installed bundle must not require source files or other plugins',
      );
      return obs;
    },
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    window: { setInterval: () => 1 },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../main.js'), 'utf8'), scope);
  const plugin = new scope.module.exports();
  plugin.app = {
    vault: {
      configDir: '.obsidian',
      getFiles: () => [],
      getAbstractFileByPath: () => null,
      on() {},
      adapter: {
        async exists() {
          return false;
        },
      },
    },
    metadataCache: { on() {} },
    workspace: { onLayoutReady() {}, on() {}, getLeavesOfType: () => [] },
  };
  Object.defineProperty(plugin.app, 'plugins', {
    get() {
      throw Error('No community plugins installed');
    },
  });
  await plugin.onload();
  assert.ok(registrations.includes('pikoboard-view'));
  assert.ok(registrations.includes('pikoboard-file-view'));
  assert.deepEqual(extensions, [{ names: ['pikoboard'], type: 'pikoboard-file-view' }]);
  const overview = viewFactories.get('pikoboard-view')({});
  const namedBoard = viewFactories.get('pikoboard-file-view')({});
  assert.ok(overview instanceof ItemView, 'the all-tasks overview must open without any file');
  assert.equal(
    overview instanceof FileView,
    false,
    'Obsidian FileView cannot own a fileless overview',
  );
  assert.ok(
    namedBoard instanceof FileView,
    'named boards use Obsidian file loading and restoration',
  );
  assert.equal(overview.getViewType(), 'pikoboard-view');
  assert.equal(namedBoard.getViewType(), 'pikoboard-file-view');
  assert.equal(overview.getDisplayText(), 'Все задачи');
  namedBoard.file = { path: 'Work/Plan.pikoboard', basename: 'Plan' };
  assert.equal(namedBoard.getDisplayText(), 'Plan');
  const overviewLeaf = { view: overview },
    fileLeaf = { view: namedBoard };
  plugin.app.workspace.getLeavesOfType = (type) =>
    type === 'pikoboard-view' ? [overviewLeaf] : type === 'pikoboard-file-view' ? [fileLeaf] : [];
  assert.deepEqual([...plugin.boardLeaves()], [overviewLeaf, fileLeaf]);
  let revealed;
  plugin.app.workspace.revealLeaf = async (leaf) => {
    revealed = leaf;
  };
  plugin.app.workspace.getLeaf = () => {
    throw new Error('An existing board tab must be reused');
  };
  await plugin.openBoard(namedBoard.file);
  assert.equal(revealed, fileLeaf);
  await plugin.openBoard();
  assert.equal(revealed, overviewLeaf);
  namedBoard.boardConfig = { id: 'work', columns: [{ value: 'later', kind: 'todo' }] };
  let newTaskStatus;
  namedBoard.beginCreate = (status) => {
    newTaskStatus = status;
  };
  plugin.app.workspace.getActiveViewOfType = (Type) =>
    namedBoard instanceof Type ? namedBoard : null;
  await commands.get('create').callback();
  assert.equal(
    newTaskStatus,
    'later',
    'quick capture uses the active named board and its own columns',
  );
  namedBoard.boardConfig.columns.push({ value: 'review', kind: 'active' });
  namedBoard.mode = 'focus';
  await commands.get('create').callback();
  assert.equal(
    newTaskStatus,
    'review',
    'quick capture in focus creates an active task so it stays visible in that filter',
  );
  assert.ok(registrations.includes('settings'));
  assert.ok(registrations.includes('create'));
  assert.ok(registrations.includes('create-board'));
  assert.ok(registrations.includes('all-tasks'));
  assert.equal(plugin.api().catalog.statuses().length, 3);
  plugin.onunload();
});
function setup(data = {}, legacy) {
  const base = class {},
    notices = [],
    calls = [];
  const obs = {
    Plugin: base,
    PluginSettingTab: base,
    Modal: base,
    ItemView: base,
    FileView: base,
    FuzzySuggestModal: base,
    parseYaml: JSON.parse,
    stringifyYaml: JSON.stringify,
    Notice: class {
      constructor(text) {
        notices.push(text);
      }
    },
  };
  const scope = {
    require: (name) =>
      name === 'obsidian' ? obs : require(name),
    module: { exports: {} },
    console,
  };
  const load = createLoader(scope);
  scope.module.exports = load('plugin.js');
  const plugin = Object.create(scope.module.exports.prototype);
  plugin.data = data;
  plugin.dataSave = Promise.resolve();
  plugin.saveData = async () => {};
  plugin.app = {
    vault: {
      configDir: '.custom-config',
      adapter: {
        async exists(path) {
          calls.push(path);
          return legacy !== undefined;
        },
        async read() {
          return typeof legacy === 'string' ? legacy : JSON.stringify(legacy);
        },
      },
    },
  };
  // Any accidental dependency on the running TaskNotes plugin fails immediately.
  Object.defineProperty(plugin.app, 'plugins', {
    get() {
      throw Error('Community plugins are unavailable');
    },
  });
  return { plugin, notices, calls };
}
test('first launch works in a clean vault without TaskNotes or other community plugins', async () => {
  const { plugin, calls } = setup({
    drafts: { 'Example.md': { body: 'Keep draft' } },
    order: ['Example.md'],
  });
  await plugin.initializeStorage();
  assert.equal(plugin.settings.tasksFolder, 'Задачи');
  assert.equal(plugin.settings.appearance, 'obsidian');
  assert.equal(plugin.settings.autoArchive, true);
  assert.equal(plugin.settings.archiveDays, 7);
  assert.deepEqual([...plugin.systemTags()], ['task', 'archived']);
  assert.equal(plugin.data.drafts['Example.md'].body, 'Keep draft');
  assert.equal(plugin.data.order[0], 'Example.md');
  assert.deepEqual(calls, ['.custom-config/plugins/tasknotes/data.json']);
});
test('one-time migration copies only storage settings and archive deadlines, retaining drafts and order', async () => {
  const { plugin } = setup(
    { order: ['Example.md'], drafts: { 'Example.md': { update: 'Draft' } } },
    {
      tasksFolder: 'Inbox',
      taskTag: 'todo',
      apiToken: 'not imported',
      fieldMapping: { status: 'state', unrelated: 'ignored' },
      customStatuses: [
        { value: 'done', isCompleted: true, autoArchive: true, autoArchiveDelay: 10080 },
      ],
      autoArchiveQueue: [{ taskPath: 'Example.md', archiveAfterTimestamp: 1768000000000 }],
    },
  );
  await plugin.initializeStorage();
  assert.equal(plugin.settings.tasksFolder, 'Inbox');
  assert.equal(plugin.settings.fieldMapping.status, 'state');
  assert.equal(plugin.settings.apiToken, undefined);
  assert.equal(plugin.settings.fieldMapping.unrelated, undefined);
  assert.equal(plugin.data.archiveSchedule['Example.md'].after, 1768000000000);
  assert.equal(plugin.data.drafts['Example.md'].update, 'Draft');
});
test('subsequent launches do not read TaskNotes settings again', async () => {
  const { plugin, calls } = setup(
    { settings: S.settingsFrom({ tasksFolder: 'My tasks' }) },
    { tasksFolder: 'Old folder' },
  );
  await plugin.initializeStorage();
  assert.deepEqual(calls, []);
  assert.equal(plugin.settings.tasksFolder, 'My tasks');
});
test('an unreadable legacy config reports the fallback without preventing standalone startup', async () => {
  const { plugin, notices } = setup({}, '{broken');
  await plugin.initializeStorage();
  assert.equal(notices.length, 1);
  assert.equal(plugin.settings.tasksFolder, 'Задачи');
});

test('an existing installation without an appearance inherits Obsidian and preserves an explicit preset', async () => {
  const { plugin } = setup({ settings: { tasksFolder: 'My tasks' } });
  const saved = [];
  plugin.saveData = async (data) => saved.push(data);
  await plugin.initializeStorage();
  assert.equal(plugin.settings.appearance, 'obsidian');
  assert.equal(saved.length, 0, 'the default does not force a preference write');
  assert.equal(plugin.settings.tasksFolder, 'My tasks');
  plugin.refresh = () => { throw Error('A palette change must not recreate active editors'); };
  const applied = [];
  plugin.appearance = { apply: () => applied.push(plugin.settings.appearance) };
  await plugin.saveSettings({ appearance: 'piko-light' });
  assert.deepEqual(applied, ['piko-light']);
  assert.equal(saved.at(-1).settings.appearance, 'piko-light');
  await plugin.initializeStorage();
  assert.equal(plugin.settings.appearance, 'piko-light', 'explicit preference survives restart');
});

test('failed preference writes retain the active appearance and allow a later retry', async () => {
  const { plugin } = setup({ settings: S.settingsFrom({ appearance: 'piko' }) });
  await plugin.initializeStorage();
  plugin.refresh = () => { throw Error('Unexpected refresh'); };
  let applied = 0;
  plugin.appearance = { apply: () => applied++ };
  plugin.saveData = async () => { throw Error('Disk full'); };
  await assert.rejects(plugin.saveSettings({ appearance: 'obsidian' }), /Disk full/);
  assert.equal(plugin.settings.appearance, 'piko');
  assert.equal(plugin.data.settings.appearance, 'piko');
  assert.equal(applied, 0);
  plugin.saveData = async () => {};
  await plugin.saveSettings({ appearance: 'obsidian' });
  assert.equal(applied, 1);
  let refreshed = 0;
  plugin.refresh = () => refreshed++;
  await plugin.saveSettings({ tasksFolder: 'Tasks' });
  assert.equal(refreshed, 1, 'changes affecting task queries still refresh the board');
});

test('overlapping appearance and folder writes retain both preferences', async () => {
  const { plugin } = setup({ settings: S.settingsFrom({ appearance: 'piko' }) });
  await plugin.initializeStorage();
  plugin.refresh = () => {};
  const saved = [];
  plugin.saveData = async (data) => saved.push(data);
  await Promise.all([
    plugin.saveSettings({ appearance: 'obsidian' }),
    plugin.saveSettings({ tasksFolder: 'Tasks' }),
  ]);
  assert.equal(plugin.settings.appearance, 'obsidian');
  assert.equal(plugin.settings.tasksFolder, 'Tasks');
  assert.equal(saved.at(-1).settings.appearance, 'obsidian');
  assert.equal(saved.at(-1).settings.tasksFolder, 'Tasks');
});
