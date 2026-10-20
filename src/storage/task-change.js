'use strict';

// Receipts contain only changed frontmatter fields, never a copy of the note body.
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function changes(before, after, ignored) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => key !== ignored && !equal(before[key], after[key]))
    .map((key) => ({ key, before: clone(before[key]), after: clone(after[key]) }));
}
function restoreFields(data, fields) {
  for (const field of fields)
    if (!equal(data[field.key], field.after))
      throw new Error('Эти поля уже изменились. Отмена не затронула задачу.');
  const restored = { ...data };
  for (const field of fields) {
    if (field.before === undefined) delete restored[field.key];
    else restored[field.key] = clone(field.before);
  }
  return restored;
}
module.exports = { changes, restoreFields, equal };
