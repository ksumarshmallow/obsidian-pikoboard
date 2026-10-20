'use strict';
const C = require('../domain/tasks.js');
const { dueDate } = require('../domain/due-dates.js');

function fileTitle(v) {
  return C.linkTarget(v).split('/').pop();
}
function dateText(v, now = new Date()) {
  if (!v) return 'Due date';
  const d = dueDate(v);
  return !d
    ? v
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
      });
}
function errorMessage(e) {
  if (e.message === 'UPDATE_CONFLICT') return 'This entry changed. Reopen its menu.';
  if (e.message === 'NEXT_CONFLICT')
    return 'The next step changed. Your draft is saved – compare it with the current step.';
  if (e.message === 'HISTORY_FORMAT' || e.message === 'NEXT_FORMAT')
    return 'Could not save because the note structure is damaged. Your draft is saved.';
  if (e.message?.startsWith('INVALID_TAG:'))
    return 'Tags can contain letters, numbers, hyphens, underscores and /.';
  if (e.message === 'BODY_CONFLICT')
    return 'The text changed in another window. Your version is saved as a draft.';
  return e.message || String(e);
}

module.exports = { fileTitle, dateText, errorMessage };
