'use strict';

// Storage uses only Obsidian's Vault and YAML APIs. No community plugin is loaded.
const FIELDS = {
  title: 'title',
  status: 'status',
  due: 'due',
  projects: 'projects',
  dateCreated: 'dateCreated',
  dateModified: 'dateModified',
  completedDate: 'completedDate',
  archiveTag: 'archived',
};
const DEFAULT_SETTINGS = {
  tasksFolder: 'Задачи',
  taskTag: 'task',
  taskIdentificationMethod: 'tag',
  taskPropertyName: '',
  taskPropertyValue: '',
  fieldMapping: FIELDS,
  completedStatuses: ['done'],
  autoArchive: true,
  archiveDays: 7,
};
const STATUSES = [
  { value: 'open', label: 'backlog', isCompleted: false },
  { value: 'in-progress', label: 'in progress', isCompleted: false },
  { value: 'done', label: 'done', isCompleted: true },
];
function strings(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}
function tags(value) {
  return [
    ...new Set(
      strings(value)
        .flatMap((v) => v.split(/[\s,]+/))
        .map((v) => v.replace(/^#/, ''))
        .filter(Boolean),
    ),
  ];
}
function folderPath(value) {
  const path = String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  if (!path) return '';
  if (
    path.startsWith('/') ||
    path.split('/').some((p) => !p || p.startsWith('.') || /[:*?"<>|]/.test(p))
  )
    throw new Error('Укажите папку внутри хранилища, например «Задачи».');
  return path;
}
function settingsFrom(saved = {}) {
  const result = {
    ...DEFAULT_SETTINGS,
    ...saved,
    fieldMapping: { ...FIELDS, ...saved.fieldMapping },
  };
  result.tasksFolder = folderPath(result.tasksFolder);
  result.taskTag = tags(result.taskTag)[0] || 'task';
  result.archiveDays =
    Number.isFinite(Number(result.archiveDays)) && Number(result.archiveDays) > 0
      ? Number(result.archiveDays)
      : 7;
  result.completedStatuses = [...new Set(['done', ...strings(result.completedStatuses)])];
  return result;
}
function migrateSettings(legacy = {}) {
  const completed = (legacy.customStatuses || []).filter((s) => s.isCompleted);
  const done = completed.find((s) => s.value === 'done') || completed[0];
  const mapped = {};
  for (const key of Object.keys(FIELDS)) {
    const value = legacy.fieldMapping?.[key];
    if (typeof value === 'string' && value.trim()) mapped[key] = value;
  }
  const pick = {};
  for (const key of [
    'tasksFolder',
    'taskTag',
    'taskIdentificationMethod',
    'taskPropertyName',
    'taskPropertyValue',
  ])
    if (typeof legacy[key] === 'string') pick[key] = legacy[key];
  return settingsFrom({
    ...pick,
    fieldMapping: mapped,
    completedStatuses: completed.map((s) => s.value),
    ...(done
      ? {
          autoArchive: !!done.autoArchive,
          archiveDays: done.autoArchiveDelay > 0 ? done.autoArchiveDelay / 1440 : 7,
        }
      : {}),
  });
}
function splitDocument(text, parseYaml) {
  const match = text.match(/^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (/^\uFEFF?---(?:\r?\n|$)/.test(text))
      throw new Error('Некорректные свойства заметки. Файл не изменён.');
    return { data: {}, body: text, bom: '' };
  }
  const data = parseYaml(match[2]) ?? {};
  if (typeof data !== 'object' || Array.isArray(data))
    throw new Error('Некорректные свойства заметки. Файл не изменён.');
  return { data, body: text.slice(match[0].length), bom: match[1] };
}
function dateValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? undefined : String(value);
}
function completionTime(value) {
  const date = dateValue(value);
  // Legacy TaskNotes dates have no time: wait until the end of that local day.
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date + 'T23:59:59.999' : date);
}
class TaskStore {
  constructor({
    app,
    settings,
    parseYaml,
    stringifyYaml,
    now = () => new Date(),
    archiveSchedule = {},
    onScheduleChange = async () => {},
  }) {
    Object.assign(this, {
      app,
      settings,
      parseYaml,
      stringifyYaml,
      now,
      archiveSchedule,
      onScheduleChange,
    });
    this.creating = Promise.resolve();
    this.tasks = {
      list: () => this.list(),
      get: (path) => this.get(path),
      create: (input) => this.create(input),
      update: (path, patch) => this.update(path, patch),
      archive: (path, archived) => this.update(path, { archived }),
      clearDue: (path) => this.update(path, { due: null }),
    };
    this.catalog = { statuses: () => STATUSES.map((s) => ({ ...s })) };
  }
  get config() {
    return settingsFrom(this.settings());
  }
  systemTags() {
    const s = this.config;
    return [s.taskTag, s.fieldMapping.archiveTag];
  }
  isTask(data) {
    const s = this.config;
    if (s.taskIdentificationMethod === 'property' && s.taskPropertyName)
      return String(data[s.taskPropertyName] ?? '') === String(s.taskPropertyValue);
    return tags(data.tags).some((t) => t.toLowerCase() === s.taskTag.toLowerCase());
  }
  fromData(file, data) {
    if (!this.isTask(data)) return null;
    const s = this.config,
      f = s.fieldMapping,
      rawStatus = data[f.status];
    return {
      path: file.path,
      title:
        typeof data[f.title] === 'string' && data[f.title].trim() ? data[f.title] : file.basename,
      status: s.completedStatuses.includes(rawStatus)
        ? 'done'
        : rawStatus === 'in-progress'
          ? rawStatus
          : 'open',
      tags: tags(data.tags),
      projects: strings(data[f.projects]),
      due: dateValue(data[f.due]),
      dateCreated: dateValue(data[f.dateCreated]),
      dateModified: dateValue(data[f.dateModified]),
      completedDate: dateValue(data[f.completedDate]),
      archived: tags(data.tags).some((t) => t.toLowerCase() === f.archiveTag.toLowerCase()),
    };
  }
  async get(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'md') return null;
    return this.fromData(file, splitDocument(await this.app.vault.read(file), this.parseYaml).data);
  }
  async list() {
    const result = [],
      files = this.app.vault.getMarkdownFiles();
    this.errors = [];
    for (let start = 0; start < files.length; start += 16) {
      await Promise.all(
        files.slice(start, start + 16).map(async (file) => {
          try {
            const data = splitDocument(await this.app.vault.cachedRead(file), this.parseYaml).data;
            const task = this.fromData(file, data);
            if (task) result.push(task);
          } catch (error) {
            this.errors.push({ path: file.path, error });
          }
        }),
      );
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  serialize(data, body, bom = '') {
    return bom + '---\n' + this.stringifyYaml(data).trimEnd() + '\n---\n' + body;
  }
  create(input) {
    const work = this.creating.catch(() => {}).then(() => this.createFile(input));
    this.creating = work;
    return work;
  }
  async createFile(input) {
    const s = this.config,
      f = s.fieldMapping,
      title = String(input.title || '').trim();
    if (!title) throw new Error('Введите название задачи');
    if (!STATUSES.some((x) => x.value === input.status)) throw new Error('Неизвестный статус');
    let folder = '';
    for (const name of s.tasksFolder.split('/').filter(Boolean)) {
      folder = folder ? folder + '/' + name : name;
      const existing = this.app.vault.getAbstractFileByPath(folder);
      if (existing?.extension) throw new Error('Путь к папке занят файлом');
      if (!existing) await this.app.vault.createFolder(folder);
    }
    const safe =
      title
        .replace(/[\\/:*?"<>|\[\]#^]/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 140) || 'Задача';
    const now = this.now().toISOString();
    const data = {
      [f.title]: title,
      [f.status]: input.status,
      [f.dateCreated]: now,
      [f.dateModified]: now,
    };
    const taskTags = tags(input.tags).filter(
      (tag) => tag.toLowerCase() !== f.archiveTag.toLowerCase(),
    );
    if (s.taskIdentificationMethod === 'property' && s.taskPropertyName)
      data[s.taskPropertyName] = s.taskPropertyValue;
    else taskTags.unshift(s.taskTag);
    data.tags = [...new Set(taskTags)];
    if (input.projects?.length) data[f.projects] = strings(input.projects).slice(0, 1);
    if (input.due) data[f.due] = input.due;
    if (input.status === 'done') data[f.completedDate] = now;
    const body = '\n' + (input.details || '');
    for (let n = 1; ; n++) {
      const path = (folder ? folder + '/' : '') + safe + (n === 1 ? '' : ' ' + n) + '.md';
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        const file = await this.app.vault.create(path, this.serialize(data, body));
        return this.fromData(file, data);
      } catch (error) {
        if (!this.app.vault.getAbstractFileByPath(path)) throw error;
      }
    }
  }
  async update(path, patch, guard) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'md') throw new Error('Задача не найдена');
    const s = this.config,
      f = s.fieldMapping;
    let result,
      clearSchedule = false;
    await this.app.vault.process(file, (source) => {
      const { data, body, bom } = splitDocument(source, this.parseYaml);
      const before = this.fromData(file, data);
      if (!before) throw new Error('Задача не найдена');
      if (guard && !guard(before)) {
        result = before;
        return source;
      }
      const now = this.now().toISOString();
      if ('title' in patch) {
        if (typeof patch.title !== 'string' || !patch.title.trim())
          throw new Error('Введите название задачи');
        data[f.title] = patch.title.trim();
      }
      if ('status' in patch) {
        if (!STATUSES.some((x) => x.value === patch.status)) throw new Error('Неизвестный статус');
        data[f.status] = patch.status;
        clearSchedule = patch.status !== before.status;
        if (patch.status === 'done') {
          if (before.status !== 'done' || !data[f.completedDate]) data[f.completedDate] = now;
        } else delete data[f.completedDate];
      }
      if ('due' in patch) {
        if (patch.due) data[f.due] = patch.due;
        else delete data[f.due];
      }
      if ('projects' in patch) {
        const projects = strings(patch.projects).slice(0, 1);
        if (projects.length) data[f.projects] = projects;
        else delete data[f.projects];
      }
      if ('tags' in patch) {
        const system = this.systemTags().map((t) => t.toLowerCase());
        data.tags = [
          ...new Set([
            ...before.tags.filter((t) => system.includes(t.toLowerCase())),
            ...tags(patch.tags).filter((t) => !system.includes(t.toLowerCase())),
          ]),
        ];
      }
      if ('archived' in patch) {
        clearSchedule ||= !patch.archived && before.archived;
        data.tags = tags(data.tags).filter((t) => t.toLowerCase() !== f.archiveTag.toLowerCase());
        if (patch.archived) data.tags.push(f.archiveTag);
        // A restored completed task gets a full grace period instead of immediately vanishing again.
        if (!patch.archived && before.archived && before.status === 'done')
          data[f.completedDate] = now;
      }
      data[f.dateModified] = now;
      result = this.fromData(file, data);
      return this.serialize(data, body, bom);
    });
    if (clearSchedule && this.archiveSchedule[path]) {
      delete this.archiveSchedule[path];
      await this.onScheduleChange();
    }
    return result;
  }
  archiveDeadline(task) {
    const migrated = this.archiveSchedule[task.path];
    const finished = completionTime(task.completedDate);
    // A legacy queue is valid only until the task is completed again.
    if (migrated && Number.isFinite(finished) && finished <= migrated.after) return migrated.after;
    return finished + this.config.archiveDays * 86400000;
  }
  async archiveExpired() {
    if (!this.config.autoArchive || this.archiving) return 0;
    this.archiving = true;
    let count = 0;
    try {
      const now = +this.now();
      const expired = (task) =>
        task.status === 'done' && !task.archived && this.archiveDeadline(task) <= now;
      for (const task of await this.list()) {
        if (expired(task)) {
          const result = await this.update(task.path, { archived: true }, expired);
          if (result.archived) count++;
        }
      }
      return count;
    } finally {
      this.archiving = false;
    }
  }
}
module.exports = {
  TaskStore,
  DEFAULT_SETTINGS,
  FIELDS,
  STATUSES,
  settingsFrom,
  migrateSettings,
  folderPath,
  splitDocument,
  completionTime,
};
