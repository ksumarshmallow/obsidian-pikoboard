'use strict';
const { createLoader } = require('../helpers/modules.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/domain/tasks.js');

const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function setup(next = '') {
  const obs = {
    Plugin: class {},
    PluginSettingTab: class {},
    ItemView: class {},
    FileView: class {},
    Modal: class {},
    FuzzySuggestModal: class {},
    Notice: class {},
  };
  const scope = {
    require: (n) => (n === 'obsidian' ? obs : require(n)),
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    document: {
      createElement: () => ({ append() {} }),
      createDocumentFragment: () => ({ append() {} }),
    },
    crypto: require('node:crypto').webcrypto,
  };
  const load = createLoader(scope);
  scope.module.exports = { PikoBoard: load('plugin.js'), ...load('features/journal/model.js'), ...load('features/journal/composer.js') };
  const { PikoBoard, JournalModel, JournalComposer } = scope.module.exports;
  const plugin = Object.create(PikoBoard.prototype),
    file = { path: 'Task.md', basename: 'Task' };
  plugin.data = { drafts: {} };
  plugin.dataSave = Promise.resolve();
  plugin.journals = new Map();
  plugin.saveData = async () => {};
  let disk = next ? C.setNextAction('Description', '', next) : 'Description';
  plugin.note = async () => C.readNote(disk);
  plugin.refresh = () => {};
  plugin.addUpdate = async (f, text, id) => {
    disk = C.appendUpdate(disk, { id, text, at: new Date().toISOString() });
  };
  plugin.setNext = async (f, expected, text) => {
    disk = C.setNextAction(disk, expected, text);
  };
  plugin.toggleNextCheck = async (f, expected, line, checked) => {
    disk = C.setNextChecklistItem(disk, expected, line, checked);
    return C.readNote(disk).nextAction;
  };
  plugin.completeNext = async (f, expected, entry) => {
    disk = C.completeNextAction(disk, expected, entry);
  };
  return {
    plugin,
    file,
    JournalModel,
    JournalComposer,
    model: plugin.journal(file),
    note: () => C.readNote(disk),
    replace: (text) => {
      disk = text;
    },
  };
}
test('board and modal share one journal draft and subscribers receive edits immediately', async () => {
  const { plugin, file, model } = setup();
  const a = [],
    b = [];
  const offA = model.subscribe(() => a.push(model.update));
  const offB = plugin.journal(file).subscribe(() => b.push(model.update));
  model.setText('note', 'Board draft');
  model.setText('note', 'Modal draft');
  await model.save();
  assert.equal(plugin.journal(file), model);
  assert.equal(a.at(-1), 'Modal draft');
  assert.equal(b.at(-1), 'Modal draft');
  assert.equal(plugin.draft(file.path).update, 'Modal draft');
  offA();
  offB();
  assert.equal(model.listeners.size, 0);
});
test('comment submission blocks duplicates and retains text typed while saving', async () => {
  const { plugin, model, note, file } = setup(),
    started = defer(),
    gate = defer();
  let posts = 0;
  const add = plugin.addUpdate;
  plugin.addUpdate = async (...args) => {
    posts++;
    started.resolve();
    await gate.promise;
    await add(...args);
  };
  model.setText('note', 'Sent message');
  const posting = model.submit('note');
  await started.promise;
  await model.submit('note');
  assert.equal(posts, 1);
  model.setText('note', 'Next unsent message');
  gate.resolve();
  await posting;
  assert.equal(note().updates.length, 1);
  assert.equal(note().updates[0].text, 'Sent message');
  assert.equal(model.update, 'Next unsent message');
  assert.equal(plugin.draft(file.path).update, 'Next unsent message');
});
test('retry after an uncertain comment write reuses its ID and never duplicates history', async () => {
  const { plugin, model, note, file } = setup();
  const add = plugin.addUpdate;
  let attempts = 0;
  const ids = [];
  plugin.addUpdate = async (f, text, id) => {
    ids.push(id);
    await add(f, text, id);
    if (++attempts === 1) throw new Error('ACK_LOST');
  };
  model.setText('note', 'One message');
  await model.submit('note');
  assert.equal(model.update, 'One message');
  assert.equal(plugin.draft(file.path).updateId, ids[0]);
  assert.equal(note().updates.length, 1);
  await model.submit('note');
  assert.equal(ids[0], ids[1]);
  assert.equal(note().updates.length, 1);
  assert.equal(model.update, '');
  assert.equal(plugin.draft(file.path).updateId, undefined);
});
test('uncertain comment write remains idempotent after a model restart', async () => {
  const { plugin, model, note, file, JournalModel } = setup();
  const add = plugin.addUpdate;
  plugin.addUpdate = async (...args) => {
    await add(...args);
    throw new Error('ACK_LOST');
  };
  model.setText('note', 'Survive restart');
  await model.submit('note');
  const id = plugin.draft(file.path).updateId;
  plugin.addUpdate = add;
  const reopened = new JournalModel(plugin, file);
  assert.equal(reopened.retry.id, id);
  await reopened.submit('note');
  assert.equal(note().updates.length, 1);
  assert.equal(reopened.update, '');
});
test('failed comment write preserves text and material links for retry', async () => {
  const { plugin, model, file, note } = setup();
  plugin.addUpdate = async () => {
    throw new Error('DISK_FAILURE');
  };
  const text = 'Found options\n[[Материалы/Исследование]]';
  model.setText('note', text);
  await model.submit('note');
  assert.equal(model.update, text);
  assert.equal(plugin.draft(file.path).update, text);
  assert.equal(note().updates.length, 0);
  assert.equal(model.busy, false);
});
test('new next-step edits made during saving rebase onto the successful write', async () => {
  const { plugin, model, note } = setup('Old step'),
    started = defer(),
    gate = defer();
  await model.prepareNext();
  const save = plugin.setNext;
  let calls = 0;
  plugin.setNext = async (...args) => {
    if (++calls === 1) {
      started.resolve();
      await gate.promise;
    }
    await save(...args);
  };
  model.setText('next', 'First saved step');
  const posting = model.submit('next');
  await started.promise;
  model.setText('next', 'Second draft');
  gate.resolve();
  await posting;
  assert.equal(model.nextDraft, 'Second draft');
  assert.equal(model.nextBase, 'First saved step');
  await model.submit('next');
  assert.equal(model.error, '');
  assert.equal(note().nextAction, 'Second draft');
});
test('clearing the saved next step does not erase an existing replacement draft', async () => {
  const { model, plugin, file, note } = setup('Call clinic');
  await model.prepareNext();
  model.setText('next', 'Bring documents');
  await model.clearNext();
  assert.equal(note().nextAction, '');
  assert.equal(note().updates.length, 0);
  assert.equal(model.nextDraft, 'Bring documents');
  assert.equal(model.nextBase, '');
  assert.equal(plugin.draft(file.path).nextDraft, 'Bring documents');
  await model.submit('next');
  assert.equal(note().nextAction, 'Bring documents');
});
test('clearing the saved next step preserves a replacement typed during completion', async () => {
  const { model, plugin, note } = setup('Call clinic'),
    started = defer(),
    gate = defer();
  await model.prepareNext();
  const clear = plugin.setNext;
  plugin.setNext = async (...args) => {
    started.resolve();
    await gate.promise;
    await clear(...args);
  };
  const finishing = model.clearNext();
  await started.promise;
  model.setText('next', 'Bring documents');
  gate.resolve();
  await finishing;
  assert.equal(model.nextDraft, 'Bring documents');
  assert.equal(model.nextBase, '');
  await model.submit('next');
  assert.equal(note().nextAction, 'Bring documents');
});
test('external next-step conflict keeps the user draft and external value intact', async () => {
  const { plugin, model, note } = setup('Old step');
  await model.prepareNext();
  model.setText('next', 'My step');
  await plugin.setNext({}, 'Old step', 'External step');
  await model.submit('next');
  assert.equal(note().nextAction, 'External step');
  assert.equal(model.nextDraft, 'My step');
  assert.match(model.error, /changed/);
  assert.equal(model.busy, false);
});
test('a delayed next-step read cannot override a newer composer mode selection', async () => {
  const { plugin, model, JournalComposer } = setup('Saved step'),
    gate = defer();
  plugin.note = () => gate.promise;
  const composer = Object.create(JournalComposer.prototype);
  Object.assign(composer, {
    model,
    mode: 'note',
    disposed: false,
    paint() {},
    input: { focus() {} },
  });
  const pending = composer.setMode('next');
  await composer.setMode('note');
  gate.resolve({ nextAction: 'Saved step' });
  await pending;
  assert.equal(composer.mode, 'note');
});
test('saving a deleted model cannot resurrect the removed task draft', async () => {
  const { model, plugin, file } = setup();
  model.setText('note', 'Unsent comment');
  await model.save();
  model.deleted = true;
  delete plugin.data.drafts[file.path];
  let saves = 0;
  plugin.setDraft = async () => {
    saves++;
  };
  await model.save();
  assert.equal(saves, 0);
  assert.equal(plugin.draft(file.path).update, undefined);
});
test('explicit next-step rebase preserves the draft and permits saving against the fresh value', async () => {
  const { model, plugin, note } = setup('Old step');
  await model.prepareNext();
  model.setText('next', 'My replacement');
  await plugin.setNext({}, 'Old step', 'External replacement');
  await model.submit('next');
  assert.match(model.error, /changed/);
  await model.rebaseNext();
  assert.equal(model.next, 'External replacement');
  assert.equal(model.nextDraft, 'My replacement');
  assert.equal(model.nextBase, 'External replacement');
  assert.equal(model.error, '');
  await model.submit('next');
  assert.equal(note().nextAction, 'My replacement');
  assert.equal(model.error, '');
});

