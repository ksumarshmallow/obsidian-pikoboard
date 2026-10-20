'use strict';
const { Modal, Menu, Notice, MarkdownRenderer, Component, setIcon } = require('obsidian');
const C = require('../../domain/tasks.js');
const { statusMark, el, button, icon, grow } = require('../../ui/elements.js');
const { fileTitle, errorMessage } = require('../../ui/format.js');
const { duePresentation, applyDueAppearance } = require('../../ui/due-date.js');
const { positionPopup, floatingPopup, picker } = require('../../ui/menus.js');
const { richEditor } = require('../../ui/rich-editor.js');
const { JournalComposer } = require('../journal/composer.js');
const { nextStep } = require('../journal/next-step.js');
const { CONTEXT } = require('../../constants.js');
const { TagEditor } = require('./tag-editor.js');

class TaskModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.closed = false;
    this.renderSeq = 0;
    this.renderComponent = new Component();
    this.renderComponent.load();
    this.propertySave = Promise.resolve();
  }
  async onOpen() {
    this.plugin.modals.add(this);
    this.modalEl.addClass('pb-task-modal');
    this.contentEl.addClass('pikoboard');
    try {
      this.task = await this.plugin.api().tasks.get(this.file.path);
      if (!this.task) throw new Error('Задача не найдена');
      const note = await this.plugin.note(this.file);
      if (this.closed) return;
      let draft = this.plugin.draft(this.file.path);
      if (draft.body !== undefined && draft.body.trimEnd() === note.body.trimEnd()) {
        await this.plugin.setDraft(this.file.path, { body: undefined, bodyBase: undefined });
        draft = this.plugin.draft(this.file.path);
      }
      this.session = new C.BodySession(
        draft.body !== undefined ? (draft.bodyBase ?? note.body) : note.body,
        (expected, next) => this.plugin.writeBody(this.file, expected, next),
      );
      if (draft.body !== undefined) this.session.set(draft.body);
      this.build(draft.update || '');
      if (draft.body !== undefined && note.body.trimEnd() !== this.session.baseline.trimEnd())
        this.fail(new Error('BODY_CONFLICT'));
    } catch (e) {
      new Notice(errorMessage(e));
      super.close();
    }
  }
  build(update) {
    this.contentEl.empty();
    const top = el(this.contentEl, 'div', 'pb-modal-top');
    this.titleInput = el(top, 'textarea', 'pb-title-input');
    this.titleInput.rows = 1;
    this.titleInput.value = this.task.title || this.file.basename;
    this.titleInput.setAttribute('aria-label', 'Название задачи');
    this.titleInput.oninput = () => grow(this.titleInput, 32, 130);
    this.titleInput.onchange = () => this.commitTitle();
    this.titleInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.titleInput.blur();
      }
    };
    const actions = el(top, 'div', 'pb-actions');
    icon(actions, 'trash-2', 'Удалить задачу', () =>
      this.plugin.requestTrash(this.file).catch((e) => this.fail(e)),
    ).classList.add('pb-trash');
    icon(actions, 'ellipsis', 'Действия', (e) => {
      const menu = new Menu();
      menu.addItem((i) =>
        i
          .setTitle('Перенести на доску')
          .setIcon('columns-3')
          .onClick(async () => {
            if (await this.flushSafe()) this.plugin.chooseTaskBoard(this.file);
          }),
      );
      menu.addItem((i) =>
        i.setTitle('Открыть файл').onClick(async () => {
          if (await this.close()) this.plugin.openFile(this.file);
        }),
      );
      menu.addItem((i) =>
        i.setTitle(this.task.archived ? 'Вернуть' : 'В архив').onClick(async () => {
          if (!(await this.flushSafe())) return;
          try {
            await this.plugin.api().tasks.archive(this.file.path, !this.task.archived, CONTEXT);
            this.plugin.refresh();
            await this.close();
          } catch (err) {
            this.fail(err);
          }
        }),
      );
      menu.showAtMouseEvent(e);
    });
    this.props = el(this.contentEl, 'div', 'pb-props');
    this.renderProps();
    this.bodyWrap = el(this.contentEl, 'div', 'pb-body-wrap');
    this.previewEl = el(this.bodyWrap, 'div', 'pb-body-preview markdown-rendered');
    this.editor = el(this.bodyWrap, 'textarea', 'pb-body-editor');
    this.editor.rows = 2;
    this.editor.hidden = false;
    this.editor.value = this.session.value.trim() ? this.session.value : '';
    this.previewEl.hidden = true;
    this.editor.placeholder = 'Описание';
    this.editor.setAttribute('aria-label', 'Описание');
    this.editor.oninput = () => this.inputBody();
    this.editor.onblur = () => this.finishEdit();
    this.editor.onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.editor.blur();
      }
    };
    this.mountRichEditor();
    const tools = el(this.bodyWrap, 'div', 'pb-body-tools');
    this.bodyTools = tools;
    const checklist = button(tools, '', () => this.addChecklist(), 'pb-tool');
    setIcon(el(checklist, 'span'), 'list-todo');
    el(checklist, 'span', '', 'Чеклист');
    const materials = button(
      tools,
      '',
      (e) => {
        const menu = new Menu();
        menu.addItem((i) =>
          i
            .setTitle('Заметка')
            .onClick(() => this.plugin.chooseNote(this.file, (target) => this.attachNote(target))),
        );
        menu.addItem((i) => i.setTitle('Файл').onClick(() => this.upload()));
        menu.showAtMouseEvent(e);
      },
      'pb-tool',
    );
    setIcon(el(materials, 'span'), 'paperclip');
    el(materials, 'span', '', 'Материалы');
    this.saveState = el(tools, 'span', 'pb-save-state');
    this.saveState.setAttribute('role', 'status');
    const journal = el(this.contentEl, 'section', 'pb-journal');
    journal.setAttribute('aria-label', 'Обновления задачи');
    this.nextWrap = nextStep(journal, this.plugin, this.file, () =>
      this.journalComposer.setMode('next'),
    );
    this.feed = el(journal, 'div', 'pb-feed pb-modal-feed');
    this.feed.setAttribute('role', 'region');
    this.feed.setAttribute('aria-label', 'История');
    this.journalComposer = new JournalComposer(this.plugin, this.file, journal);
    this.updateInput = this.journalComposer.input;
    this.send = this.journalComposer.send;
    this.compose = this.journalComposer.form;
    this.preview();
    this.plugin.history(this.feed, this.file, this).catch((e) => this.fail(e));
    grow(this.titleInput, 32, 130);
    grow(this.editor);
  }
  mountRichEditor() {
    const fallback = this.editor;
    const host = el(this.bodyWrap, 'div', 'pb-rich-editor');
    try {
      this.rich = richEditor(this.app, host, this.session.value, () => {
        if (!this.settingRich && this.editor === host) this.inputBody();
      });
      fallback.remove();
      this.editor = host;
      host._rich = true;
      Object.defineProperty(host, 'value', {
        get: () => this.rich.editor.getValue(),
        set: (value) => {
          this.settingRich = true;
          try {
            if (this.rich.editor.getValue() !== value) this.rich.set(value);
          } finally {
            this.settingRich = false;
          }
        },
      });
      host.focus = () => this.rich.editor.focus();
      host.setSelectionRange = (start, end) =>
        this.rich.editor.setSelection(
          this.rich.editor.offsetToPos(start),
          this.rich.editor.offsetToPos(end),
        );
      host.onfocusout = () => this.flushSafe();
    } catch (e) {
      host.remove();
      console.error('Embedded editor unavailable', e);
      new Notice('Редактор Obsidian не загрузился. Описание доступно в текстовом поле.');
    }
  }
  commitTitle() {
    const title = this.titleInput?.value.trim();
    if (!title) {
      if (this.titleInput) this.titleInput.value = this.task.title || this.file.basename;
      return Promise.resolve();
    }
    if (title === this.task.title) return this.propertySave;
    return this.change({ title });
  }
  propsKey(task) {
    return JSON.stringify([
      task.status,
      task.board,
      task.projects,
      task.tags,
      task.due,
      this.plugin.columnsFor(task),
    ]);
  }
  renderProps() {
    this.propsSignature = this.propsKey(this.task);
    const controlsSignature = this.propsKey({ ...this.task, tags: [] });
    if (this.tagEditor && this.controlsSignature === controlsSignature) {
      this.tagEditor.render();
      return;
    }
    this.controlsSignature = controlsSignature;
    const tagFocused = this.tagEditor?.input === document.activeElement;
    const selection = tagFocused ? [this.tagEditor.input.selectionStart, this.tagEditor.input.selectionEnd] : null;
    this.closeCalendar();
    this.props.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
    this.props.replaceChildren();
    const propertyRow = (label) => {
      const row = el(this.props, 'div', 'pb-property-row');
      el(row, 'span', 'pb-property-label', label);
      return el(row, 'div', 'pb-property-value');
    };
    const columns = this.plugin.columnsFor(this.task);
    const statusButton = picker(
      propertyRow('Status'),
      columns.find((s) => s.value === this.task.status)?.label || this.task.status,
      'Статус',
      columns.map((s) => ({
        value: s.value,
        label: s.label,
        selected: s.value === this.task.status,
        icon: s.icon,
      })),
      (i) => this.change({ status: i.value }),
      'pb-chip pb-status',
    );
    const mark = columns.find((s) => s.value === this.task.status)?.icon;
    if (mark) {
      const statusIcon = el(statusButton, 'span', 'pb-status-icon');
      statusMark(statusIcon, mark);
      statusIcon.setAttribute('aria-hidden', 'true');
      statusButton.prepend(statusIcon);
    }
    const p = this.task.projects?.[0],
      file = p && this.app.metadataCache.getFirstLinkpathDest(C.linkTarget(p), this.file.path),
      key = file ? file.path.replace(/\.md$/, '') : C.linkTarget(p || '');
    const b = button(
      propertyRow('Project'),
      '',
      () => this.plugin.chooseProject((link) => this.change({ projects: link ? [link] : [] })),
      'pb-chip pb-picker ' + (p ? 'pb-project pb-color-' + C.colorFor(key) : ''),
    );
    el(b, 'span', 'pb-picker-label', p ? fileTitle(p) : 'Проект');
    setIcon(el(b, 'span', 'pb-chevron'), 'chevron-down');
    b.setAttribute('aria-label', 'Проект');
    const date = button(propertyRow('Due date'), '', () => this.showCalendar(), 'pb-chip pb-date-button pb-due');
    setIcon(el(date, 'span'), 'calendar-days');
    this.dateLabel = el(date, 'span');
    this.dateButton = date;
    this.updateDue();
    const tags = propertyRow('Tags');
    this.tagEditor ||= new TagEditor(tags, {
      tags: () => this.task.tags,
      system: () => this.systemTags(),
      draft: this.plugin.draft(this.file.path),
      persist: (draft) => this.plugin.setDraft(this.file.path, draft),
      save: (edit) => this.change((task) => ({ tags: edit(task.tags) })),
      fail: (error) => this.fail(error),
    });
    tags.append(this.tagEditor.node);
    this.tagEditor.render();
    if (tagFocused) {
      this.tagEditor.input.focus();
      this.tagEditor.input.setSelectionRange(...selection);
    }
  }
  systemTags() {
    return this.plugin.systemTags();
  }
  commitTags() {
    return this.tagEditor?.flush() || Promise.resolve();
  }
  showCalendar() {
    if (this.calendar) {
      this.closeCalendar();
      return;
    }
    const popup = floatingPopup(this.dateButton, 'pb-calendar');
    this.calendar = popup;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Срок');
    const current = this.task.due ? new Date(this.task.due.slice(0, 10) + 'T12:00:00') : new Date();
    let month = new Date(current.getFullYear(), current.getMonth(), 1);
    const render = () => {
      popup.replaceChildren();
      const header = el(popup, 'div', 'pb-calendar-header');
      icon(header, 'chevron-left', 'Предыдущий месяц', () => {
        month.setMonth(month.getMonth() - 1);
        render();
      }).classList.add('pb-calendar-nav');
      el(header, 'span', '', month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }));
      icon(header, 'chevron-right', 'Следующий месяц', () => {
        month.setMonth(month.getMonth() + 1);
        render();
      }).classList.add('pb-calendar-nav');
      const grid = el(popup, 'div', 'pb-calendar-grid');
      ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach((d) =>
        el(grid, 'span', 'pb-calendar-weekday', d),
      );
      const start = new Date(month);
      start.setDate(1 - ((month.getDay() + 6) % 7));
      for (let n = 0; n < 42; n++) {
        const date = new Date(start);
        date.setDate(start.getDate() + n);
        const value = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        ].join('-');
        const day = button(
          grid,
          String(date.getDate()),
          () => {
            this.closeCalendar();
            this.change({ due: value }).then(() => this.dateButton?.focus());
          },
          'pb-calendar-day',
        );
        day.setAttribute(
          'aria-label',
          date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
        );
        if (date.getMonth() !== month.getMonth()) day.classList.add('is-outside');
        if (date.toDateString() === new Date().toDateString()) day.classList.add('is-today');
        if (value === this.task.due?.slice(0, 10)) day.classList.add('is-selected');
      }
      const footer = el(popup, 'div', 'pb-calendar-footer');
      button(footer, 'Без срока', async () => {
        this.closeCalendar();
        try {
          this.task = await this.plugin.queue(this.file, () =>
            this.plugin.api().tasks.clearDue(this.file.path, CONTEXT),
          );
          if (!this.closed) {
            this.renderProps();
            this.dateButton?.focus();
          }
          this.plugin.refresh();
        } catch (e) {
          this.fail(e);
        }
      });
    };
    render();
    positionPopup(popup, this.dateButton);
    this.calendarOutside = (e) => {
      if (!popup.contains(e.target) && !this.dateButton.contains(e.target)) this.closeCalendar();
    };
    document.addEventListener('pointerdown', this.calendarOutside);
    popup.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeCalendar();
        this.dateButton?.focus();
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const days = [...popup.querySelectorAll('.pb-calendar-day')],
          i = days.indexOf(document.activeElement);
        if (i >= 0) {
          e.preventDefault();
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          days[Math.max(0, Math.min(41, i + delta))].focus();
        }
      }
    };
    (
      popup.querySelector('.is-selected') ||
      popup.querySelector('.is-today') ||
      popup.querySelector('.pb-calendar-day')
    ).focus();
  }
  closeCalendar() {
    if (this.calendarOutside) document.removeEventListener('pointerdown', this.calendarOutside);
    this.calendar?._dispose();
    this.calendar = null;
  }
  change(patch) {
    this.propertySave = this.propertySave
      .catch(() => {})
      .then(async () => {
        this.task = await this.plugin.patch(this.file, patch);
        if (!this.closed) {
          const active = document.activeElement;
          const activeKey = this.props?.contains(active) ? active.getAttribute('aria-label') : null;
          this.renderProps();
          if (activeKey && !active.isConnected)
            [...this.props.querySelectorAll('[aria-label]')]
              .find((e) => e.getAttribute('aria-label') === activeKey)
              ?.focus();
          this.saved();
        }
      });
    this.propertySave.catch((e) => this.fail(e));
    return this.propertySave;
  }
  saved() {
    if (!this.saveState || this.closed) return;
    this.saveState.classList.remove('is-error');
    this.saveState.textContent = '';
    setIcon(this.saveState, 'check');
    this.saveState.setAttribute('aria-label', 'Сохранено');
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => {
      if (!this.closed) this.saveState.replaceChildren();
    }, 1100);
  }
  saveDraft() {
    if (!this.session) return Promise.resolve();
    return this.plugin.setDraft(this.file.path, {
      body: this.session.dirty ? this.session.value : undefined,
      bodyBase: this.session.dirty ? this.session.baseline : undefined,
      ...(this.tagEditor?.draft() || {}),
      ...(!this.journalComposer ? { update: this.updateInput?.value || undefined } : {}),
    });
  }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveDraft().catch((e) => this.fail(e));
    this.saveTimer = setTimeout(() => this.flushSafe(), 450);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    await this.session.flush();
    await this.saveDraft();
    this.saved();
  }
  async flushSafe() {
    try {
      await this.flush();
      return true;
    } catch (e) {
      await this.saveDraft().catch(() => {});
      this.fail(e);
      return false;
    }
  }
  fail(e) {
    if (this.closed) return;
    if (this.saveState) {
      this.saveState.classList.add('is-error');
      this.saveState.textContent = 'Не сохранено';
    }
    new Notice(errorMessage(e), 7000);
    if (e.message === 'BODY_CONFLICT' && !this.recoverButton)
      this.recoverButton = button(
        this.contentEl,
        'Сохранить копию',
        async () => {
          const f = await this.plugin.uniqueNote(
            this.plugin.settings.materialsFolder,
            this.file.basename + ' — моя версия',
            this.session.value,
          );
          const note = await this.plugin.note(this.file);
          this.session = new C.BodySession(note.body, (a, b) =>
            this.plugin.writeBody(this.file, a, b),
          );
          await this.saveDraft();
          await this.close();
          this.plugin.openFile(f);
        },
        'pb-recover',
      );
  }
  edit() {
    this.previewEl.hidden = true;
    this.editor.hidden = false;
    this.editor.value = this.session.value.trim() ? this.session.value : '';
    grow(this.editor);
    this.editor.focus();
  }
  inputBody() {
    this.session.set(this.editor.value);
    this.scheduleSave();
    grow(this.editor);
  }
  async finishEdit() {
    if (!this.editor || this.editor.hidden) return;
    await this.flushSafe();
  }
  async toggleBodyView() {
    if (this.editor.hidden) {
      this.edit();
      return;
    }
    if (!(await this.flushSafe())) return;
    this.editor.hidden = true;
    this.previewEl.hidden = false;
    await this.preview();
  }
  async preview() {
    if (this.closed || !this.editor.hidden) return;
    const seq = ++this.renderSeq;
    this.previewEl.replaceChildren();
    this.renderComponent.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();
    const body = this.session.value,
      lines = body.split('\n'),
      checks = C.parseChecklist(body);
    let previous = 0;
    const chunk = async (start, end) => {
      if (end <= start) return;
      const source = lines.slice(start, end).join('\n');
      if (!source.trim()) return;
      const region = el(this.previewEl, 'div', 'pb-description-region');
      await MarkdownRenderer.render(this.app, source, region, this.file.path, this.renderComponent);
      if (seq !== this.renderSeq) return;
      region.onclick = (e) => {
        if (e.target.closest('a,input,button') || window.getSelection()?.toString()) return;
        this.edit(start, end);
      };
      region.querySelectorAll('a.internal-link').forEach(
        (a) =>
          (a.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (await this.close())
              this.app.workspace.openLinkText(
                a.dataset.href || a.getAttribute('href'),
                this.file.path,
                true,
              );
          }),
      );
      region.querySelectorAll('input.task-list-item-checkbox').forEach((box) => {
        box.disabled = true;
      });
    };
    if (!checks.length) {
      if (!body.trim()) button(this.previewEl, 'Описание', () => this.edit(), 'pb-placeholder');
      else await chunk(0, lines.length);
      return;
    }
    if (!lines.slice(0, checks[0].line).join('\n').trim())
      button(this.previewEl, 'Описание', () => this.edit(0, checks[0].line), 'pb-placeholder');
    for (const item of checks) {
      await chunk(previous, item.line);
      if (seq !== this.renderSeq) return;
      const row = el(this.previewEl, 'div', 'pb-check-row');
      row.dataset.line = String(item.line);
      const box = el(row, 'input');
      box.type = 'checkbox';
      box.checked = item.checked;
      box.setAttribute('aria-label', item.text || 'Выполнено');
      const text = el(row, 'input', 'pb-check-text');
      text.value = item.text;
      text.placeholder = 'Пункт';
      text.setAttribute('aria-label', 'Пункт чеклиста');
      row.classList.toggle('is-complete', box.checked);
      box.onchange = () => {
        try {
          this.session.set(
            C.setChecklistItem(this.session.value, item.line, { checked: box.checked }),
          );
          row.classList.toggle('is-complete', box.checked);
          this.scheduleSave();
        } catch (e) {
          this.fail(e);
        }
      };
      text.oninput = () => {
        try {
          this.session.set(C.setChecklistItem(this.session.value, item.line, { text: text.value }));
          this.scheduleSave();
        } catch (e) {
          this.fail(e);
        }
      };
      text.onblur = () => this.flushSafe();
      text.onkeydown = async (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          if (!text.value.trim()) {
            this.session.set(C.removeChecklistItem(this.session.value, item.line));
            await this.preview();
            this.updateInput.focus();
            this.scheduleSave();
          } else {
            this.session.set(C.addChecklistItem(this.session.value, '', item.line));
            await this.preview();
            this.previewEl
              .querySelector('[data-line="' + (item.line + 1) + '"] .pb-check-text')
              ?.focus();
            this.scheduleSave();
          }
        }
      };
      previous = item.line + 1;
    }
    await chunk(previous, lines.length);
  }
  async addChecklist() {
    if (!(await this.flushSafe())) return;
    try {
      this.session.set(C.addChecklistItem(this.session.value, ''));
      this.edit();
      const end = this.editor.value.replace(/\r?\n$/, '').length;
      this.editor.setSelectionRange(end, end);
      this.scheduleSave();
    } catch (e) {
      this.fail(e);
    }
  }
  async attachNote(target) {
    if (!(await this.flushSafe())) return;
    const link = this.app.fileManager.generateMarkdownLink(target, this.file.path);
    this.session.set(this.session.value.trimEnd() + '\n\n' + link + '\n');
    this.editor.value = this.session.value.trim() ? this.session.value : '';
    grow(this.editor);
    if (await this.flushSafe()) await this.preview();
  }
  postUpdate() {
    if (this.journalComposer) return this.journalComposer.model.submit(this.journalComposer.mode);
    if (this.postPromise) return this.postPromise;
    this.postPromise = this.doPostUpdate().finally(() => {
      this.postPromise = null;
    });
    return this.postPromise;
  }
  async doPostUpdate() {
    if (this.posting) return;
    const text = this.updateInput.value.trim();
    if (!text) return;
    this.posting = true;
    this.send.disabled = true;
    const original = this.updateInput.value;
    try {
      if (!(await this.flushSafe()) || this.closed || this.plugin.disposed) return;
      await this.plugin.addUpdate(this.file, text);
      if (this.updateInput.value === original) this.updateInput.value = '';
      await this.saveDraft();
      if (this.closed) return;
      this.send.hidden = !this.updateInput.value.trim();
      grow(this.updateInput, 28, 100);
      await this.plugin.history(this.feed, this.file, this);
      this.feed.scrollTop = 0;
    } catch (e) {
      this.fail(e);
    } finally {
      this.posting = false;
      this.send.disabled = false;
    }
  }

  async upload() {
    if (!(await this.flushSafe())) return;
    this.plugin
      .uploadMaterial((target) => this.attachNote(target), this.file)
      .catch((e) => this.fail(e));
  }
  updateDue(now = new Date()) {
    if (this.closed || !this.dateButton) return;
    const due = duePresentation(this.task, now);
    applyDueAppearance(this.dateButton, due);
    this.dateLabel.textContent = due.text;
  }
  async syncExternal() {
    // Only the date chip changes at midnight. Do not interrupt an active editor or calendar.
    this.updateDue();
    if (
      this.closed ||
      !this.session ||
      this.syncing ||
      this.posting ||
      this.session.pending ||
      this.session.dirty ||
      document.activeElement === this.editor ||
      this.bodyWrap?.contains(document.activeElement) ||
      this.previewEl.contains(document.activeElement)
    )
      return;
    this.syncing = true;
    const beforeValue = this.session.value,
      beforeBaseline = this.session.baseline,
      beforeTask = this.task,
      beforeProperties = this.propertySave;
    try {
      const [task, note] = await Promise.all([
        this.plugin.api().tasks.get(this.file.path),
        this.plugin.note(this.file),
      ]);
      if (
        this.closed ||
        !task ||
        this.session.dirty ||
        this.session.pending ||
        document.activeElement === this.editor ||
        this.bodyWrap?.contains(document.activeElement) ||
        this.session.value !== beforeValue ||
        this.session.baseline !== beforeBaseline ||
        this.task !== beforeTask ||
        this.propertySave !== beforeProperties ||
        this.previewEl.contains(document.activeElement)
      )
        return;
      const propsChanged = this.propsKey(task) !== this.propsSignature;
      this.task = task;
      this.updateDue();
      if (
        document.activeElement !== this.titleInput &&
        this.titleInput.value.trim() === (beforeTask.title || this.file.basename)
      )
        this.titleInput.value = task.title || this.file.basename;
      if (propsChanged && !this.props.contains(document.activeElement) && !this.calendar)
        this.renderProps();
      if (note.body !== this.session.value) {
        this.session.reset(note.body);
        if (!this.editor.hidden) {
          this.editor.value = this.session.value.trim() ? this.session.value : '';
          grow(this.editor);
        }
        await this.preview();
      }
      await this.plugin.history(this.feed, this.file, this);
    } finally {
      this.syncing = false;
    }
  }
  async close() {
    if (this.closed) return true;
    if (!this.session) {
      this.closed = true;
      super.close();
      return true;
    }
    try {
      if (this.postPromise) await this.postPromise;
      await this.commitTags();
      await this.commitTitle();
      await this.propertySave;
      await this.saveDraft();
      if (!(await this.flushSafe())) return false;
    } catch (e) {
      this.fail(e);
      return false;
    }
    this.closed = true;
    super.close();
    return true;
  }
  shutdown() {
    this.saveDraft().catch(console.error);
    this.session?.flush().catch(console.error);
    this.closed = true;
    super.close();
  }
  onClose() {
    this.closed = true;
    this.tagEditor?.dispose();
    clearTimeout(this.saveTimer);
    clearTimeout(this.savedTimer);
    this.closeCalendar();
    this.props?.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
    this.journalComposer?.dispose();
    this.nextWrap?._dispose?.();
    if (this.feed?._component) this.plugin.disposeHistory(this.feed);
    this.rich?.dispose();
    this.renderComponent.unload();
    this.plugin.modals.delete(this);
    this.contentEl.empty();
  }
}

module.exports = { TaskModal };
