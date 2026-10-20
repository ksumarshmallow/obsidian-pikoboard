'use strict';

const EXTENSION = 'pikoboard';
const DEFAULT_COLUMNS = [
  { value: 'open', label: 'backlog', kind: 'todo', color: '#9ba8c4', opacity: 0.05, icon: 'inbox' },
  {
    value: 'in-progress',
    label: 'in progress',
    kind: 'active',
    color: '#b3a2ed',
    opacity: 0.06,
    icon: 'circle-dashed',
  },
  {
    value: 'done',
    label: 'done',
    kind: 'done',
    color: '#83aa96',
    opacity: 0.05,
    icon: 'circle-check',
  },
];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function folderPath(value) {
  if (typeof value !== 'string') throw new Error('Enter a folder path as text.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('The path contains invalid characters.');
  const path = value.trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!path) return '';
  if (
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part.startsWith('.') || /[:*?"<>|]/.test(part))
  )
    throw new Error('Choose a folder inside the vault without hidden folders or “..”.');
  return path;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(value))
    throw new Error(`Invalid ${name} ID.`);
  return value;
}
function normalizeBoard(input) {
  if (!object(input)) throw new Error('Invalid board file.');
  const board = { ...input, id: identifier(input.id, 'board') };
  if (!Array.isArray(input.columns) || !input.columns.length || input.columns.length > 30)
    throw new Error('A board must have 1 to 30 columns.');
  const seen = new Set();
  board.columns = input.columns.map((inputColumn) => {
    if (!object(inputColumn)) throw new Error('Invalid column.');
    const column = { ...inputColumn, value: identifier(inputColumn.value, 'column') };
    if (seen.has(column.value)) throw new Error('Column IDs must be unique.');
    seen.add(column.value);
    if (typeof column.label !== 'string' || !column.label.trim())
      throw new Error('Enter a column name.');
    column.label = column.label.trim();
    column.kind ??= 'todo';
    if (!['todo', 'active', 'done'].includes(column.kind))
      throw new Error('Unknown column role.');
    column.color ??= '#a7a1db';
    if (typeof column.color !== 'string' || !/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(column.color))
      throw new Error('Use #RRGGBB for the column color.');
    column.color = column.color.toLowerCase();
    if (column.color.length === 4)
      column.color = '#' + [...column.color.slice(1)].map((c) => c + c).join('');
    column.opacity ??= 0.06;
    if (
      typeof column.opacity !== 'number' ||
      !Number.isFinite(column.opacity) ||
      column.opacity < 0 ||
      column.opacity > 1
    )
      throw new Error('Color opacity must be between 0 and 1.');
    column.icon ??= '';
    if (typeof column.icon !== 'string' || column.icon.length > 80)
      throw new Error('Invalid column icon.');
    column.icon = column.icon.trim();
    return column;
  });
  for (const key of ['tasksFolder', 'attachmentsFolder'])
    if (board[key] !== undefined) board[key] = folderPath(board[key]);
  return board;
}
function parseBoard(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch (_) {
    throw new Error('The board file could not be read. Its JSON is invalid.');
  }
  return normalizeBoard(data);
}
function serializeBoard(board) {
  return JSON.stringify(normalizeBoard(board), null, 2) + '\n';
}
function makeBoard(options = {}) {
  return normalizeBoard({
    ...options,
    id: options.id ?? globalThis.crypto.randomUUID(),
    columns: options.columns || DEFAULT_COLUMNS,
  });
}
function copyRecord(record) {
  return record ? { file: record.file, board: JSON.parse(JSON.stringify(record.board)) } : null;
}
function boardFile(file) {
  if (!file || file.extension !== EXTENSION)
    throw new Error('Choose a .pikoboard file.');
}