function composerFor(state) {
  const composer = Object.create(state.JournalComposer.prototype);
  Object.assign(composer, {
    model: state.model,
    mode: 'next',
    modeSeq: 1,
    disposed: false,
    paint() {
      this.paints = (this.paints || 0) + 1;
    },
    input: {
      blur() {
        composer.blurred = true;
      },
    },
  });
  return composer;
}
test('saving a next step switches the sender back to a blank comment and releases the caret', async () => {
  const state = setup();
  await state.model.prepareNext();
  state.model.setText('next', 'My next action');
  const composer = composerFor(state);
  await composer.submit();
  assert.equal(state.note().nextAction, 'My next action');
  assert.equal(composer.mode, 'note');
  assert.equal(composer.blurred, true);
  assert.equal(state.model.update, '');
});
test('failed save stays in next-step mode with the draft available', async () => {
  const state = setup();
  await state.model.prepareNext();
  state.model.setText('next', 'Keep me');
  state.plugin.setNext = async () => {
    throw new Error('DISK_FAILURE');
  };
  const composer = composerFor(state);
  await composer.submit();
  assert.equal(composer.mode, 'next');
  assert.equal(composer.blurred, undefined);
  assert.equal(state.model.nextDraft, 'Keep me');
});
test('a successful save never discards a newer draft or mode selection', async () => {
  for (const change of ['draft', 'mode']) {
    const state = setup(),
      gate = defer(),
      started = defer();
    await state.model.prepareNext();
    state.model.setText('next', 'First');
    const original = state.plugin.setNext;
    state.plugin.setNext = async (...args) => {
      started.resolve();
      await gate.promise;
      return original(...args);
    };
    const composer = composerFor(state),
      pending = composer.submit();
    await started.promise;
    if (change === 'draft') state.model.setText('next', 'Second');
    else composer.modeSeq++;
    gate.resolve();
    await pending;
    assert.equal(composer.mode, 'next');
    assert.equal(composer.blurred, undefined);
    if (change === 'draft') assert.equal(state.model.nextDraft, 'Second');
  }
});

