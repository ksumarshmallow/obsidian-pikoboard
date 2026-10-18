'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core');
const source =
  '---\ntitle: Research\ntags: [task]\n---\n\n## Description\n[[Materials/Research|Research]]\n![[Attachments/plan.png]]\n- [ ] Compare options\n';
const update = (
  id = 'comment',
  text = '**Compared** [options](https://example.test)\n\n[[Materials/Research]]\n![[Attachments/plan.png]]',
  kind,
) => ({ id, at: '2026-10-18T12:00:00Z', text, ...(kind ? { kind } : {}) });
const nextSection = (text) => `${C.NEXT_START}\n## Следующий шаг\n${text}\n${C.NEXT_END}`;

test('legacy comments keep their shape while done entries carry an explicit kind', () => {
  const legacy = update(),
    done = {
      ...update('completed', 'Checked **all** options', 'done'),
      at: '2026-10-18T13:00:00Z',
    };
  const text = C.appendUpdate(C.appendUpdate(source, legacy), done),
    note = C.readNote(text);
  assert.deepEqual(note.updates, [done, legacy]);
  assert.equal(note.nextAction, '');
  assert.equal(note.nextSection, '');
  assert.equal(C.appendUpdate(text, done), text);
  assert.equal(note.head, C.readNote(source).head);
});

test('setting and clearing a next action retains Markdown, metadata and existing history', () => {
  const original = C.appendUpdate(source, update()) + '\nUnmanaged tail [[Keep me]]\n';
  const next = 'Compare **two** options\n[[Materials/Research]]';
  const text = C.setNextAction(original, '', next),
    note = C.readNote(text);
  assert.equal(note.nextAction, next);
  assert.equal(note.nextSection, nextSection(next));
  assert.equal(note.body.trimEnd(), C.readNote(original).body.trimEnd());
  assert.deepEqual(note.updates, C.readNote(original).updates);
  assert.equal(note.tail, C.readNote(original).tail);
  assert.equal(note.head, C.readNote(original).head);
  const cleared = C.setNextAction(text, next, '');
  assert.equal(C.readNote(cleared).nextSection, '');
  assert.equal(C.readNote(cleared).nextAction, '');
  assert.deepEqual(C.readNote(cleared).updates, note.updates);
  assert.ok(cleared.endsWith('\nUnmanaged tail [[Keep me]]\n'));
});

test('description saves preserve concurrent changes to both next action and history', async () => {
  let disk = source;
  const baseline = C.readNote(disk).body;
  const session = new C.BodySession(baseline, async (expected, next) => {
    disk = C.replaceBody(disk, expected, next);
    return C.readNote(disk);
  });
  disk = C.setNextAction(disk, '', 'Read [[Research]]');
  disk = C.appendUpdate(disk, update());
  disk = C.setNextAction(disk, 'Read [[Research]]', 'Choose **one** format');
  session.set(baseline + '\nMore findings.\n');
  await session.flush();
  const note = C.readNote(disk);
  assert.equal(note.body.trimEnd(), (baseline + '\nMore findings.\n').trimEnd());
  assert.equal(note.nextAction, 'Choose **one** format');
  assert.deepEqual(note.updates, [update()]);
  assert.equal(session.dirty, false);
  assert.equal(note.head, C.readNote(source).head);
});

test('description replacement preserves managed sections and text after history', () => {
  const tail = '\n\nUnmanaged tail\n[[Other material]]\n';
  const original = C.appendUpdate(C.setNextAction(source, '', 'Make a call'), update()) + tail;
  const before = C.readNote(original),
    edited = C.readNote(C.replaceBody(original, before.body, 'New description'));
  assert.equal(edited.body.trim(), 'New description');
  assert.equal(edited.section, before.section);
  assert.equal(edited.nextSection, before.nextSection);
  assert.equal(edited.tail, before.tail);
  assert.equal(edited.head, before.head);
});

test('next section after history is read and retained without losing unmanaged tail', () => {
  const original =
    C.appendUpdate(source, update()) +
    '\nBefore next\n' +
    nextSection('Later') +
    '\nAfter next [[Link]]\n';
  const before = C.readNote(original);
  assert.equal(before.nextAction, 'Later');
  assert.equal(before.nextSection, nextSection('Later'));
  assert.equal(before.tail, '\n\nBefore next\n\nAfter next [[Link]]\n');
  const edited = C.readNote(C.replaceBody(original, before.body, 'Revised'));
  assert.equal(edited.nextAction, 'Later');
  assert.equal(edited.tail, before.tail);
  assert.deepEqual(edited.updates, before.updates);
});

test('next action saves detect real conflicts but retrying the same value is a no-op', () => {
  const text = C.setNextAction(source, '', 'Changed elsewhere');
  assert.throws(() => C.setNextAction(text, '', 'My change'), /NEXT_CONFLICT/);
  assert.equal(C.setNextAction(text, '', 'Changed elsewhere'), text);
  assert.equal(C.setNextAction(text, 'Changed elsewhere', '  Changed elsewhere  '), text);
  assert.equal(C.setNextAction(source, '', ''), source);
});

