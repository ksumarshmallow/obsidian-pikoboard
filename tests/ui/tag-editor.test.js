'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../helpers/modules.js');

function fixture(initial = ['task'], draft = {}) {
  const doc = { activeElement: null };
  class Element {
    constructor() {
      this.children = [];
      this.attrs = {};
      this.ownerDocument = doc;
      this.value = '';
      this.classList = { add() {}, remove() {} };
    }
    append(child) { this.children.push(child); child.parent = this; }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    focus() { doc.activeElement = this; }
  }
  doc.createElement = () => new Element();
  const load = createLoader({
    require: (name) => name === 'obsidian' ? { setIcon() {} } : require(name),
    document: doc,
    module: { exports: {} },
  });
  const { TagEditor } = load('features/tasks/tag-editor.js');
  let tags = [...initial], savedDraft, saves = 0;
  const failures = [];
  const options = {
    tags: () => tags,
    system: () => ['task', 'archived'],
    draft,
    persist: async (value) => { savedDraft = structuredClone(value); },
    save: async (edit) => { saves++; tags = edit(tags); },
    fail: (e) => failures.push(e),
  };
  const editor = new TagEditor(new Element(), options);
  const type = (value) => {
    editor.input.value = value;
    editor.input.oninput();
    editor.input.focus();
  };
  const labels = () => editor.chips.children.map((chip) => chip.children[0].textContent);
  const remove = (name) => editor.chips.children.find((chip) => chip.children[0].textContent === name).children[1];
  return { editor, options, doc, type, labels, remove, failures,
    get tags() { return [...tags]; }, set tags(value) { tags = value; },
    get draft() { return savedDraft; }, get saves() { return saves; },
  };
}
const event = (key, isComposing = false) => ({ key, isComposing, preventDefault() {}, stopPropagation() {} });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('Enter creates a chip immediately, retains the input and supports repeated additions and removal', async () => {
  const f = fixture();
  const input = f.editor.input;
  f.type('#английский');
  input.onkeydown(event('Enter'));
  assert.deepEqual(f.labels(), ['#английский']);
  assert.equal(input.value, '');
  await f.editor.saving;
  f.type('#ресерч');
  input.onkeydown(event('Enter'));
  await f.editor.saving;
  assert.deepEqual(f.tags, ['task', 'английский', 'ресерч']);
  assert.equal(f.doc.activeElement, input);
  assert.equal(f.editor.input, input);
  f.remove('#английский').onclick();
  await f.editor.saving;
  assert.deepEqual(f.tags, ['task', 'ресерч']);
  assert.deepEqual(f.labels(), ['#ресерч']);
  assert.equal(f.draft.tagOperations, undefined);
});

test('quick Enter presses and a removal during a delayed write keep the remaining tags and typed text', async () => {
  const f = fixture(['task', 'old']);
  const gate = deferred();
  const write = f.options.save;
  let first = true;
  f.options.save = async (edit) => {
    if (first) { first = false; await gate.promise; }
    await write(edit);
    f.editor.render(); // A modal refresh can happen before the write is acknowledged.
  };
  f.type('#first');
  const saving = f.editor.flush();
  f.type('#second');
  f.editor.flush();
  f.remove('#old').onclick();
  f.type('#still-typing');
  f.tags = [...f.tags, 'external'];
  gate.resolve();
  await saving;
  assert.deepEqual(f.tags, ['task', 'external', 'first', 'second']);
  assert.equal(f.editor.input.value, '#still-typing');
  assert.equal(f.draft.tagInput, '#still-typing');
});

test('duplicates and a pasted group are normalized without exposing system flags', async () => {
  const f = fixture(['task', 'archived', 'English']);
  f.type('#english #ENGLISH, #ресерч #task #archived');
  await f.editor.flush();
  assert.deepEqual(f.tags, ['task', 'archived', 'English', 'ресерч']);
  assert.deepEqual(f.labels(), ['#English', '#ресерч']);
  f.remove('#English').onclick();
  await f.editor.saving;
  assert.deepEqual(f.tags, ['task', 'archived', 'ресерч']);
});

test('invalid input and IME Enter retain the draft without adding a chip', async () => {
  const f = fixture();
  f.type('#bad!');
  f.editor.input.onkeydown(event('Enter', true));
  assert.equal(f.saves, 0);
  await assert.rejects(f.editor.flush(), /Некорректный тег/);
  assert.equal(f.editor.input.value, '#bad!');
  assert.equal(f.draft.tagInput, '#bad!');
  assert.deepEqual(f.labels(), []);
});

test('failed saves keep ordered edits for retry and recovered drafts do not duplicate successful additions', async () => {
  const f = fixture(['task', 'old']);
  const save = f.options.save;
  f.options.save = async () => { throw new Error('Disk unavailable'); };
  f.type('#new');
  await assert.rejects(f.editor.flush(), /Disk unavailable/);
  assert.deepEqual(f.tags, ['task', 'old']);
  assert.deepEqual(f.labels(), ['#old', '#new']);
  assert.equal(f.draft.tagOperations.length, 1);
  const recovered = fixture(['task', 'old', 'new'], f.draft);
  await recovered.editor.flush();
  assert.deepEqual(recovered.tags, ['task', 'old', 'new']);
  assert.equal(recovered.draft.tagOperations, undefined);
  f.options.save = save;
  await f.editor.flush();
  assert.deepEqual(f.tags, ['task', 'old', 'new']);
});

test('blur adds a typed tag, but clicking a remove cross keeps a half-written input intact', async () => {
  const f = fixture(['task', 'old']);
  f.type('#next');
  f.editor.input.onblur();
  await f.editor.saving;
  assert.deepEqual(f.tags, ['task', 'old', 'next']);
  f.type('#unfinished');
  let prevented = false;
  f.remove('#old').onmousedown({ preventDefault() { prevented = true; } });
  f.remove('#old').onclick();
  await f.editor.saving;
  assert.equal(prevented, true);
  assert.equal(f.editor.input.value, '#unfinished');
  assert.deepEqual(f.tags, ['task', 'next']);
  f.editor.dispose();
  assert.equal(f.editor.input.onblur, null);
});
