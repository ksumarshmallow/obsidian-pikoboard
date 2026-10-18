'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  C = require('../core');
function fixture() {
  class TFile {
    constructor() {
      this.path = 'Task.md';
    }
  }
  const base = class {};
  const notices = [],
    menus = [];
  class Menu {
    constructor() {
      this.items = [];
      menus.push(this);
    }
    addItem(fn) {
      const item = {
        setTitle(v) {
          this.title = v;
          return this;
        },
        setIcon() {
          return this;
        },
        onClick(fn) {
          this.click = fn;
          return this;
        },
      };
      fn(item);
      this.items.push(item);
    }
    addSeparator() {}
    showAtMouseEvent() {}
  }
  const element = () => ({ append() {}, set className(v) {}, set textContent(v) {} }),
    obs = {
      Plugin: base,
      PluginSettingTab: base,
      ItemView: base,
      FileView: base,
      Modal: base,
      FuzzySuggestModal: base,
      TFile,
      Menu,
      Notice: class {
        constructor(...args) {
          notices.push(args);
        }
        hide() {}
      },
    };
  let copied;
  const scope = {
    require: (n) => (n === 'obsidian' ? obs : require(n.replace('./', '../'))),
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    crypto: require('node:crypto').webcrypto,
    document: { createElement: element, createDocumentFragment: element },
    navigator: {
      clipboard: {
        writeText: async (s) => {
          copied = s;
        },
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(require('node:path').join(__dirname, '../plugin.js'), 'utf8') +
      '\nmodule.exports={PikoBoard};',
    scope,
  );
  const plugin = Object.create(scope.module.exports.PikoBoard.prototype),
    file = new TFile();
  let disk = 'Description';
  plugin.data = { drafts: {} };
  plugin.queues = new Map();
  plugin.noteCache = new Map();
  plugin.refresh = () => {};
  plugin.persist = async () => {};
  plugin.app = {
    vault: {
      read: async () => disk,
      process: async (f, fn) => {
        disk = fn(disk);
      },
      getAbstractFileByPath: () => file,
    },
  };
  return {
    plugin,
    file,
    notices,
    menus,
    get copied() {
      return copied;
    },
    get disk() {
      return disk;
    },
    set disk(v) {
      disk = v;
    },
  };
}
const first = { id: 'first', at: '2026-10-18T12:00:00Z', text: 'First [[Material]]' },
  second = { id: 'second', at: '2026-10-18T13:00:00Z', text: 'Second' };
test('deleting a message stores recovery before write, and recovery survives a plugin data reload', async () => {
  const f = fixture();
  f.disk = C.appendUpdate(C.appendUpdate('Description', first), second);
  let saved;
  f.plugin.persist = async () => {
    saved = JSON.parse(JSON.stringify(f.plugin.data));
  };
  const original = f.plugin.app.vault.process;
  f.plugin.app.vault.process = async (...args) => {
    assert.equal(saved.deletedUpdates[0].update.text, first.text);
    return original(...args);
  };
  await f.plugin.deleteMessage(f.file, first);
  assert.deepEqual(C.readNote(f.disk).updates, [second]);
  assert.equal(saved.deletedUpdates.length, 1);
  f.plugin.data = saved;
  await f.plugin.restoreDeletedMessage(saved.deletedUpdates[0]);
  assert.deepEqual(C.readNote(f.disk).updates, [second, first]);
  assert.equal(f.plugin.data.deletedUpdates.length, 0);
});
test('failed recovery-backup save leaves the message intact', async () => {
  const f = fixture();
  f.disk = C.appendUpdate('Description', first);
  f.plugin.persist = async () => {
    throw new Error('DISK_FULL');
  };
  const before = f.disk;
  await assert.rejects(f.plugin.deleteMessage(f.file, first), /DISK_FULL/);
  assert.equal(f.disk, before);
});
test('stale edits and deletion fail without overwriting a newer message', async () => {
  const f = fixture();
  f.disk = C.editUpdate(C.appendUpdate('Description', first), first.id, 'Fresh text');
  const before = f.disk;
  await assert.rejects(f.plugin.editMessage(f.file, first, 'Stale edit'), /UPDATE_CONFLICT/);
  await assert.rejects(f.plugin.deleteMessage(f.file, first), /UPDATE_CONFLICT/);
  assert.equal(f.disk, before);
});
test('visible message menu offers copy, edit, delete and undo completion; copy includes rendered text', async () => {
  const f = fixture(),
    items = f.plugin
      .messageActions(f.file, { ...first, kind: 'done' }, { innerText: 'First Material' })
      .filter((i) => !i.separator);
  assert.deepEqual(
    Array.from(items, (i) => i.label),
    ['Копировать', 'Изменить', 'Вернуть в следующий шаг', 'Удалить запись'],
  );
  assert.equal(items.at(-1).danger, true);
  await items[0].action();
  assert.equal(f.copied, 'First Material');
});
