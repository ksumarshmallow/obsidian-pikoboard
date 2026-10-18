'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core');
const source = fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8');
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(body = 'Old') {
  const doc = { activeElement: null },
    shown = [];
  class Component {
    load() {}
    unload() {}
  }
  class Modal {
    open() {
      shown.push(this);
    }
    close() {
      this.onClose?.();
    }
  }
  const obs = {
    Plugin: class {},
    ItemView: class {},
    Modal,
    FuzzySuggestModal: class {},
    Menu: class {},
    Notice: class {},
    TFile: class {},
    Component,
    MarkdownRenderer: { async render() {} },
    setIcon() {},
    normalizePath: (x) => x,
  };
  const scope = {
    require: (n) => (n === 'obsidian' ? obs : C),
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    document: doc,
    crypto: require('node:crypto').webcrypto,
  };
  vm.runInNewContext(source + '\nmodule.exports={PikoBoard,TaskModal};', scope);
  const { PikoBoard, TaskModal } = scope.module.exports;
  const plugin = Object.create(PikoBoard.prototype);
  plugin.data = { drafts: {} };
  plugin.dataSave = Promise.resolve();
  plugin.saveData = async () => {};
  plugin.modals = new Set();
  plugin.noteCache = new Map();
  const file = { path: 'Task.md', basename: 'Task' };
  const task = { title: 'Task', status: 'open', projects: [], tags: [] };
  let disk = body;
  plugin.api = () => ({ tasks: { get: async () => ({ ...task }) } });
  plugin.note = async () => ({ body: disk });
  plugin.history = async () => {};
  const m = Object.create(TaskModal.prototype);
  Object.assign(m, {
    plugin,
    file,
    task,
    closed: false,
    propertySave: Promise.resolve(),
    editor: { hidden: true, value: '', style: {}, scrollHeight: 20 },
    titleInput: { value: 'Task' },
    updateInput: { value: '', style: {}, scrollHeight: 20 },
    send: {},
    feed: {},
    previewEl: { contains: () => false },
    props: { contains: () => false, querySelectorAll: () => [] },
    renderComponent: new Component(),
    contentEl: { empty() {} },
    saved() {},
    fail(e) {
      this.lastError = e;
    },
    preview: async () => {},
    renderProps() {},
    closeCalendar() {},
  });
  m.session = new C.BodySession(body, async (expected, next) => {
    disk = C.replaceBody(disk, expected, next);
    return { body: disk };
  });
  plugin.modals.add(m);
  return { m, plugin, doc, task, shown, disk: () => disk };
}
test('draft survives modal close, and successful body save clears only body draft', async () => {
  const { m, plugin } = setup();
  m.session.set('New');
  m.updateInput.value = 'Unsent history';
  await m.saveDraft();
  assert.equal(plugin.draft(m.file.path).body, 'New');
  await m.flush();
  assert.equal(plugin.draft(m.file.path).body, undefined);
  assert.equal(plugin.draft(m.file.path).update, 'Unsent history');
  await m.close();
  assert.equal(plugin.draft(m.file.path).update, 'Unsent history');
});
test('postUpdate rejects duplicate submits and preserves text typed during posting', async () => {
  const { m, plugin } = setup();
  const gate = defer(),
    started = defer();
  let posts = 0;
  plugin.addUpdate = async () => {
    posts++;
    started.resolve();
    await gate.promise;
  };
  m.updateInput.value = 'First';
  const pending = m.postUpdate();
  await started.promise;
  const duplicate = m.postUpdate();
  assert.equal(duplicate, pending);
  assert.equal(posts, 1);
  m.updateInput.value = 'Next draft';
  gate.resolve();
  await pending;
  assert.equal(m.updateInput.value, 'Next draft');
  assert.equal(plugin.draft(m.file.path).update, 'Next draft');
});
test('plain description field preserves the complete body across repeated edits and blur', async () => {
  const { m, disk } = setup('Intro\n- [ ] Task\n\n[[Research]]');
  m.scheduleSave = () => {};
  m.editor.hidden = false;
  m.editor.value = 'Changed\nSecond paragraph\n- [ ] Task\n\n[[Research]]';
  m.inputBody();
  await m.finishEdit();
  assert.equal(disk(), m.editor.value);
  assert.equal(m.editor.hidden, false);
  m.editor.value = 'Revised\n- [x] Task\n\n[[Research]]';
  m.inputBody();
  await m.finishEdit();
  assert.equal(disk(), m.editor.value);
  assert.equal(m.editor.hidden, false);
});
test('external refresh cannot replace a focused plain description field', async () => {
  const { m, plugin, doc } = setup();
  m.editor.hidden = false;
  doc.activeElement = m.editor;
  plugin.note = async () => ({ body: 'External' });
  await m.syncExternal();
  assert.equal(m.session.value, 'Old');
});
test('trash waits for open task saves and uses recoverable vault trash', async () => {
  const { m, plugin } = setup();
  const gate = defer();
  let trashed = false;
  m.close = async () => {
    await gate.promise;
    return true;
  };
  plugin.queue = async (file, job) => job();
  plugin.app = {
    vault: {
      trash: async (file, system) => {
        assert.equal(file, m.file);
        assert.equal(system, false);
        trashed = true;
      },
    },
  };
  plugin.refresh = () => {};
  const deleting = plugin.trashTask(m.file);
  await tick();
  assert.equal(trashed, false);
  gate.resolve();
  await deleting;
  assert.equal(trashed, true);
});
test('closing waits for pending title mutation before dismissing', async () => {
  const { m, plugin } = setup();
  const gate = defer();
  m.titleInput.value = 'New title';
  plugin.patch = async (f, patch) => {
    await gate.promise;
    return { ...m.task, ...patch };
  };
  const closing = m.close();
  await tick();
  assert.equal(m.closed, false);
  gate.resolve();
  await closing;
  assert.equal(m.task.title, 'New title');
  assert.equal(m.closed, true);
});
test('external refresh must not replace a body saved after that refresh started', async () => {
  const { m, plugin } = setup();
  const gate = defer();
  plugin.note = () => gate.promise;
  const syncing = m.syncExternal();
  await tick();
  m.session.set('New local body');
  await m.flush();
  assert.equal(m.session.dirty, false);
  gate.resolve({ body: 'Old' });
  await syncing;
  assert.equal(m.session.value, 'New local body');
});
test('closing waits until in-flight history posting is settled', async () => {
  const { m, plugin } = setup();
  const gate = defer();
  plugin.addUpdate = () => gate.promise;
  m.updateInput.value = 'History entry';
  const posting = m.postUpdate();
  await tick();
  const closing = m.close();
  await tick();
  assert.equal(m.closed, false);
  gate.resolve();
  await posting;
  await closing;
  assert.equal(m.closed, true);
});
function prepareOpen(m) {
  m.modalEl = { addClass() {} };
  m.contentEl.addClass = () => {};
  m.build = (update) => {
    m.updateInput.value = update;
  };
}
test('reopening restores an unsent history draft after normal close', async () => {
  const a = setup();
  a.m.updateInput.value = 'Return to this later';
  await a.m.close();
  const b = setup();
  b.m.plugin = a.plugin;
  prepareOpen(b.m);
  await b.m.onOpen();
  assert.equal(b.m.updateInput.value, 'Return to this later');
  assert.equal(b.m.session.value, 'Old');
  assert.equal(b.m.session.dirty, false);
});
test('already-persisted body draft is reconciled on reopen without false conflict', async () => {
  const { m, plugin } = setup('Saved text\n\n');
  await plugin.setDraft(m.file.path, {
    body: 'Saved text',
    bodyBase: 'Old text',
    update: 'Unsent',
  });
  prepareOpen(m);
  await m.onOpen();
  assert.equal(m.session.dirty, false);
  assert.equal(m.session.baseline, 'Saved text\n\n');
  assert.equal(m.updateInput.value, 'Unsent');
  assert.equal(plugin.draft(m.file.path).body, undefined);
  assert.equal(m.lastError, undefined);
});
test('reopen retains a conflicting local body draft and its original baseline', async () => {
  const { m, plugin } = setup('External change');
  await plugin.setDraft(m.file.path, { body: 'My unsaved text', bodyBase: 'Original' });
  prepareOpen(m);
  await m.onOpen();
  assert.equal(m.session.value, 'My unsaved text');
  assert.equal(m.session.baseline, 'Original');
  assert.equal(m.session.dirty, true);
  assert.equal(m.lastError.message, 'BODY_CONFLICT');
});
test('external refresh rechecks keyboard focus acquired during its read', async () => {
  const { m, plugin, doc } = setup();
  const gate = defer();
  plugin.note = () => gate.promise;
  const focused = {};
  m.previewEl.contains = (element) => element === focused;
  let renders = 0;
  m.preview = async () => renders++;
  const syncing = m.syncExternal();
  await tick();
  doc.activeElement = focused;
  gate.resolve({ body: 'External' });
  await syncing;
  assert.equal(renders, 0);
  assert.equal(m.session.value, 'Old');
});
test('a failed body write retains both body and history drafts and leaves modal open', async () => {
  const { m, plugin } = setup();
  m.session.write = async () => {
    throw new Error('DISK_FAILURE');
  };
  m.session.set('Local draft');
  m.updateInput.value = 'History draft';
  assert.equal(await m.close(), false);
  assert.equal(m.closed, false);
  assert.equal(plugin.draft(m.file.path).body, 'Local draft');
  assert.equal(plugin.draft(m.file.path).update, 'History draft');
});
test('external refresh cannot overwrite a title while its rename is pending', async () => {
  const { m, plugin } = setup();
  const noteRead = defer(),
    rename = defer();
  plugin.note = () => noteRead.promise;
  plugin.patch = async (f, patch) => {
    await rename.promise;
    return { ...m.task, ...patch };
  };
  const syncing = m.syncExternal();
  await tick();
  m.titleInput.value = 'New title';
  const saving = m.commitTitle();
  await tick();
  noteRead.resolve({ body: 'Old' });
  await syncing;
  const observed = m.titleInput.value;
  rename.resolve();
  await saving;
  assert.equal(observed, 'New title');
  assert.equal(m.titleInput.value, 'New title');
  assert.equal(m.task.title, 'New title');
});
test('shutdown during a dispatched history write retains the draft until acknowledgement', async () => {
  const { m, plugin } = setup();
  const write = defer(),
    started = defer();
  plugin.addUpdate = async () => {
    started.resolve();
    await write.promise;
  };
  m.updateInput.value = 'In-flight history';
  const posting = m.postUpdate();
  await started.promise;
  m.shutdown();
  await tick();
  assert.equal(m.closed, true);
  assert.equal(plugin.draft(m.file.path).update, 'In-flight history');
  write.resolve();
  await posting;
  assert.equal(plugin.draft(m.file.path).update, undefined);
});

test('delete confirmation cancels without touching the task and only deletes after acceptance', async () => {
  const { m, plugin, shown } = setup();
  let deletes = 0;
  plugin.trashTask = async () => {
    deletes++;
    return true;
  };
  const cancelled = plugin.requestTrash(m.file);
  assert.equal(deletes, 0);
  const first = shown[0];
  first.contentEl = { empty() {} };
  first.close();
  assert.equal(await cancelled, false);
  assert.equal(deletes, 0);
  const accepted = plugin.requestTrash(m.file);
  assert.equal(deletes, 0);
  const second = shown[1];
  second.contentEl = { empty() {} };
  second.confirmed = true;
  second.close();
  assert.equal(await accepted, true);
  assert.equal(deletes, 1);
});
