const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/domain/tasks.js');
const original =
  '---\ntags: [task]\nstatus: open\n---\n\n# Исследование\n- [ ] Первый\n\n[[Связанная заметка]]\n';
const u = (id, at, text) => ({ id, at, text });
test('history stays in the same Markdown, newest first, preserves frontmatter and links', () => {
  let s = C.appendUpdate(original, u('a', '2026-10-17T12:00:00Z', 'Сравнение вариантов'));
  s = C.appendUpdate(s, u('b', '2026-10-18T10:00:00Z', 'Результат проверки'));
  const n = C.readNote(s);
  assert.equal(n.head, C.frontmatter(original).head);
  assert.ok(n.body.includes('[[Связанная заметка]]'));
  assert.deepEqual(
    n.updates.map((x) => x.id),
    ['b', 'a'],
  );
  assert.equal(C.appendUpdate(s, u('b', '2026-10-18T10:00:00Z', 'Результат проверки')), s);
});
test('editing body retains history and any text after managed history', () => {
  const s = C.appendUpdate(original, u('a', '2026-10-17T12:00:00Z', 'Текст')) + '\nОстальное';
  const n = C.readNote(s);
  const out = C.replaceBody(s, n.body, 'Новый текст\n\n');
  assert.equal(C.readNote(out).updates[0].text, 'Текст');
  assert.ok(out.endsWith('Остальное'));
});
test('body saves merge concurrent history but reject concurrent body edits', () => {
  const before = C.readNote(original).body;
  const fresh = C.appendUpdate(original, u('a', '2026-10-17T12:00:00Z', 'Новая запись'));
  assert.ok(C.replaceBody(fresh, before, 'Изменено').includes('Новая запись'));
  assert.throws(
    () => C.replaceBody(original + 'Внешняя правка', before, 'Изменено'),
    /BODY_CONFLICT/,
  );
});
test('checkbox toggling preserves fenced examples and nested checks', () => {
  const s = '```md\n- [ ] пример\n```\n- [ ] первый\n  - [X] второй';
  assert.equal(C.toggleChecklist(s, 1, false), s.replace('[X]', '[ ]'));
  assert.throws(() => C.toggleChecklist(s, 7, true), /CHECKLIST_CHANGED/);
});
test('project and tag filters combine, unassigned supported, colors stable', () => {
  const t = { projects: ['[[Проекты/Демо-проект]]'], visibleTags: ['ресерч', 'личное'] };
  assert.equal(C.taskMatches(t, { project: 'Проекты/Демо-проект', tags: ['ресерч'] }), true);
  assert.equal(C.taskMatches(t, { project: 'Проекты/Демо-проект', tags: ['быт'] }), false);
  assert.equal(
    C.taskMatches({ projects: [], visibleTags: [] }, { project: '__none__', tags: ['__none__'] }),
    true,
  );
  assert.equal(C.colorFor('Демо-проект'), C.colorFor('Демо-проект'));
});
test('relative day labels handle midnight and month changes', () => {
  const now = new Date(2026, 9, 1, 0, 5);
  assert.equal(C.dayLabel(new Date(2026, 8, 30, 23), now), 'Yesterday');
  assert.equal(C.dayLabel(now, now), 'Today');
});
test('history refuses control markers; missing closing marker is not swallowed', () => {
  assert.throws(
    () => C.appendUpdate(original, u('a', '2026-10-17', '<!-- pb:end -->')),
    /RESERVED/,
  );
  const s = original + C.START + '\nunfinished';
  assert.equal(C.readNote(s).body, C.frontmatter(s).body);
});
