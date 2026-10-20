'use strict';
const {
  Plugin,
  parseYaml,
  stringifyYaml,
  Notice,
  TFile,
  MarkdownRenderer,
  Component,
  normalizePath,
} = require('obsidian');
const C = require('./domain/tasks.js');
const S = require('./storage/task-store.js');
const B = require('./storage/board-store.js');
const { SavedFilters } = require('./storage/saved-filters.js');
const { TaskTemplates } = require('./storage/task-templates.js');
const { TaskActions } = require('./features/tasks/task-actions.js');
const { renamedProject } = require('./domain/filters.js');
const { el, icon } = require('./ui/elements.js');
const { errorMessage } = require('./ui/format.js');
const { appearanceController } = require('./ui/appearance.js');
const { actionMenu, closeActionMenu } = require('./ui/menus.js');
const {
  AskModal,
  DeleteConfirmModal,
  ConfirmMessageModal,
  EditMessageModal,
  PickModal,
} = require('./ui/dialogs.js');
const { JournalModel } = require('./features/journal/model.js');
const { CreateBoardModal } = require('./features/boards/create-board.js');
const { BoardView, BoardFileView } = require('./features/boards/board-view.js');
const { PikoBoardSettings } = require('./settings/settings-tab.js');
const { TYPE, FILE_TYPE, CONTEXT, statuses } = require('./constants.js');

