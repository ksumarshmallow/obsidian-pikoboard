'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../helpers/modules.js');
function fixture() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.value = ''; this.selectionStart = this.selectionEnd = 0; this.style = {}; this.scrollHeight = 100; this.classList = {add() {}, remove() {}}; }
    append(child) { this.children.push(child); child.parentElement = this; }
    after(child) { this.parentElement.append(child); }
    remove() { this.parentElement.children = this.parentElement.children.filter((x) => x !== this); }
    setAttribute() {}
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.events[name] = fn; }
    querySelector(tag) { return this.children.find((x) => x.tag === tag); }
    focus() {}
    click() { return this.onclick?.(); }
    setRangeText(value, start, end) { this.value = this.value.slice(0, start) + value + this.value.slice(end); this.selectionStart = this.selectionEnd = start + value.length; }
  }
  const load = createLoader({document: {createElement: (tag) => new Element(tag)}, require: (n) => n === 'obsidian' ? {setIcon() {}} : require(n), module: {exports: {}}});
  const host = new Element('div'), input = new Element('textarea'), errors = [];
  let changes = 0;
  const plugin = {app: {vault: {getFiles: () => [{path: 'Research/Notes.md'}, {path: 'Attachments/report.pdf'}]}, fileManager: {generateMarkdownLink: (f) => `[[${f.path}]]`}}, importMaterials: async (files, cb) => { for (const f of files) await cb({path: 'Attachments/' + f.name}); }};
  const editor = load('ui/entry-input.js').entryInput(plugin, {path: 'Task.md'}, host, input, () => changes++, (e) => errors.push(e));
  return {host, input, editor, plugin, errors, load, Element, get changes() {return changes;}};
}
test('wikilink search displays full paths and replaces incomplete link without losing surrounding text', () => {
  const f = fixture();
  f.input.value = 'See [[Notes]] later'; f.input.selectionStart = f.input.selectionEnd = 11;
  f.input.events.input();
  const option = f.host.children[0].children[0];
  assert.equal(option.textContent, 'Research/Notes.md'); option.onclick();
  assert.equal(f.input.value, 'See [[Research/Notes.md]] later');
  assert.equal(f.changes, 1);
});
test('multiple Finder files insert links at the caret, text drops stay untouched', async () => {
  const f = fixture(); f.input.value = 'Before after'; f.input.selectionStart = f.input.selectionEnd = 7;
  let prevented = 0;
  const event = {dataTransfer: {types: ['Files'], files: [{name:'one.pdf'}, {name:'two.png'}]}, preventDefault() {prevented++;}, stopPropagation() {}};
  await f.host.events.drop(event);
  assert.equal(f.input.value, 'Before [[Attachments/one.pdf]]\n[[Attachments/two.png]]after');
  assert.equal(prevented, 1); assert.equal(f.editor.pending, 0); assert.equal(f.input.readOnly, false);
  event.dataTransfer.types = ['text/plain']; await f.host.events.drop(event); assert.equal(prevented, 1);
});
test('failed upload keeps draft and cancelled editor ignores late attachments', async () => {
  const f = fixture(); f.input.value = 'Draft';
  f.plugin.importMaterials = async () => { throw new Error('Disk full'); };
  await f.host.events.drop({dataTransfer:{types:['Files'],files:[]},preventDefault(){},stopPropagation(){}});
  assert.equal(f.input.value, 'Draft'); assert.equal(f.errors[0].message, 'Disk full');
  assert.equal(f.input.readOnly, false);
  f.editor.dispose(); f.editor.append({path:'late.pdf'}); assert.equal(f.input.value, 'Draft');
});

test('inline edit starts with the original text, saves the same entry and cancel does not mutate', async () => {
  const f = fixture(), parent = new f.Element('div'), rendered = new f.Element('div');
  parent.append(rendered);
  const update = {id: 'original-id', text: 'Existing [[note]]', at: '2026-11-08T10:00:00Z'};
  const writes = [];
  f.plugin.editMessage = async (...args) => writes.push(args);
  const edit = f.load('features/journal/inline-edit.js').editEntry;
  edit(f.plugin, {path:'Task.md'}, update, rendered);
  let host = parent.children.find((x) => x.className === 'pb-inline-entry');
  assert.equal(rendered.hidden, true);
  assert.equal(host.children[0].value, update.text);
  host.children[0].value = 'Changed [[note]]';
  let actions = host.children[1];
  await actions.children.find((x) => x.textContent === 'Save').onclick();
  assert.equal(writes.length, 1); assert.equal(writes[0][1], update); assert.equal(writes[0][2], 'Changed [[note]]');
  assert.equal(rendered.hidden, false);
  edit(f.plugin, {path:'Task.md'}, update, rendered);
  host = parent.children.find((x) => x.className === 'pb-inline-entry');
  host.children[0].value = 'Discard this';
  host.children[1].children.find((x) => x.textContent === 'Cancel').onclick();
  assert.equal(writes.length, 1); assert.equal(rendered.hidden, false);
});

test('inline editing saves on Enter but leaves Shift+Enter and composition to the text field', async () => {
  const f = fixture(), parent = new f.Element('div'), rendered = new f.Element('div');
  parent.append(rendered);
  const writes = [];
  f.plugin.editMessage = async (...args) => writes.push(args);
  f.load('features/journal/inline-edit.js').editEntry(f.plugin, {path:'Task.md'}, {id:'entry',text:'Original'}, rendered);
  const host = parent.children.find((x) => x.className === 'pb-inline-entry');
  assert.equal(host.children[1].className, 'pb-entry-edit-actions');
  const input = host.children[0];
  input.value = 'Edited';
  let prevented = 0;
  const event = {key:'Enter', preventDefault(){ prevented++; }, stopPropagation(){}};
  input.onkeydown({...event, shiftKey:true});
  input.onkeydown({...event, isComposing:true});
  assert.equal(writes.length, 0); assert.equal(prevented, 0);
  input.onkeydown(event);
  await Promise.resolve();
  assert.equal(writes.length, 1); assert.equal(writes[0][2], 'Edited');
  assert.equal(prevented, 1);
});

test('link suggestions use the top layer so a scrollable history cannot clip them', () => {
  const f = fixture(), popup = f.host.children[0];
  let open = false;
  popup.showPopover = () => { open = true; };
  popup.hidePopover = () => { open = false; };
  popup.matches = () => open;
  popup.getBoundingClientRect = () => ({height:180});
  f.input.ownerDocument = {defaultView:{innerWidth:900,innerHeight:600}};
  f.input.getBoundingClientRect = () => ({left:50,top:250,bottom:550,width:500});
  f.input.value = '[['; f.input.selectionStart = f.input.selectionEnd = 2;
  f.input.events.input();
  assert.equal(open, true);
  assert.equal(popup.hidden, false);
  assert.equal(popup.style.top, '64px');
  assert.equal(popup.style.width, '500px');
  f.input.events.blur();
  assert.equal(open, false);
  assert.equal(popup.hidden, true);
});

test('task-window entry fields grow fully while board fields retain their height limit', () => {
  const f = fixture(), growEntry = f.load('ui/elements.js').growEntry;
  f.input.scrollHeight = 540;
  f.input.closest = () => null;
  growEntry(f.input, 32, 120);
  assert.equal(f.input.style.height, '120px');
  f.input.closest = () => ({});
  growEntry(f.input, 32, 120);
  assert.equal(f.input.style.height, '540px');
});
