'use strict';
const START = '<!-- pikoboard:updates:start -->';
const END = '<!-- pikoboard:updates:end -->';
const NEXT_START = '<!-- pikoboard:next:start -->';
const NEXT_END = '<!-- pikoboard:next:end -->';
const entryPattern = () =>
  /<!-- pb:entry ([\w-]+) ([^\s]+)(?: (done))? -->\r?\n### [^\r\n]+\r?\n([\s\S]*?)\r?\n<!-- pb:end -->/g;
function frontmatter(text) {
  const match = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? { head: match[0], body: text.slice(match[0].length) } : { head: '', body: text };
}
function managedBlock(text, startMarker, endMarker) {
  const starts = [
    ...text.matchAll(new RegExp(startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
  ].map((m) => m.index);
  const ends = [
    ...text.matchAll(new RegExp(endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
  ].map((m) => m.index);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) return { invalid: true };
  return {
    start: starts[0],
    end: ends[0] + endMarker.length,
    section: text.slice(starts[0], ends[0] + endMarker.length),
  };
}
function blocks(body) {
  const history = managedBlock(body, START, END),
    next = managedBlock(body, NEXT_START, NEXT_END);
  const overlap =
    history &&
    !history.invalid &&
    next &&
    !next.invalid &&
    next.start < history.end &&
    history.start < next.end;
  return { history, next, overlap };
}
function splitHistory(body) {
  const block = managedBlock(body, START, END);
  if (!block || block.invalid) return { body, section: '', tail: '', updates: [] };
  const { start, end, section } = block,
    pattern = entryPattern();
  const updates = [];
  let m;
  while ((m = pattern.exec(section)))
    if (Number.isFinite(Date.parse(m[2])))
      updates.push({ id: m[1], at: m[2], text: m[4], ...(m[3] ? { kind: m[3] } : {}) });
  updates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { body: body.slice(0, start), section, tail: body.slice(end), updates };
}
function readNote(text) {
  const fm = frontmatter(text),
    parts = splitHistory(fm.body),
    { next, overlap } = blocks(fm.body);
  let nextAction = '',
    nextSection = '';
  if (next && !next.invalid && !overlap) {
    const match = next.section.match(
      /^<!-- pikoboard:next:start -->\r?\n## Следующий шаг\r?\n([\s\S]*?)\r?\n<!-- pikoboard:next:end -->$/,
    );
    if (match) {
      nextAction = match[1].trim();
      nextSection = next.section;
      if (parts.body.includes(nextSection)) parts.body = parts.body.replace(nextSection, '');
      else parts.tail = parts.tail.replace(nextSection, '');
    }
  }
  return { head: fm.head, ...parts, nextAction, nextSection };
}
function validNote(text) {
  const fm = frontmatter(text),
    { history, next, overlap } = blocks(fm.body),
    note = readNote(text);
  if (history?.invalid) throw new Error('HISTORY_FORMAT');
  if (next?.invalid || overlap || (next && !note.nextSection)) throw new Error('NEXT_FORMAT');
  if (history) {
    const entries = [...history.section.matchAll(entryPattern())];
    const starts = (history.section.match(/<!-- pb:entry\b/g) || []).length,
      ends = (history.section.match(/<!-- pb:end -->/g) || []).length;
    if (
      !history.section.startsWith(START + '\n## Обновления\n') &&
      !history.section.startsWith(START + '\r\n## Обновления\r\n')
    )
      throw new Error('HISTORY_FORMAT');
    if (
      starts !== entries.length ||
      ends !== entries.length ||
      entries.some((m) => !Number.isFinite(Date.parse(m[2])))
    )
      throw new Error('HISTORY_FORMAT');
    if (new Set(entries.map((m) => m[1])).size !== entries.length)
      throw new Error('HISTORY_FORMAT');
  }
  return { fm, history, next, note };
}
function validText(value, emptyError) {
  if (typeof value !== 'string' || (emptyError && !value.trim()))
    throw new Error(emptyError || 'BAD_NEXT_ACTION');
  if (value.includes('<!-- pb:') || value.includes('<!-- pikoboard:'))
    throw new Error('RESERVED_MARKER');
  return value.trim();
}
function validUpdate(update) {
  if (!update || typeof update.id !== 'string' || !/^[\w-]+$/.test(update.id))
    throw new Error('BAD_UPDATE_ID');
  if (
    typeof update.at !== 'string' ||
    /\s/.test(update.at) ||
    !Number.isFinite(Date.parse(update.at))
  )
    throw new Error('BAD_TIMESTAMP');
  if (update.kind !== undefined && update.kind !== 'done') throw new Error('BAD_UPDATE_KIND');
}
function replaceBody(text, expected, next) {
  const { note } = validNote(text);
  if (note.body.trimEnd() !== expected.trimEnd()) throw new Error('BODY_CONFLICT');
  let body = next;
  if (note.nextSection) body += (body.endsWith('\n\n') ? '' : '\n\n') + note.nextSection + '\n\n';
  if (note.section) body += (body.endsWith('\n\n') ? '' : '\n\n') + note.section + note.tail;
  return note.head + body;
}
function appendUpdate(text, update) {
  validUpdate(update);
  const content = validText(update.text, 'EMPTY_UPDATE');
  const { fm, history, note: n } = validNote(text);
  const heading = new Date(update.at).toLocaleString('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  const entry = `<!-- pb:entry ${update.id} ${update.at}${update.kind ? ' ' + update.kind : ''} -->\n### ${heading}\n${content}\n<!-- pb:end -->`;
  if (n.updates.some((u) => u.id === update.id)) return text;
  if (history) {
    const i =
      fm.head.length +
      history.start +
      history.section.indexOf('\n', history.section.indexOf('## Обновления')) +
      1;
    return text.slice(0, i) + '\n' + entry + '\n' + text.slice(i);
  }
  return text.replace(/\s*$/, '') + `\n\n${START}\n## Обновления\n\n${entry}\n${END}\n`;
}
function editUpdate(text, id, nextText) {
  return changeUpdate(text, id, validText(nextText, 'EMPTY_UPDATE'));
}
function removeUpdate(text, id) {
  return changeUpdate(text, id, null);
}
function changeUpdate(text, id, nextText) {
  const { fm, history } = validNote(text);
  let found = false;
  const section = (history?.section || '').replace(entryPattern(), (whole, key, at, kind, body) => {
    if (key !== id) return whole;
    found = true;
    if (nextText === null) return '';
    const start = whole.indexOf('\n', whole.indexOf('\n') + 1) + 1,
      end = whole.lastIndexOf('\n<!-- pb:end -->');
    const contentEnd = whole[end - 1] === '\r' ? end - 1 : end;
    return whole.slice(0, start) + nextText + whole.slice(contentEnd);
  });
  if (!found) throw new Error('UPDATE_NOT_FOUND');
  const offset = fm.head.length;
  return text.slice(0, offset + history.start) + section + text.slice(offset + history.end);
}
function setNextAction(text, expected, nextAction) {
  const value = validText(nextAction),
    { fm, history, next, note } = validNote(text);
  if (note.nextAction === value) return text;
  if (note.nextAction !== expected) throw new Error('NEXT_CONFLICT');
  const section = value ? `${NEXT_START}\n## Следующий шаг\n${value}\n${NEXT_END}` : '';
  if (next)
    return (
      text.slice(0, fm.head.length + next.start) + section + text.slice(fm.head.length + next.end)
    );
  const index = history ? fm.head.length + history.start : text.length;
  const before = text.slice(0, index),
    after = text.slice(index);
  return before + (before.endsWith('\n\n') ? '' : '\n\n') + section + '\n\n' + after;
}
function completeNextAction(text, expected, update) {
  validUpdate({ ...update, kind: 'done' });
  const { note } = validNote(text);
  if (note.updates.some((u) => u.id === update.id)) return text;
  if (note.nextAction !== expected) throw new Error('NEXT_CONFLICT');
  if (!note.nextAction) throw new Error('EMPTY_NEXT_ACTION');
  return setNextAction(
    appendUpdate(text, { ...update, text: note.nextAction, kind: 'done' }),
    note.nextAction,
    '',
  );
}
function assertUpdate(text, expected) {
  const { note } = validNote(text),
    current = note.updates.find((u) => u.id === expected.id);
  if (
    !current ||
    current.text !== expected.text ||
    current.at !== expected.at ||
    current.kind !== expected.kind
  )
    throw new Error('UPDATE_CONFLICT');
  return current;
}
function restoreCompletedAction(text, expected, expectedNext = '') {
  const current = assertUpdate(text, expected),
    { note } = validNote(text);
  if (current.kind !== 'done') throw new Error('UPDATE_CONFLICT');
  if (note.nextAction !== expectedNext) throw new Error('NEXT_CONFLICT');
  return setNextAction(removeUpdate(text, current.id), expectedNext, current.text);
}
function scanChecklist(body) {
  const lines = body.split('\n'),
    items = [];
  let fence = null,
    comment = false,
    listIndents = [];
  for (let line = 0; line < lines.length; line++) {
    const source = lines[line].replace(/\r$/, '');
    const content = source.replace(/^(?: {0,3}>[ \t]?)+/, '');
    if (fence) {
      const close = content.match(/^\s*(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (comment) {
      if (content.includes('-->')) comment = false;
      continue;
    }
    if (content.includes('<!--')) {
      comment = !content.slice(content.indexOf('<!--') + 4).includes('-->');
      continue;
    }
    const indentation = content.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const list = content.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/);
    // Four-space standalone examples are indented code, while nested list items
    // retain their parent list context. Keep this conservative to avoid editing code.
    if (indentation >= 4 && !listIndents.some((parent) => parent < indentation)) continue;
    if (list) {
      listIndents = listIndents.filter((parent) => parent < indentation);
      listIndents.push(indentation);
    } else if (content.trim() && listIndents.length && indentation <= listIndents[0])
      listIndents = [];
    const open = content.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    const m = lines[line].match(
      /^([ \t]*(?:(?:>[ \t]*)+)?(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])([ \t]*)(.*?)(\r?)$/,
    );
    if (m) items.push({ line, text: m[5], checked: m[2].toLowerCase() === 'x', match: m });
  }
  return { lines, items, fence, comment };
}
function parseChecklist(body) {
  return scanChecklist(body).items.map(({ line, text, checked }) => ({ line, text, checked }));
}
function checklistText(text) {
  if (typeof text !== 'string' || /[\r\n]/.test(text)) throw new Error('CHECKLIST_TEXT_MULTILINE');
  return text;
}
function setChecklistItem(body, line, patch) {
  const { lines, items } = scanChecklist(body),
    item = items.find((i) => i.line === line);
  if (!item) throw new Error('CHECKLIST_CHANGED');
  const m = item.match,
    text = patch.text === undefined ? m[5] : checklistText(patch.text);
  lines[line] =
    m[1] +
    (patch.checked === undefined ? m[2] : patch.checked ? 'x' : ' ') +
    m[3] +
    (m[4] || (text ? ' ' : '')) +
    text +
    m[6];
  return lines.join('\n');
}
function addChecklistItem(body, text = '', afterLine) {
  checklistText(text);
  const state = scanChecklist(body),
    eol = body.includes('\r\n') ? '\r\n' : '\n';
  if (afterLine === undefined) {
    if (state.fence || state.comment) throw new Error('UNCLOSED_MARKDOWN_BLOCK');
    return body + (body && !body.endsWith('\n') ? eol : '') + '- [ ] ' + text + eol;
  }
  const item = state.items.find((i) => i.line === afterLine);
  if (!item) throw new Error('CHECKLIST_CHANGED');
  const prefix = state.lines[afterLine].match(/^([ \t]*(?:>[ \t]*)*)/)[1];
  state.lines.splice(afterLine + 1, 0, prefix + '- [ ] ' + text + (eol === '\r\n' ? '\r' : ''));
  return state.lines.join('\n');
}
function removeChecklistItem(body, line) {
  const { lines, items } = scanChecklist(body);
  if (!items.some((i) => i.line === line)) throw new Error('CHECKLIST_CHANGED');
  lines.splice(line, 1);
  return lines.join('\n');
}
function toggleChecklist(body, index, checked) {
  const item = parseChecklist(body)[index];
  if (!item) throw new Error('CHECKLIST_CHANGED');
  return setChecklistItem(body, item.line, { checked });
}
function setNextChecklistItem(text, expected, line, checked) {
  const actual = readNote(text).nextAction;
  const shape = (value) =>
    parseChecklist(value).reduce(
      (body, item) => setChecklistItem(body, item.line, { checked: false }),
      value,
    );
  if (shape(actual) !== shape(expected)) throw new Error('NEXT_CONFLICT');
  return setNextAction(text, actual, setChecklistItem(actual, line, { checked }));
}
function continueChecklist(body, from, to = from) {
  const start = body.lastIndexOf('\n', from - 1) + 1,
    end = body.indexOf('\n', from),
    line = body.slice(0, start).split('\n').length - 1;
  const item = parseChecklist(body).find((i) => i.line === line);
  if (!item || to > (end < 0 ? body.length : end)) return null;
  const marker = body
    .slice(start, end < 0 ? body.length : end)
    .match(/^([ \t]*(?:>[ \t]*)*)(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]*/);
  if (!marker || from < start + marker[0].length) return null;
  const prefix = marker[1];
  if (!item.text.trim()) {
    const value = body.slice(0, start) + prefix + body.slice(end < 0 ? body.length : end);
    return { value, cursor: start + prefix.length };
  }
  const insert = '\n' + prefix + '- [ ] ';
  return { value: body.slice(0, from) + insert + body.slice(to), cursor: from + insert.length };
}

// One shared drain promise: blur, autosave, close and checklist actions all join it.
class BodySession {
  constructor(body, write) {
    this.value = body;
    this.baseline = body;
    this.savedValue = body;
    this.write = write;
    this.pending = null;
  }
  get dirty() {
    return this.value !== this.savedValue;
  }
  set(body) {
    this.value = body;
    return this.value;
  }
  update(transform) {
    this.set(transform(this.value));
    return this.flush();
  }
  reset(body) {
    if (this.dirty || this.pending) throw new Error('DIRTY_SESSION');
    this.value = this.baseline = this.savedValue = body;
  }
  flush() {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve(this.baseline);
    const pending = Promise.resolve().then(async () => {
      try {
        while (this.dirty) {
          const next = this.value,
            result = await this.write(this.baseline, next);
          this.baseline = typeof result === 'string' ? result : (result?.body ?? next);
          this.savedValue = next;
        }
        return this.baseline;
      } finally {
        if (this.pending === pending) this.pending = null;
      }
    });
    this.pending = pending;
    return pending;
  }
}
function linkTarget(value) {
  if (typeof value !== 'string') return '';
  const wiki = value.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
  return (wiki ? wiki[1] : value).replace(/\.md$/, '');
}
function tagList(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : String(value || '').split(/[,\s]+/))
        .map((s) => String(s).replace(/^#+/, '').trim())
        .filter(Boolean),
    ),
  ];
}
function taskTags(input, existing, system) {
  const tokens = (value) =>
    (Array.isArray(value) ? value : value instanceof Set ? [...value] : [value])
      .flatMap((v) => String(v ?? '').split(/[,\s]+/))
      .map((v) => v.replace(/^#+/, '').normalize('NFC'))
      .filter(Boolean);
  const key = (tag) => tag.toLocaleLowerCase('ru-RU');
  const protectedTags = new Set(tokens(system).map(key)),
    seen = new Set(),
    result = [];
  const add = (tag) => {
    const k = key(tag);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(tag);
    }
  };
  // System flags are derived from the existing task, never from user input.
  for (const tag of tokens(existing)) if (protectedTags.has(key(tag))) add(tag);
  for (const tag of tokens(input)) {
    if (protectedTags.has(key(tag))) continue;
    if (!/^[\p{L}\p{M}\p{N}_-]+(?:\/[\p{L}\p{M}\p{N}_-]+)*$/u.test(tag) || /^\p{N}+$/u.test(tag)) {
      const error = new Error(
        'Некорректный тег «' +
          tag +
          '». Используйте буквы, цифры, дефис, подчёркивание или / между частями; тег не может состоять только из цифр.',
      );
      error.code = 'INVALID_TAG';
      throw error;
    }
    add(tag);
  }
  return result;
}
function taskMatches(task, filters) {
  const project = linkTarget((task.projects || [])[0]);
  if (filters.project === '__none__' && project) return false;
  if (filters.project && filters.project !== '__none__' && project !== filters.project)
    return false;
  const tags = task.visibleTags || [];
  return (
    !filters.tags?.length ||
    filters.tags.every((t) => (t === '__none__' ? tags.length === 0 : tags.includes(t)))
  );
}
function colorFor(value) {
  let n = 0;
  for (const c of value) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % 6;
}
function dayLabel(date, now = new Date()) {
  const a = new Date(date),
    b = new Date(now);
  const day = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day(a) === day(b)) return 'Сегодня';
  b.setDate(b.getDate() - 1);
  if (day(a) === day(b)) return 'Вчера';
  return a.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(a.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
function orderedTasks(tasks, order = []) {
  const rank = new Map(order.map((p, i) => [p, i]));
  return [...tasks].sort((a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity));
}
function moveTaskOrder(paths, path, anchor = null, after = false) {
  const next = [...new Set(paths)].filter((p) => p !== path);
  if (anchor === path) return [...new Set(paths)];
  const index = anchor ? next.indexOf(anchor) : -1;
  next.splice(index < 0 ? 0 : index + (after ? 1 : 0), 0, path);
  return next;
}
module.exports = {
  orderedTasks,
  moveTaskOrder,
  START,
  END,
  NEXT_START,
  NEXT_END,
  frontmatter,
  splitHistory,
  readNote,
  replaceBody,
  appendUpdate,
  editUpdate,
  removeUpdate,
  assertUpdate,
  setNextAction,
  completeNextAction,
  restoreCompletedAction,
  toggleChecklist,
  parseChecklist,
  setChecklistItem,
  addChecklistItem,
  removeChecklistItem,
  setNextChecklistItem,
  continueChecklist,
  BodySession,
  linkTarget,
  tagList,
  taskTags,
  taskMatches,
  colorFor,
  dayLabel,
};
