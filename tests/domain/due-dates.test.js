'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { dueDate, dueState } = require('../../src/domain/due-dates.js');
const { duePresentation } = require('../../src/ui/due-date.js');

const task = (due, extra = {}) => ({ due, status: 'open', ...extra });

test('deadlines use local calendar days with a three-day upcoming window', () => {
  const now = new Date(2026, 9, 20, 23, 59, 59);
  for (const [due, state] of [
    ['2026-10-19', 'overdue'], ['2026-10-20', 'today'],
    ['2026-10-21', 'soon'], ['2026-10-23', 'soon'], ['2026-10-24', ''],
  ]) assert.equal(dueState(task(due), now), state, due);
  assert.equal(dueState(task('2026-10-20'), new Date(2026, 9, 21)), 'overdue');
  assert.equal(dueState(task('2027-01-01'), new Date(2026, 11, 30)), 'soon');
  assert.equal(dueState(task('2028-02-29'), new Date(2028, 1, 28)), 'soon');
});

test('missing and invalid dates stay neutral without normalizing impossible dates', () => {
  for (const due of [undefined, null, '', 'not a date', '2026-02-30', '2026-13-01',
    '2026-00-20', '2026-10-00', '2025-02-29', '2026-02-30T12:00:00Z', '2026-10-20Tbad']) {
    assert.equal(dueDate(due), null, String(due));
    assert.equal(dueState(task(due)), '', String(due));
  }
  assert.equal(duePresentation(task('2026-02-30')).text, '2026-02-30');
  assert.equal(duePresentation(task()).text, 'Due date');
});

test('completed and archived tasks remain neutral, including custom completed statuses', () => {
  const now = new Date(2026, 9, 20);
  for (const extra of [{ status: 'done' }, { status: 'released', isCompleted: true }, { archived: true }])
    for (const due of ['2026-10-01', '2026-10-20', '2026-10-21'])
      assert.equal(dueState(task(due, extra), now), '');
  assert.equal(dueState(task('2026-10-01', { status: 'released', isCompleted: false }), now), 'overdue');
});

test('today has a short label and all urgency states have descriptive accessible text', () => {
  const now = new Date(2026, 9, 20);
  const today = duePresentation(task('2026-10-20'), now);
  assert.equal(today.text, 'Today');
  assert.match(today.label, /^Today · 20 Oct/);
  assert.match(duePresentation(task('2026-10-19'), now).label, /^Overdue · 19 Oct/);
  assert.match(duePresentation(task('2026-10-23'), now).label, /^Due soon · 23 Oct/);
  assert.match(duePresentation(task('2026-10-20', { status: 'done' }), now).label, /^Due date · 20 Oct/);
  assert.match(duePresentation(task('2025-12-31'), now).text, /2025/);
});

test('local dates and timestamp labels agree in different time zones and across DST', () => {
  const modulePath = require.resolve('../../src/domain/due-dates.js');
  const uiPath = require.resolve('../../src/ui/due-date.js');
  for (const TZ of ['Europe/Moscow', 'America/Los_Angeles', 'America/New_York', 'Pacific/Auckland']) {
    const script = `
      const { dueState } = require(${JSON.stringify(modulePath)});
      const { duePresentation } = require(${JSON.stringify(uiPath)});
      const assert = require('node:assert/strict');
      const state = (due, now) => dueState({ due }, now);
      assert.equal(state('2026-03-09', new Date(2026, 2, 8, 0, 30)), 'soon');
      assert.equal(state('2026-11-02', new Date(2026, 9, 30, 23, 59)), 'soon');
      assert.equal(state('2026-11-03', new Date(2026, 9, 31)), 'soon');
      assert.equal(state('2026-11-04', new Date(2026, 9, 31)), '');
      const midnight = new Date(2026, 9, 20, 0, 30);
      const sameDay = new Date(2026, 9, 20, 23, 30).toISOString();
      assert.equal(state(sameDay, midnight), 'today');
      assert.match(duePresentation({ due: sameDay }, midnight).label, /20 Oct/);
      assert.equal(state('2026-10-20', midnight), 'today');
    `;
    // The host's timezone is irrelevant to these checks.
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ } });
  }
});
