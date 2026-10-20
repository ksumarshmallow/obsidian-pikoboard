'use strict';
const { taskMatches, linkTarget } = require('./tasks.js');

function normalizeFilters(value = {}) {
  const list = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : [];
  return {
    project: typeof value?.project === 'string' ? value.project : '',
    tags: list(value?.tags),
    statuses: list(value?.statuses),
    query: typeof value?.query === 'string' ? value.query : '',
  };
}
function searchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е');
}
function hasFilters(value) {
  const f = normalizeFilters(value);
  return !!(f.project || f.tags.length || f.statuses.length || f.query.trim());
}
function sameFilters(a, b) {
  const key = (value) => {
    const f = normalizeFilters(value);
    return JSON.stringify([f.project, f.tags.sort(), f.statuses.sort(), searchText(f.query).trim()]);
  };
  return key(a) === key(b);
}
function matchesTask(task, filters, note = {}, status = task.status) {
  if (!taskMatches(task, filters)) return false;
  if (filters.statuses?.length && !filters.statuses.includes(status)) return false;
  const words = searchText(filters.query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const content = searchText([
    task.title || task.path?.split('/').pop()?.replace(/\.md$/, ''),
    ...(task.projects || []).map((p) => linkTarget(p).split('/').pop()),
    ...(task.visibleTags || []).map((t) => '#' + t),
    note.body, note.tail, note.nextAction, ...(note.updates || []).map((u) => u.text),
  ].join('\n'));
  return words.every((word) => content.includes(word));
}
function renamedProject(project, oldPath, newPath) {
  const old = oldPath.replace(/\.md$/, ''), next = newPath.replace(/\.md$/, '');
  return project === old ? next : project.startsWith(old + '/') ? next + project.slice(old.length) : project;
}

module.exports = { normalizeFilters, hasFilters, sameFilters, matchesTask, renamedProject };