test('opening next-step editing replaces an obsolete empty draft with the currently saved step', async () => {
  const state = setup('Restored action [[Research]]');
  state.model.nextDraft = '';
  state.model.nextBase = 'Old action';
  await state.model.save();
  const reopened = new state.JournalModel(state.plugin, state.file);
  await reopened.prepareNext();
  assert.equal(reopened.nextDraft, 'Restored action [[Research]]');
  assert.equal(reopened.nextBase, 'Restored action [[Research]]');
  assert.equal(state.plugin.draft(state.file.path).nextDraft, 'Restored action [[Research]]');
  reopened.setText('next', 'Revised action [[Research]]');
  await reopened.submit('next');
  assert.equal(state.note().nextAction, 'Revised action [[Research]]');
  assert.equal(state.note().updates.length, 0);
});
test('opening next-step editing preserves a nonempty pending draft and still detects an external change', async () => {
  const state = setup('Saved action');
  state.model.nextDraft = 'Unsent revision';
  state.model.nextBase = 'Old action';
  await state.model.prepareNext();
  assert.equal(state.model.nextDraft, 'Unsent revision');
  assert.equal(state.model.nextBase, 'Old action');
  await state.model.submit('next');
  assert.equal(state.note().nextAction, 'Saved action');
  assert.match(state.model.error, /changed/);
});
test('empty next-step submission cannot remove a saved step accidentally', async () => {
  const state = setup('Keep pinned');
  await state.model.prepareNext();
  state.model.setText('next', '   ');
  assert.equal(await state.model.submit('next'), false);
  assert.equal(state.note().nextAction, 'Keep pinned');
});
test('a next-step load does not erase text typed while its read is pending', async () => {
  const state = setup('Saved action'),
    gate = defer();
  state.plugin.note = () => gate.promise;
  const pending = state.model.prepareNext();
  state.model.setText('next', 'Typed while reading');
  gate.resolve({ nextAction: 'Saved action' });
  await pending;
  assert.equal(state.model.nextDraft, 'Typed while reading');
});

test('checking next-step items does not create history or overwrite an unrelated editing draft', async () => {
  const step = '- [ ] First\n- [ ] Second',
    state = setup(step);
  await state.model.prepareNext();
  state.model.setText('next', 'My unsaved rewrite');
  assert.equal(await state.model.toggleNextCheck(step, 0, true), true);
  assert.equal(state.note().nextAction, '- [x] First\n- [ ] Second');
  assert.equal(state.note().updates.length, 0);
  assert.equal(state.model.nextDraft, 'My unsaved rewrite');
});
test('rapid independent checklist clicks are retained and block clearing until writes finish', async () => {
  const step = '- [ ] First\n- [ ] Second',
    state = setup(step),
    gate = defer(),
    started = defer();
  await state.model.prepareNext();
  const toggle = state.plugin.toggleNextCheck;
  state.plugin.toggleNextCheck = async (...args) => {
    started.resolve();
    await gate.promise;
    return toggle(...args);
  };
  const first = state.model.toggleNextCheck(step, 0, true);
  await started.promise;
  const second = state.model.toggleNextCheck(step, 1, true);
  await state.model.clearNext();
  assert.equal(state.note().nextAction, step);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(state.note().nextAction, '- [x] First\n- [x] Second');
  assert.equal(state.model.checkPending, 0);
});
