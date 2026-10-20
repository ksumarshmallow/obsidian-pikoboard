'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appearanceController } = require('../../src/ui/appearance.js');
const { settingsFrom } = require('../../src/storage/task-store.js');

function document() {
  return {
    body: { dataset: { unrelated: 'keep' }, className: 'theme-light', style: 'color: green' },
    defaultView: { closed: false },
  };
}
function setup() {
  const main = document(), popout = document(), handlers = new Map(), cleanup = [];
  let ready;
  const plugin = {
    settings: settingsFrom({ appearance: 'piko' }),
    register: (fn) => cleanup.push(fn),
    registerEvent() {},
    app: { workspace: {
      containerEl: { ownerDocument: main },
      iterateAllLeaves: (fn) => fn({ view: { containerEl: { ownerDocument: popout } } }),
      on: (name, fn) => handlers.set(name, fn),
      onLayoutReady: (fn) => { ready = fn; },
    } },
  };
  const appearance = appearanceController(plugin);
  return { main, popout, handlers, cleanup, plugin, appearance, ready: () => ready() };
}

test('appearance follows settings across main and popout windows without modifying native styling', () => {
  const { main, popout, plugin, appearance, handlers, cleanup } = setup();
  assert.equal(main.body.dataset.pikoboardAppearance, 'piko');
  assert.equal(popout.body.dataset.pikoboardAppearance, 'piko');
  const fresh = document();
  handlers.get('window-open')({}, { document: fresh });
  assert.equal(fresh.body.dataset.pikoboardAppearance, 'piko');
  for (const value of ['piko-light', 'obsidian', 'piko']) {
    plugin.settings = settingsFrom({ appearance: value });
    appearance.apply();
    for (const doc of [main, popout, fresh]) {
      assert.equal(doc.body.dataset.pikoboardAppearance, value);
      assert.equal(doc.body.className, 'theme-light');
      assert.equal(doc.body.style, 'color: green');
    }
  }
  cleanup.forEach((fn) => fn());
  for (const doc of [main, popout, fresh])
    assert.deepEqual(doc.body.dataset, { unrelated: 'keep' });
});

test('closed windows and delayed layout callbacks cannot reapply an unloaded appearance', () => {
  const { main, popout, plugin, appearance, handlers, cleanup, ready } = setup();
  popout.defaultView.closed = true;
  handlers.get('window-close')({}, { document: popout });
  plugin.settings = settingsFrom({ appearance: 'obsidian' });
  appearance.apply();
  assert.equal(popout.body.dataset.pikoboardAppearance, 'piko', 'closed window is untouched');
  cleanup.forEach((fn) => fn());
  ready();
  appearance.apply();
  assert.deepEqual(main.body.dataset, { unrelated: 'keep' });
});

test('new vaults inherit Obsidian and invalid appearance values fall back to Obsidian', () => {
  assert.equal(settingsFrom({}).appearance, 'obsidian');
  assert.equal(settingsFrom({ appearance: 'future-unknown-theme' }).appearance, 'obsidian');
  assert.equal(settingsFrom({ appearance: 'piko' }).appearance, 'piko');
  assert.equal(settingsFrom({ appearance: 'piko-light' }).appearance, 'piko-light');
});