class BoardStore {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.errors = [];
    this.creating = Promise.resolve();
    this.scanSeq = 0;
    this.scanning = Promise.resolve([]);
  }
  list() {
    const work = this.scan(++this.scanSeq);
    this.scanning = work;
    return work;
  }
  async scan(sequence) {
    const next = new Map(),
      duplicates = new Set(),
      errors = [];
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.extension === EXTENSION)
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files) {
      try {
        const board = parseBoard(await this.app.vault.read(file)),
          existing = next.get(board.id);
        if (existing || duplicates.has(board.id)) {
          if (existing) {
            errors.push({
              path: existing.file.path,
              error: new Error('Multiple boards use this ID.'),
            });
            next.delete(board.id);
          }
          duplicates.add(board.id);
          throw new Error('Multiple boards use this ID.');
        }
        next.set(board.id, { file, board });
      } catch (error) {
        errors.push({ path: file.path, error });
      }
    }
    if (sequence !== this.scanSeq) return this.scanning;
    this.cache = next;
    this.errors = errors;
    return [...next.values()].map(copyRecord);
  }
  remember(record) {
    this.cache.set(record.board.id, record);
    // In-flight reads may predate this write. They must not roll the index back.
    this.scanSeq++;
    this.scanning = Promise.resolve([...this.cache.values()].map(copyRecord));
  }
  get(id) {
    const record = this.cache.get(id);
    if (record && this.app.vault.getAbstractFileByPath(record.file.path) !== record.file) {
      this.cache.delete(id);
      return null;
    }
    return copyRecord(record);
  }
  async load(file) {
    boardFile(file);
    // Refresh the complete identity index: copied files must not share tasks accidentally.
    await this.list();
    const failed = this.errors.find((entry) => entry.path === file.path);
    if (failed) throw failed.error;
    const record = [...this.cache.values()].find((entry) => entry.file.path === file.path);
    if (!record) throw new Error('Board not found.');
    return copyRecord(record);
  }
  create(input) {
    const work = this.creating.catch(() => {}).then(() => this.createFile(input));
    this.creating = work;
    return work;
  }
  async createFile({ title, folder = '', id, ...options }) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a board name.');
    if (/[\u0000-\u001f\u007f]/.test(title))
      throw new Error('The name contains invalid characters.');
    if (title.trim().startsWith('.')) throw new Error('Enter a name without a hidden path.');
    const safe = title
      .trim()
      .replace(/[\\/:*?"<>|\[\]#^]/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim()
      .slice(0, 140);
    if (!safe || safe.startsWith('.')) throw new Error('Enter a name without a hidden path.');
    const base = folderPath(folder),
      board = makeBoard({ ...options, ...(id !== undefined ? { id } : {}) });
    await this.list();
    if (this.cache.has(board.id)) throw new Error('A board with this ID already exists.');
    // Duplicate invalid identities are excluded from cache but still reserve their ID.
    for (const issue of this.errors) {
      const file = this.app.vault.getAbstractFileByPath(issue.path);
      if (!file) continue;
      let existing;
      try {
        existing = parseBoard(await this.app.vault.read(file));
      } catch (_) {
        continue;
      }
      if (existing.id === board.id) throw new Error('A board with this ID already exists.');
    }
    let current = '';
    for (const part of base.split('/').filter(Boolean)) {
      current = current ? current + '/' + part : part;
      const found = this.app.vault.getAbstractFileByPath(current);
      if (found && typeof found.extension === 'string')
        throw new Error('A file already exists at this folder path.');
      if (!found) await this.app.vault.createFolder(current);
    }
    for (let n = 1; ; n++) {
      const path = (base ? base + '/' : '') + safe + (n === 1 ? '' : ' ' + n) + '.' + EXTENSION;
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      let file;
      try {
        file = await this.app.vault.create(path, serializeBoard(board));
      } catch (error) {
        if (this.app.vault.getAbstractFileByPath(path)) continue;
        throw error;
      }
      const record = { file, board };
      this.remember(record);
      return copyRecord(record);
    }
  }
  async save(file, board, expectedText) {
    boardFile(file);
    const requested = normalizeBoard(board);
    let saved;
    await this.app.vault.process(file, (text) => {
      if (expectedText !== undefined && text !== expectedText)
        throw new Error(
          'The board has changed. Reopen settings before saving your changes.',
        );
      const current = parseBoard(text);
      if (current.id !== requested.id) throw new Error('The ID of an existing board cannot be changed.');
      // Missing known overrides means “inherit the plugin default”, unlike future metadata.
      for (const key of ['tasksFolder', 'attachmentsFolder'])
        if (!Object.prototype.hasOwnProperty.call(requested, key)) delete current[key];
      const oldColumns = new Map(current.columns.map((column) => [column.value, column]));
      saved = normalizeBoard({
        ...current,
        ...requested,
        columns: requested.columns.map((column) => ({
          ...oldColumns.get(column.value),
          ...column,
        })),
      });
      return serializeBoard(saved);
    });
    const record = { file, board: saved };
    this.remember(record);
    return copyRecord(record);
  }
}

module.exports = {
  EXTENSION,
  DEFAULT_COLUMNS,
  normalizeBoard,
  parseBoard,
  serializeBoard,
  makeBoard,
  folderPath,
  BoardStore,
};
