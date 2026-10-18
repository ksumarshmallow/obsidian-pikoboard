'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../core');
const S = require('../task-store');
test('the committed bundle fully starts with only the Obsidian API', async () => {
  const registrations = [];
  class Plugin {
    async loadData() {
      return {};
    }
    async saveData() {}
    registerView(type) {
      registrations.push(type);
    }
    addSettingTab() {
      registrations.push('settings');
    }
    addCommand(command) {
      registrations.push(command.id);
    }
    addRibbonIcon() {}
    registerEvent() {}
    register() {}
    registerInterval() {}
  }
  const base = class {};
  const obs = {
    Plugin,
    PluginSettingTab: base,
    Modal: base,
    ItemView: base,
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../main'), 'utf8'), scope);
  const plugin = new scope.module.exports();
  plugin.app = {
    vault: {
      configDir: '.obsidian',
      on() {},
      adapter: {
        async exists() {
          return false;
        },
      },
    },
    metadataCache: { on() {} },
    workspace: { onLayoutReady() {}, getLeavesOfType: () => [] },
  };
  Object.defineProperty(plugin.app, 'plugins', {
    get() {
      throw Error('No community plugins installed');
    },
  });
  await plugin.onload();
  assert.ok(registrations.includes('pikoboard-view'));
  assert.ok(registrations.includes('settings'));
  assert.ok(registrations.includes('create'));
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
    require: (name) => (name === 'obsidian' ? obs : name === './core' ? C : S),
    module: { exports: {} },
    console,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../plugin'), 'utf8'), scope);
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