class PikoBoard extends Plugin {
  async onload() {
    this.data = Object.assign({ drafts: {} }, await this.loadData());
    this.data.drafts ||= {};
    this.data.order ||= [];
    this.dataSave = Promise.resolve();
    this.savedFilters = new SavedFilters(this);
    this.queues = new Map();
    this.modals = new Set();
    this.noteCache = new Map();
    this.journals = new Map();
    this.disposed = false;
    this.boards = new B.BoardStore(this.app);
    await this.boards.list();
    await this.initializeStorage();
    this.actions = new TaskActions(this, (action) => this.showTaskUndo(action));
    this.templates = new TaskTemplates(this, parseYaml, stringifyYaml);
    this.appearance = appearanceController(this);
    this.addSettingTab(new PikoBoardSettings(this.app, this));
    this.registerView(TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(FILE_TYPE, (leaf) => new BoardFileView(leaf, this));
    this.registerExtensions(['pikoboard'], FILE_TYPE);
    this.addCommand({ id: 'create-board', name: 'Create board', callback: () => this.newBoard() });
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file && !file.extension && file.children)
          menu.addItem((item) =>
            item
              .setTitle('Create PikoBoard board')
              .setIcon('columns-3')
              .onClick(() => this.newBoard(file.path === '/' ? '' : file.path)),
          );
      }),
    );
    this.addCommand({
      id: 'restore-message',
      name: 'Restore deleted entry',
      callback: () => this.chooseDeletedMessage(),
    });
    this.addCommand({ id: 'open', name: 'Open board', callback: () => this.chooseBoard() });
    this.addCommand({ id: 'all-tasks', name: 'All tasks', callback: () => this.openBoard() });
    this.addCommand({
      id: 'undo-task-action',
      name: 'Undo task action',
      checkCallback: (checking) => {
        if (!this.actions.last) return false;
        if (!checking) this.undoTaskAction();
        return true;
      },
    });
    this.addCommand({
      id: 'create',
      name: 'Create task',
      callback: () => this.createTask(),
    });
    this.addRibbonIcon('columns-3', 'PikoBoard', () => this.chooseBoard());
    const refresh = (file) => {
      if (file?.path) this.noteCache.delete(file.path);
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(async () => {
        await this.boards.list();
        this.refresh();
      }, 200);
    };
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    for (const ev of ['create', 'modify', 'delete'])
      this.registerEvent(this.app.vault.on(ev, refresh));
    this.registerEvent(
      this.app.vault.on('rename', (file, old) => {
        this.savedFilters.renameProject(old, file.path).catch(console.error);
        for (const entry of this.data.deletedUpdates || [])
          if (entry.path === old) entry.path = file.path;
        this.data.order = this.data.order.map((p) => (p === old ? file.path : p));
        if (this.data.archiveSchedule?.[old]) {
          this.data.archiveSchedule[file.path] = this.data.archiveSchedule[old];
          delete this.data.archiveSchedule[old];
        }
        this.persist().catch(console.error);
        if (this.data.drafts[old]) {
          this.data.drafts[file.path] = this.data.drafts[old];
          delete this.data.drafts[old];
          this.persist().catch(console.error);
        }
        for (const leaf of this.boardLeaves()) {
          if (leaf.view.filters)
            leaf.view.filters.project = renamedProject(leaf.view.filters.project || '', old, file.path);
          for (const key of ['recent', 'expanded'])
            if (leaf.view[key]?.delete(old)) leaf.view[key].add(file.path);
        }
        this.noteCache.delete(old);
        refresh(file);
      }),
    );
    this.register(() => {
      this.disposed = true;
      clearTimeout(this.refreshTimer);
    });
    const maintain = async () => {
      try {
        await this.boards.list();
        await this.store.archiveExpired();
      } catch (e) {
        console.error('PikoBoard archive:', e);
      }
      this.refresh();
    };
    this.registerInterval(window.setInterval(maintain, 60000));
    this.app.workspace.onLayoutReady(maintain);
  }
  onunload() {
    this.taskUndoNotice?.hide();
    closeActionMenu();
    for (const modal of this.modals) modal.shutdown();
    for (const model of this.journals.values()) model.save().catch(console.error);
  }
  persist() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.dataSave = this.dataSave.catch(() => {}).then(() => this.saveData(snapshot));
    return this.dataSave;
  }
  draft(path) {
    return this.data.drafts[path] || {};
  }
  setDraft(path, patch) {
    const next = { ...this.draft(path), ...patch };
    for (const key of Object.keys(next))
      if (next[key] === undefined || next[key] === null) delete next[key];
    if (Object.keys(next).length) this.data.drafts[path] = next;
    else delete this.data.drafts[path];
    return this.persist();
  }
  async initializeStorage() {
    if (!this.data.settings) {
      this.data.settings = S.settingsFrom();
      this.data.archiveSchedule ||= {};
      await this.persist();
    }
    this.settings = S.settingsFrom(this.data.settings);
    this.store = new S.TaskStore({
      app: this.app,
      settings: () => this.settings,
      getBoard: (id) => this.boards?.get(id)?.board,
      parseYaml,
      stringifyYaml,
      archiveSchedule: this.data.archiveSchedule || {},
      onScheduleChange: () => this.persist(),
    });
  }
  saveSettings(patch) {
    // Build each patch from the last committed settings, including when two
    // controls change before the preceding disk write has finished.
    this.settingsSave = (this.settingsSave || Promise.resolve()).catch(() => {}).then(async () => {
      const next = S.settingsFrom({ ...this.settings, ...patch });
      const previous = this.data.settings;
      this.data.settings = next;
      try {
        await this.persist();
      } catch (error) {
        if (this.data.settings === next) this.data.settings = previous;
        throw error;
      }
      this.settings = next;
      this.appearance?.apply();
      // Changing colours must not rebuild cards or interrupt an active editor.
      if (Object.keys(patch).some((key) => key !== 'appearance')) this.refresh();
    });
    return this.settingsSave;
  }
  api() {
    return this.store;
  }
  systemTags() {
    return this.store.systemTags();
  }
  boardLeaves() {
    return [
      ...this.app.workspace.getLeavesOfType(TYPE),
      ...this.app.workspace.getLeavesOfType(FILE_TYPE),
    ];
  }
  async openBoard(file) {
    let leaf = this.boardLeaves().find((l) =>
      file ? l.view.file?.path === file.path : !l.view.file,
    );
    if (file && !leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file);
    }
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  newBoard(folder) {
    const active = this.app.workspace.getActiveFile();
    new CreateBoardModal(
      this,
      folder ?? this.settings.boardsFolder ?? active?.parent?.path ?? '',
    ).open();
  }
  async chooseBoard() {
    const boards = await this.boards.list();
    new PickModal(
      this.app,
      [
        { label: 'All tasks', all: true },
        ...boards.map(({ file }) => ({ label: file.basename + ' · ' + file.parent.path, file })),
        { label: '+ Create board', create: true },
      ],
      (item) => (item.create ? this.newBoard() : this.openBoard(item.file)),
      'Open board',
    ).open();
  }
  columnsFor(task) {
    return task?.board ? this.boards?.get(task.board)?.board.columns || [] : statuses;
  }
  storageFolder(kind, task) {
    const board = task?.board && this.boards?.get(task.board)?.board;
    return board?.[kind] ?? this.settings[kind];
  }
  async moveToBoard(file, destination) {
    const task = await this.store.get(file.path);
    if (!task) throw new Error('Task not found');
    const columns = destination ? this.boards.get(destination)?.board.columns : statuses;
    if (!columns?.length) throw new Error('Board not found');
    const column =
      columns.find((c) => c.value === task.status) ||
      columns.find(
        (c) => c.kind === (task.isCompleted ? 'done' : task.isActive ? 'active' : 'todo'),
      ) ||
      columns[0];
    await this.patch(file, { board: destination || '', status: column.value });
  }
  async chooseTaskBoard(file) {
    const boards = await this.boards.list();
    new PickModal(
      this.app,
      [
        { label: 'No board', id: '' },
        ...boards.map(({ file, board }) => ({
          label: file.basename + ' · ' + file.parent.path,
          id: board.id,
        })),
      ],
      (item) => this.moveToBoard(file, item.id),
      'Move to board',
    ).open();
  }
  async addExisting(view) {
    const tasks = (await this.tasks()).filter((t) => !t.board && !t.archived);
    new PickModal(
      this.app,
      tasks.map((t) => ({ label: t.title, path: t.path })),
      (item) =>
        this.moveToBoard(this.app.vault.getAbstractFileByPath(item.path), view.boardConfig.id),
      'Add unassigned task',
    ).open();
  }
  refresh() {
    if (this.disposed) return;
    for (const leaf of this.boardLeaves()) leaf.view.refresh?.().catch(console.error);
    for (const m of this.modals) m.syncExternal().catch(console.error);
  }
  queue(file, job) {
    const prev = this.queues.get(file) || Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    this.queues.set(file, next);
    next
      .finally(() => {
        if (this.queues.get(file) === next) this.queues.delete(file);
      })
      .catch(() => {});
    return next;
  }
  patch(file, patch) {
    return this.actions.patch(file, patch);
  }
  showTaskUndo(action) {
    this.taskUndoNotice?.hide();
    if (!action || this.disposed) return;
    const fragment = document.createDocumentFragment();
    el(fragment, 'span', '', action.label + ' · ' + action.title);
    const undo = el(fragment, 'button', 'pb-notice-undo', 'Undo');
    undo.onclick = async () => {
      undo.disabled = true;
      await this.undoTaskAction(action);
      undo.disabled = false;
    };
    this.taskUndoNotice = new Notice(fragment, 8000);
  }
  async undoTaskAction(action = this.actions.last) {
    try {
      if (await this.actions.undo(action)) new Notice('Action undone', 2500);
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }
  async note(file) {
    const mtime = file.stat.mtime,
      cached = this.noteCache.get(file.path);
    if (cached?.mtime === mtime) return cached.value;
    const value = C.readNote(await this.app.vault.read(file));
    if (file.stat.mtime === mtime) this.noteCache.set(file.path, { mtime, value });
    return value;
  }
  writeBody(file, expected, next) {
    return this.queue(file, async () => {
      let result;
      await this.app.vault.process(file, (text) => {
        result = C.replaceBody(text, expected, next);
        return result;
      });
      this.noteCache.delete(file.path);
      this.refresh();
      return C.readNote(result);
    });
  }
  addUpdate(file, text, id = crypto.randomUUID()) {
    return this.queue(file, async () => {
      const update = { id, at: new Date().toISOString(), text };
      await this.app.vault.process(file, (source) => C.appendUpdate(source, update));
      this.noteCache.delete(file.path);
      this.refresh();
    });
  }
  journal(file) {
    this.journals ||= new Map();
    if (!this.journals.has(file)) this.journals.set(file, new JournalModel(this, file));
    return this.journals.get(file);
  }
  setNext(file, expected, next) {
    return this.queue(file, async () => {
      await this.app.vault.process(file, (source) => C.setNextAction(source, expected, next));
      this.noteCache.delete(file.path);
      this.refresh();
    });
  }
  toggleNextCheck(file, expected, line, checked) {
    return this.queue(file, async () => {
      let result;
      await this.app.vault.process(file, (source) => {
        result = C.setNextChecklistItem(source, expected, line, checked);
        return result;
      });
      this.noteCache.delete(file.path);
      this.refresh();
      return C.readNote(result).nextAction;
    });
  }
  completeNext(file, expected, update) {
    return this.queue(file, async () => {
      await this.app.vault.process(file, (source) =>
        C.completeNextAction(source, expected, update),
      );
      this.noteCache.delete(file.path);
      this.refresh();
    });
  }
  mutateMessage(file, expected, change) {
    return this.queue(file, async () => {
      await this.app.vault.process(file, (source) => {
        C.assertUpdate(source, expected);
        return change(source);
      });
      this.noteCache.delete(file.path);
      this.refresh();
    });
  }
  editMessage(file, update, text) {
    return this.mutateMessage(file, update, (source) => C.editUpdate(source, update.id, text));
  }
  async deleteMessage(file, update) {
    const record = { id: crypto.randomUUID(), path: file.path, update: { ...update } };
    await this.queue(file, async () => {
      C.assertUpdate(await this.app.vault.read(file), update);
      this.data.deletedUpdates ||= [];
      this.data.deletedUpdates.push(record);
      await this.persist();
      await this.app.vault.process(file, (source) => {
        C.assertUpdate(source, update);
        return C.removeUpdate(source, update.id);
      });
      this.noteCache.delete(file.path);
      this.refresh();
    });
    const fragment = document.createDocumentFragment();
    el(fragment, 'span', '', 'Entry deleted. ');
    const undo = el(fragment, 'button', 'pb-notice-undo', 'Restore');
    undo.onclick = async () => {
      undo.disabled = true;
      try {
        await this.restoreDeletedMessage(record);
        notice.hide();
      } catch (e) {
        undo.disabled = false;
        new Notice(errorMessage(e));
      }
    };
    const notice = new Notice(fragment, 10000);
  }
  async restoreDeletedMessage(record) {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error('Restore the task file from trash first.');
    await this.queue(file, async () => {
      await this.app.vault.process(file, (source) => {
        if (C.readNote(source).updates.some((u) => u.id === record.update.id))
          C.assertUpdate(source, record.update);
        return C.appendUpdate(source, record.update);
      });
      this.data.deletedUpdates = (this.data.deletedUpdates || []).filter((x) => x.id !== record.id);
      await this.persist();
      this.noteCache.delete(file.path);
      this.refresh();
    });
  }
  chooseDeletedMessage() {
    const items = (this.data.deletedUpdates || [])
      .map((record) => ({
        record,
        label:
          record.path.split('/').pop().replace(/\.md$/, '') +
          ' · ' +
          record.update.text.slice(0, 100),
      }))
      .reverse();
    if (!items.length) {
      new Notice('No deleted entries');
      return;
    }
    new PickModal(
      this.app,
      items,
      async (item) => {
        await this.restoreDeletedMessage(item.record);
        new Notice('Entry restored');
      },
      'Restore entry',
    ).open();
  }
  async restoreStep(file, update) {
    const expected = (await this.note(file)).nextAction || '';
    if (expected && expected !== update.text) {
      const yes = await new Promise((resolve) =>
        new ConfirmMessageModal(
          this.app,
          'Replace next step?',
          expected + ' → ' + update.text,
          'Replace',
          resolve,
        ).open(),
      );
      if (!yes) return;
    }
    await this.mutateMessage(file, update, (source) =>
      C.restoreCompletedAction(source, update, expected),
    );
    this.journal(file).syncNext(update.text);
  }
  messageActions(file, update, rendered) {
    const items = [
      {
        label: 'Copy',
        icon: 'copy',
        action: async () => {
          await navigator.clipboard.writeText(
            rendered.innerText || rendered.textContent || update.text,
          );
          new Notice('Copied', 1500);
        },
      },
      {
        label: 'Edit',
        icon: 'pencil',
        action: () =>
          new EditMessageModal(this.app, update, (text) =>
            this.editMessage(file, update, text),
          ).open(),
      },
    ];
    if (update.kind === 'done')
      items.push({
        label: 'Restore as next step',
        icon: 'undo-2',
        action: () => this.restoreStep(file, update),
      });
    items.push(
      { separator: true },
      {
        label: 'Delete entry',
        icon: 'trash-2',
        danger: true,
        action: async () => {
          const yes = await new Promise((resolve) =>
            new ConfirmMessageModal(
              this.app,
              'Delete entry?',
              update.text,
              'Delete',
              resolve,
              true,
            ).open(),
          );
          if (yes) await this.deleteMessage(file, update);
        },
      },
    );
    return items;
  }
  messageMenu(event, file, update, rendered, anchor) {
    event.preventDefault();
    event.stopPropagation();
    return actionMenu(
      anchor,
      this.messageActions(file, update, rendered),
      'Entry actions',
      this.app,
    );
  }

  uploadMaterial(callback, source) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.oncancel = () => resolve();
      input.onchange = async () => {
        try {
          const task = source && (await this.store.get(source.path));
          const folder = this.storageFolder('attachmentsFolder', task);
          await this.ensureFolder(folder);
          for (const f of input.files) {
            const safe = f.name.replace(/[\\/:*?"<>|]/g, '_');
            let path = normalizePath((folder ? folder + '/' : '') + safe),
              n = 2;
            const dot = safe.lastIndexOf('.');
            while (this.app.vault.getAbstractFileByPath(path))
              path = normalizePath(
                (folder ? folder + '/' : '') +
                  (dot > 0 ? safe.slice(0, dot) : safe) +
                  ' ' +
                  n++ +
                  (dot > 0 ? safe.slice(dot) : ''),
              );
            await callback(await this.app.vault.createBinary(path, await f.arrayBuffer()));
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }
  async tasks() {
    const system = new Set(this.systemTags().map((t) => t.toLowerCase()));
    return (await this.api().tasks.list()).map((t) => ({
      ...t,
      projects: (t.projects || []).map((p) => {
        const f = this.app.metadataCache.getFirstLinkpathDest(C.linkTarget(p), t.path);
        return f ? '[[' + f.path.replace(/\.md$/, '') + ']]' : p;
      }),
      visibleTags: C.tagList(t.tags).filter((t) => !system.has(t.toLowerCase())),
    }));
  }
  projects() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.type === 'project')
      .map((f) => ({ label: f.basename, value: f.path.replace(/\.md$/, '') }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  }
  async ensureFolder(path) {
    let part = '';
    for (const name of path.split('/').filter(Boolean)) {
      part = part ? part + '/' + name : name;
      if (!this.app.vault.getAbstractFileByPath(part)) await this.app.vault.createFolder(part);
    }
  }
  async uniqueNote(folder, title, content) {
    await this.ensureFolder(folder);
    let safe = title
      .replace(/[\\/:*?"<>|\[\]#^]/g, ' ')
      .trim()
      .slice(0, 140);
    if (!safe || /^\.+$/.test(safe)) safe = 'Note';
    let path = normalizePath((folder ? folder + '/' : '') + safe + '.md'),
      n = 2;
    while (this.app.vault.getAbstractFileByPath(path))
      path = normalizePath((folder ? folder + '/' : '') + safe + ' ' + n++ + '.md');
    return this.app.vault.create(path, content);
  }
  async createTask(status, view) {
    view ||=
      this.app.workspace.getActiveViewOfType?.(BoardFileView) ||
      this.app.workspace.getActiveViewOfType?.(BoardView);
    if (!view) {
      await this.openBoard();
      view = this.boardLeaves().find((l) => !l.view.file)?.view;
    }
    if (view?.beginCreate) {
      const columns = view.boardColumns();
      status ??=
        columns.find((c) => c.kind === (view.mode === 'focus' ? 'active' : 'todo'))?.value ??
        columns[0].value;
      if (!view.boardColumns().some((c) => c.value === status))
        status = view.boardColumns()[0].value;
      view.beginCreate(status);
    }
  }
  async requestTrash(file) {
    const confirmed = await new Promise((resolve) =>
      new DeleteConfirmModal(this.app, file.basename, resolve).open(),
    );
    return confirmed ? this.trashTask(file) : false;
  }
  async trashTask(file) {
    for (const modal of [...this.modals])
      if (modal.file === file && !(await modal.close())) return false;
    await this.queue(file, () => this.app.fileManager.trashFile(file));
    const journal = this.journals?.get(file);
    if (journal) journal.deleted = true;
    this.journals?.delete(file);
    delete this.data.drafts[file.path];
    await this.persist();
    this.noteCache.delete(file.path);
    this.refresh();
    new Notice('Task deleted');
    return true;
  }
  newTemplate(file) {
    new AskModal(this.app, 'Template name', 'Template name', async (name) => {
      const template = await this.templates.save(name, file);
      await this.openFile(template);
      new Notice('Template saved');
    }, file?.basename || '').open();
  }
  async submitTask(title, status, view, templateFile) {
    const board = view?.boardConfig?.id || '';
    const projects =
      view?.mode !== 'focus' && view?.filters.project && view.filters.project !== '__none__'
        ? ['[[' + view.filters.project + ']]'] : [];
    // Load the current template before creating anything; failed reads leave no empty task.
    const template = templateFile ? await this.templates.read(templateFile) : { tags: [], details: '' };
    const task = await this.api().tasks.create(
      {
        title,
        status,
        board,
        projects,
        tags: template.tags,
        details: template.details,
      },
      CONTEXT,
    );
    // Once the file exists, a layout/settings failure must not invite a duplicate submission.
    this.data.order = C.moveTaskOrder(this.data.order, task.path);
    view?.recent.add(task.path);
    try {
      await this.persist();
      if (view) {
        await view.refresh();
        view.revealNew(task.path);
      }
    } catch (error) {
      new Notice('Task created. Reopen the board to refresh it.');
      console.error(error);
    }
    this.refresh();
    return this.app.vault.getAbstractFileByPath(task.path);
  }
  chooseProject(callback) {
    new PickModal(
      this.app,
      [
        { label: 'No project', value: '' },
        ...this.projects(),
        { label: '+ New project', create: true },
      ],
      async (i) => {
        if (i.create)
          new AskModal(this.app, 'Project', 'Project name', async (title) => {
            const safe = title.replace(/[\\/:*?"<>|\[\]#^]/g, ' ').trim();
            if (!safe || /^\.+$/.test(safe)) throw new Error('Enter a project name');
            const f = await this.uniqueNote(
              [this.settings.projectsFolder, safe].filter(Boolean).join('/'),
              safe,
              '---\ntype: project\n---\n\n',
            );
            await callback('[[' + f.path.replace(/\.md$/, '') + ']]');
          }).open();
        else await callback(i.value ? '[[' + i.value + ']]' : '');
      },
      'Project',
    ).open();
  }
  chooseNote(source, callback) {
    const items = this.app.vault
      .getFiles()
      .filter((f) => f.path !== source.path)
      .map((f) => ({ label: f.basename + ' · ' + (f.parent?.path || ''), file: f }));
    items.unshift({ label: '+ New research note', create: true });
    new PickModal(
      this.app,
      items,
      async (i) => {
        if (i.create)
          new AskModal(this.app, 'Research note', 'Name', async (title) =>
            callback(await this.uniqueNote(this.settings.materialsFolder, title, '')),
          ).open();
        else await callback(i.file);
      },
      'Materials',
    ).open();
  }
  openFile(file) {
    return this.app.workspace.getLeaf('tab').openFile(file);
  }
  disposeHistory(container) {
    container._seq = (container._seq || 0) + 1;
    container._component?.unload();
    container._component = null;
    container._pendingComponent?.unload();
    container._pendingComponent = null;
  }
  async history(container, file, owner) {
    const seq = (container._seq || 0) + 1;
    container._seq = seq;
    const { updates, nextAction } = await this.note(file);
    if (seq !== container._seq || !container.isConnected) return;
    this.journal(file).syncNext(nextAction || '');
    const signature = JSON.stringify([updates, new Date().toDateString()]);
    if (container._signature === signature) return;
    const scroll = container.scrollTop,
      stage = document.createElement('div');
    container._pendingComponent?.unload();
    const component = new Component();
    component.load();
    container._pendingComponent = component;
    let committed = false;
    try {
      let previous = '';
      for (const u of updates) {
        if (seq !== container._seq) return;
        const date = new Date(u.at),
          group = date.toDateString();
        if (group !== previous) {
          el(el(stage, 'div', 'pb-day'), 'span', '', C.dayLabel(date));
          previous = group;
        }
        const message = el(stage, 'div', 'pb-message');
        if (u.kind === 'done') el(message, 'span', 'pb-message-kind', 'Done');
        const text = el(message, 'div', 'pb-message-text markdown-rendered');
        await MarkdownRenderer.render(this.app, u.text, text, file.path, component);
        if (seq !== container._seq) return;
        text.querySelectorAll('a.internal-link').forEach(
          (a) =>
            (a.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.app.workspace.openLinkText(
                a.dataset.href || a.getAttribute('href'),
                file.path,
                true,
              );
            }),
        );
        text.querySelectorAll('input[type=checkbox]').forEach((box) => {
          box.disabled = true;
        });
        const footer = el(message, 'div', 'pb-message-footer');
        const time = el(
          footer,
          'time',
          '',
          date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        );
        time.dateTime = u.at;
        time.setAttribute('aria-label', date.toLocaleString('en-GB'));
        const menuButton = icon(footer, 'ellipsis', 'Entry actions', (e) =>
          this.messageMenu(e, file, u, text, menuButton),
        );
        menuButton.classList.add('pb-message-menu');
        menuButton.setAttribute('aria-haspopup', 'menu');
        menuButton.setAttribute('aria-expanded', 'false');
        message.oncontextmenu = (e) => this.messageMenu(e, file, u, text, menuButton);
      }
      if (seq !== container._seq || !container.isConnected) return;
      container._component?.unload();
      container._component = component;
      container.replaceChildren(...stage.childNodes);
      container.classList.toggle('pb-empty-feed', !updates.length);
      container._signature = signature;
      container.scrollTop = scroll;
      committed = true;
    } finally {
      if (!committed) component.unload();
      if (container._pendingComponent === component) container._pendingComponent = null;
    }
  }
}

module.exports = PikoBoard;