test('completing a next action atomically records done and clears only that step', () => {
  const action = 'Read [[Research]] and compare **two** formats';
  const original = C.appendUpdate(C.setNextAction(source, '', action), update());
  const completion = { id: 'complete-1', at: '2026-10-18T13:00:00Z' };
  const result = C.completeNextAction(original, action, completion),
    note = C.readNote(result);
  assert.equal(note.nextAction, '');
  assert.equal(note.nextSection, '');
  assert.deepEqual(note.updates, [{ ...completion, text: action, kind: 'done' }, update()]);
  assert.equal(note.body.trimEnd(), C.readNote(original).body.trimEnd());
  assert.equal(C.completeNextAction(result, action, completion), result);
  const later = C.setNextAction(result, '', 'Book a trial');
  assert.equal(
    C.completeNextAction(later, action, completion),
    later,
    'a retry must never clear a newer step',
  );
});

test('completing a stale or empty step fails before adding history', () => {
  const original = C.setNextAction(source, '', 'Newer step');
  assert.throws(() => C.completeNextAction(original, 'Old step', update('done')), /NEXT_CONFLICT/);
  assert.throws(() => C.completeNextAction(source, '', update('done')), /EMPTY_NEXT_ACTION/);
  assert.deepEqual(C.readNote(original).updates, []);
});

test('editing and removing typed comments preserve other comments, next action and timestamp', () => {
  const original =
    C.appendUpdate(
      C.appendUpdate(C.setNextAction(source, '', 'Next'), update()),
      update('done', 'Finished', 'done'),
    ) + '\nTail';
  const edited = C.editUpdate(original, 'done', 'Revised **result**\n[[Material]]');
  assert.deepEqual(
    C.readNote(edited).updates.find((u) => u.id === 'done'),
    update('done', 'Revised **result**\n[[Material]]', 'done'),
  );
  assert.equal(C.readNote(edited).nextAction, 'Next');
  assert.ok(edited.endsWith('\nTail'));
  const removed = C.removeUpdate(edited, 'done');
  assert.deepEqual(C.readNote(removed).updates, [update()]);
  assert.equal(C.readNote(removed).nextAction, 'Next');
});

test('CRLF managed sections and comment edits preserve content without marker artifacts', () => {
  const original = C.appendUpdate(
    C.setNextAction(source, '', 'Next'),
    update('done', 'Old', 'done'),
  ).replace(/\n/g, '\r\n');
  const result = C.editUpdate(original, 'done', 'New\n[[Research]]');
  const note = C.readNote(result);
  assert.equal(note.nextAction, 'Next');
  assert.deepEqual(note.updates, [update('done', 'New\n[[Research]]', 'done')]);
  assert.equal(note.head, C.readNote(original).head);
});

test('invalid ids, timestamps, kinds and reserved markers are rejected before serialization', () => {
  for (const id of ['', null, 'two words', 'x -->\n### injected', 'bad/id'])
    assert.throws(() => C.appendUpdate(source, { ...update(), id }), /BAD_UPDATE_ID/);
  for (const at of ['', null, 'not-a-date', '2026-10-18 12:00:00'])
    assert.throws(() => C.appendUpdate(source, { ...update(), at }), /BAD_TIMESTAMP/);
  assert.throws(() => C.appendUpdate(source, { ...update(), kind: 'unknown' }), /BAD_UPDATE_KIND/);
  assert.throws(() => C.setNextAction(source, '', C.NEXT_END), /RESERVED_MARKER/);
  assert.throws(() => C.appendUpdate(source, update('safe', C.NEXT_START)), /RESERVED_MARKER/);
  assert.throws(
    () =>
      C.completeNextAction(C.setNextAction(source, '', 'Next'), 'Next', {
        id: 'bad id',
        at: '2026-10-18',
      }),
    /BAD_UPDATE_ID/,
  );
});

test('malformed or repeated control blocks remain readable but mutations refuse to swallow content', () => {
  const broken = [
    [source + C.START + '\nunfinished', 'HISTORY_FORMAT'],
    [source + C.END, 'HISTORY_FORMAT'],
    [C.appendUpdate(source, update()) + '\n' + C.START, 'HISTORY_FORMAT'],
    [source + C.NEXT_START + '\nunfinished', 'NEXT_FORMAT'],
    [source + C.NEXT_END, 'NEXT_FORMAT'],
    [C.setNextAction(source, '', 'One') + nextSection('Two'), 'NEXT_FORMAT'],
    [source + `${C.NEXT_START}\nWrong heading\nNext\n${C.NEXT_END}`, 'NEXT_FORMAT'],
    [C.appendUpdate(source, update()).replace('<!-- pb:end -->', ''), 'HISTORY_FORMAT'],
    [
      C.appendUpdate(source, update()).replace('pb:entry comment', 'pb:entry bad/id'),
      'HISTORY_FORMAT',
    ],
    [
      C.appendUpdate(source, update()).replace(C.END, nextSection('Nested') + '\n' + C.END),
      'NEXT_FORMAT',
    ],
  ];
  for (const [text, error] of broken) {
    assert.doesNotThrow(() => C.readNote(text));
    for (const mutate of [
      () => C.appendUpdate(text, update('new')),
      () => C.setNextAction(text, '', 'Next'),
      () => C.replaceBody(text, C.readNote(text).body, 'Replace'),
    ])
      assert.throws(mutate, new RegExp(error));
  }
  assert.ok(C.readNote(broken[0][0]).body.includes('unfinished'));
});

