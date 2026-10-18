'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const tick = () => Promise.resolve();

test('short and mixed code fences do not expose example checkboxes', () => {
  const source = '````markdown\n```\n- [ ] example\n~~~\n- [ ] example too\n````\n- [ ] real';
  assert.deepEqual(C.parseChecklist(source), [{ line: 6, text: 'real', checked: false }]);
  assert.equal(C.toggleChecklist(source, 0, true), source.replace('[ ] real', '[x] real'));
});
test('source line checklist edits preserve indentation, quotes, CRLF and unrelated Markdown', () => {
  const body =
    '# Title\r\n> - [ ] quoted [[Link]]\r\n  2. [X] Nested\r\n\r\n![image](picture.png)\r\n';
  assert.deepEqual(C.parseChecklist(body), [
    { line: 1, text: 'quoted [[Link]]', checked: false },
    { line: 2, text: 'Nested', checked: true },
  ]);
  const next = C.setChecklistItem(body, 2, { text: 'Changed', checked: false });
  assert.equal(next, body.replace('2. [X] Nested', '2. [ ] Changed'));
  assert.throws(() => C.setChecklistItem(body, 0, { checked: true }), /CHECKLIST_CHANGED/);
  assert.throws(
    () => C.setChecklistItem(body, 2, { text: 'Injected\n- [ ] task' }),
    /CHECKLIST_TEXT_MULTILINE/,
  );
});
test('checklist add/remove only touch designated lines and reject unfinished code/comments', () => {
  const body = 'Intro\n- [ ] First\n  - [x] child\n\n[[Research]]\n';
  assert.equal(C.removeChecklistItem(body, 1), 'Intro\n  - [x] child\n\n[[Research]]\n');
  assert.equal(
    C.addChecklistItem(body, 'Next', 2),
    'Intro\n- [ ] First\n  - [x] child\n  - [ ] Next\n\n[[Research]]\n',
  );
  assert.equal(C.addChecklistItem('Text', 'New'), 'Text\n- [ ] New\n');
  assert.throws(() => C.addChecklistItem('```\nexample', 'New'), /UNCLOSED_MARKDOWN_BLOCK/);
  assert.throws(() => C.addChecklistItem('<!--\nexample', 'New'), /UNCLOSED_MARKDOWN_BLOCK/);
  assert.throws(() => C.removeChecklistItem(body, 4), /CHECKLIST_CHANGED/);
});
test('HTML comments and quoted fenced blocks are excluded from checklist controls', () => {
  const body = '<!--\n- [ ] hidden\n-->\n> ````\n> ```\n> - [ ] code\n> ````\n> - [x] visible';
  assert.deepEqual(C.parseChecklist(body), [{ line: 7, text: 'visible', checked: true }]);
});
test('standalone indented code is preserved while nested checklist items remain editable', () => {
  const body =
    '    - [ ] code example\n\n- [ ] Parent\n    - [ ] Child\n\nUnrelated text\n\n    - [ ] another code example';
  assert.deepEqual(C.parseChecklist(body), [
    { line: 2, text: 'Parent', checked: false },
    { line: 3, text: 'Child', checked: false },
  ]);
  assert.equal(C.toggleChecklist(body, 1, true), body.replace('[ ] Child', '[x] Child'));
});
test('overlapping autosave, blur and close share one promise and drain latest input', async () => {
  let disk = 'A';
  const first = deferred(),
    writes = [];
  const session = new C.BodySession(disk, async (expected, next) => {
    writes.push([expected, next]);
    if (writes.length === 1) await first.promise;
    disk = C.replaceBody(disk, expected, next);
    return { body: disk };
  });
  session.set('B');
  const save = session.flush();
  await tick();
  session.set('C');
  assert.equal(session.flush(), save);
  assert.equal(session.flush(), save);
  first.resolve();
  await save;
  assert.equal(disk, 'C');
  assert.equal(session.dirty, false);
  assert.deepEqual(writes, [
    ['A', 'B'],
    ['B', 'C'],
  ]);
});
test('two rapid checkbox actions accumulate without false conflict or lost action', async () => {
  let disk = '- [ ] One\n- [ ] Two';
  const gate = deferred();
  let calls = 0;
  const session = new C.BodySession(disk, async (expected, next) => {
    if (++calls === 1) await gate.promise;
    disk = C.replaceBody(disk, expected, next);
    return { body: disk };
  });
  const first = session.update((body) => C.setChecklistItem(body, 0, { checked: true }));
  await tick();
  const second = session.update((body) => C.setChecklistItem(body, 1, { checked: true }));
  assert.equal(first, second);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(disk, '- [x] One\n- [x] Two');
  assert.equal(session.dirty, false);
});
test('real external body conflict is surfaced and latest unsaved input retained', async () => {
  let disk = 'External';
  const session = new C.BodySession('Original', async (expected, next) => ({
    body: (disk = C.replaceBody(disk, expected, next)),
  }));
  session.set('My changes');
  await assert.rejects(session.flush(), /BODY_CONFLICT/);
  assert.equal(session.value, 'My changes');
  assert.equal(session.dirty, true);
  assert.equal(session.baseline, 'Original');
  assert.equal(disk, 'External');
  assert.equal(session.pending, null);
  assert.throws(() => session.reset('External'), /DIRTY_SESSION/);
});
test('external history insertion is preserved while body session saves', async () => {
  let disk = 'Old';
  const session = new C.BodySession(disk, async (expected, next) => {
    disk = C.replaceBody(disk, expected, next);
    return C.readNote(disk);
  });
  disk = C.appendUpdate(disk, { id: 'test', at: '2026-10-18T12:00:00Z', text: 'New history' });
  session.set('New');
  await session.flush();
  assert.equal(C.readNote(disk).updates[0].text, 'New history');
  assert.equal(session.dirty, false);
  session.set('Newer');
  await session.flush();
  assert.equal(C.readNote(disk).body.trim(), 'Newer');
});
test('reverting text while a save is pending is also persisted', async () => {
  let disk = 'A';
  const gate = deferred();
  let calls = 0;
  const session = new C.BodySession(disk, async (expected, next) => {
    if (++calls === 1) await gate.promise;
    disk = C.replaceBody(disk, expected, next);
    return { body: disk };
  });
  session.set('B');
  const pending = session.flush();
  await tick();
  session.set('A');
  gate.resolve();
  await pending;
  assert.equal(disk, 'A');
  assert.equal(session.dirty, false);
});
test('failed save can retry without deleting the local draft', async () => {
  let fail = true;
  const session = new C.BodySession('A', async (expected, next) => {
    if (fail) throw new Error('DISK_FAILURE');
    return { body: next };
  });
  session.set('B');
  await assert.rejects(session.flush(), /DISK_FAILURE/);
  assert.equal(session.dirty, true);
  fail = false;
  await session.flush();
  assert.equal(session.baseline, 'B');
  assert.equal(session.dirty, false);
  session.reset('External');
  assert.equal(session.value, 'External');
});
test('history edits and removals preserve timestamps, other entries and surrounding Markdown', () => {
  const original = '---\ntags: [task]\n---\n\n[[Research]]\n';
  let source = C.appendUpdate(original, { id: 'one', at: '2026-10-18T12:00:00Z', text: 'First' });
  source =
    C.appendUpdate(source, { id: 'two', at: '2026-10-18T13:00:00Z', text: 'Second' }) + '\nOutside';
  const edited = C.editUpdate(source, 'one', 'Revised\nwith line');
  assert.equal(C.readNote(edited).updates.find((u) => u.id === 'one').at, '2026-10-18T12:00:00Z');
  assert.equal(C.readNote(edited).updates.find((u) => u.id === 'one').text, 'Revised\nwith line');
  assert.equal(C.readNote(edited).body, C.readNote(source).body);
  assert.equal(C.readNote(edited).head, C.readNote(source).head);
  const removed = C.removeUpdate(edited, 'two');
  assert.deepEqual(
    C.readNote(removed).updates.map((u) => u.id),
    ['one'],
  );
  assert.ok(removed.endsWith('\nOutside'));
  assert.throws(() => C.editUpdate(source, 'one', '<!-- pb:end -->'), /RESERVED_MARKER/);
  assert.throws(() => C.removeUpdate(source, 'missing'), /UPDATE_NOT_FOUND/);
});
