'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../helpers/modules.js');

function fixture(failure) {
  const state = { widgetUnloads: 0, unloads: 0, destroys: 0, changes: 0, probes: 0 };
  const listeners = new Map();
  const content = {
    setAttribute() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  class Base {
    buildLocalExtensions() { return []; }
    onUpdate() {}
    load() {
      if (failure === 'load') throw Error('Host editor changed');
      this.editor = { cm: { contentDOM: content }, getValue: () => this.value };
    }
    set(value) { this.value = value; }
    unload() { state.unloads++; }
    destroy() { state.destroys++; }
  }
  class Mode extends Base {}
  const previous = { name: 'Previous editor' };
  const app = {
    workspace: { activeEditor: previous },
    embedRegistry: { embedByExtension: { md() {
      state.probes++;
      return {
        editMode: new Mode(), load() {},
        showEditor() { if (failure === 'probe') throw Error('Probe unavailable'); },
        unload() { state.widgetUnloads++; },
      };
    } } },
  };
  const ownerDocument = { createElement: () => ({}) };
  const load = createLoader({ require: () => ({ placeholder: () => ({}) }), console });
  const { richEditor } = load('ui/rich-editor.js');
  return { state, listeners, app, previous, ownerDocument,
    mount: () => richEditor(app, { ownerDocument }, '# Original draft', () => state.changes++) };
}

test('embedded editor preserves draft, restores focus and releases listeners exactly once', () => {
  const f = fixture(), editor = f.mount();
  assert.equal(editor.editor.getValue(), '# Original draft');
  editor.onUpdate({}, true);
  assert.equal(f.state.changes, 1);
  f.listeners.get('focusin')();
  assert.notEqual(f.app.workspace.activeEditor, f.previous);
  editor.dispose();
  editor.dispose();
  assert.equal(f.app.workspace.activeEditor, f.previous);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.state.unloads, 1);
  assert.equal(f.state.destroys, 1);
  editor.onUpdate({}, true);
  assert.equal(f.state.changes, 1);
  const second = f.mount();
  assert.equal(f.state.probes, 1);
  second.dispose();
});

test('failed host probes and partial editor mounts release resources for textarea fallback', () => {
  const probe = fixture('probe');
  assert.throws(probe.mount, /Probe unavailable/);
  assert.equal(probe.state.widgetUnloads, 1);
  const partial = fixture('load');
  assert.throws(partial.mount, /Host editor changed/);
  assert.equal(partial.state.widgetUnloads, 1);
  assert.equal(partial.state.unloads, 1);
  assert.equal(partial.state.destroys, 1);
  assert.equal(partial.listeners.size, 0);
  assert.equal(partial.app.workspace.activeEditor, partial.previous);
  assert.throws(partial.mount);
  assert.equal(partial.state.probes, 2, 'a failed constructor is not kept in the cache');
});