test('restoring a completed step removes only its done entry and retains links and dates elsewhere', () => {
  const done = update('done', 'Revisit [[Plan]]', 'done');
  const original = C.appendUpdate(C.appendUpdate(source, update()), done) + '\nUnmanaged tail';
  const restored = C.restoreCompletedAction(original, done);
  const note = C.readNote(restored);
  assert.equal(note.nextAction, done.text);
  assert.deepEqual(note.updates, [update()]);
  assert.equal(note.head, C.readNote(original).head);
  assert.ok(restored.endsWith('\nUnmanaged tail'));
});
test('restoring completed steps never silently overwrites a newer next step or edited message', () => {
  const done = update('done', 'Original action', 'done'),
    original = C.setNextAction(C.appendUpdate(source, done), '', 'New action');
  assert.throws(() => C.restoreCompletedAction(original, done), /NEXT_CONFLICT/);
  assert.equal(
    C.readNote(C.restoreCompletedAction(original, done, 'New action')).nextAction,
    'Original action',
  );
  assert.throws(
    () => C.restoreCompletedAction(C.editUpdate(original, 'done', 'Changed'), done, 'New action'),
    /UPDATE_CONFLICT/,
  );
  assert.throws(
    () => C.restoreCompletedAction(C.appendUpdate(source, update()), update()),
    /UPDATE_CONFLICT/,
  );
  for (const changed of [
    { ...done, text: 'Changed' },
    { ...done, at: '2026-10-19T12:00:00Z' },
    { ...done, kind: undefined },
  ])
    assert.throws(() => C.assertUpdate(original, changed), /UPDATE_CONFLICT/);
});

test('next-step checkboxes merge independent checks while preserving comments and description', () => {
  const step = '- [ ] First [[Research]]\n- [ ] Second',
    base = C.appendUpdate(C.setNextAction(source, '', step), update());
  const first = C.setNextChecklistItem(base, step, 0, true),
    both = C.setNextChecklistItem(first, step, 1, true);
  const note = C.readNote(both);
  assert.equal(note.nextAction, '- [x] First [[Research]]\n- [x] Second');
  assert.deepEqual(note.updates, [update()]);
  assert.equal(note.body.trimEnd(), C.readNote(base).body.trimEnd());
  assert.equal(note.head, C.readNote(base).head);
  assert.equal(
    C.readNote(C.setNextChecklistItem(both, note.nextAction, 0, false)).nextAction,
    '- [ ] First [[Research]]\n- [x] Second',
  );
});
test('stale checklist clicks cannot overwrite changed or removed next steps', () => {
  const step = '- [ ] Original',
    changed = C.setNextAction(source, '', '- [ ] Revised');
  assert.throws(() => C.setNextChecklistItem(changed, step, 0, true), /NEXT_CONFLICT/);
  assert.throws(() => C.setNextChecklistItem(source, step, 0, true), /NEXT_CONFLICT/);
  const code = '```md\n- [ ] Example\n```\n- [ ] Real',
    base = C.setNextAction(source, '', code);
  assert.throws(() => C.setNextChecklistItem(base, code, 1, true), /CHECKLIST_CHANGED/);
  assert.equal(
    C.readNote(C.setNextChecklistItem(base, code, 3, true)).nextAction,
    code.replace('[ ] Real', '[x] Real'),
  );
});
test('Enter continues checklists, exits empty items, and leaves plain text and code alone', () => {
  const step = '- [ ] First';
  assert.deepEqual(C.continueChecklist(step, step.length), {
    value: step + '\n- [ ] ',
    cursor: 18,
  });
  const empty = '- [ ] First\n- [ ] ';
  assert.deepEqual(C.continueChecklist(empty, empty.length), {
    value: '- [ ] First\n',
    cursor: 12,
  });
  const nested = '  - [x] Child';
  assert.equal(C.continueChecklist(nested, nested.length).value, nested + '\n  - [ ] ');
  assert.equal(C.continueChecklist(step, 0), null);
  assert.equal(C.continueChecklist('Text', 4), null);
  assert.equal(C.continueChecklist('```\n- [ ] Example\n```', 17), null);
});
