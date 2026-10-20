'use strict';
const { ItemView, FileView, Menu, Notice, TFile, setIcon } = require('obsidian');
const C = require('../../domain/tasks.js');
const B = require('../../storage/board-store.js');
const { statusMark, tint, el, button, icon, grow } = require('../../ui/elements.js');
const { fileTitle, errorMessage } = require('../../ui/format.js');
const { duePresentation, applyDueAppearance } = require('../../ui/due-date.js');
const { actionMenu, picker } = require('../../ui/menus.js');
const { JournalComposer } = require('../journal/composer.js');
const { nextStep } = require('../journal/next-step.js');
const { AddColumnModal, BoardSettingsModal, BoardStorageModal } = require('./board-settings.js');
const { TaskModal } = require('../tasks/task-modal.js');
const { TYPE, FILE_TYPE, CONTEXT, statuses } = require('../../constants.js');

const BoardBase = (Base) =>
  class extends Base {
    constructor(leaf, plugin) {
      super(leaf);
      this.plugin = plugin;
      this.filters = { project: '', tags: [] };
      this.expanded = new Set();
      this.recent = new Set();
      this.cards = new Map();
      this.archive = false;
      this.mode = 'board';
      this.seq = 0;
      this.dragPath = null;
      this.moving = false;
    }
    getViewType() {
      return TYPE;
    }
    getDisplayText() {
      return this.file?.basename || 'Все задачи';
    }
    getIcon() {
      return 'columns-3';
    }
    getState() {
      return { ...super.getState(), filters: this.filters, archive: this.archive, mode: this.mode };
    }
    async setState(state, result) {
      if (state?.filters)
        this.filters = { project: state.filters.project || '', tags: state.filters.tags || [] };
      this.archive = !!state?.archive;
      this.mode = state?.mode === 'focus' ? 'focus' : 'board';
      await super.setState(state, result);
      if (this.root) await this.refresh();
    }
    async onLoadFile() {
      this.layoutMode = null;
      this.toolbarSignature = null;
      await this.refresh();
    }
    async onUnloadFile() {
      this.cancelColumnDrag?.();
      this.boardConfig = null;
      this.boardError = '';
    }
    async onOpen() {
      this.contentEl.empty();
      this.root = el(this.contentEl, 'div', 'pikoboard');
      this.toolbar = el(this.root, 'div', 'pb-toolbar');
      this.domains = el(this.root, 'div', 'pb-domains');
      this.area = el(this.root, 'div', 'pb-board');
      this.registerDomEvent(
        this.root.ownerDocument,
        'click',
        (e) => {
          for (const col of this.columns?.values() || []) {
            if (
              col.createRow &&
              !col.createRow.contains(e.target) &&
              !col.createInput.value.trim() &&
              !col.createRow._busy
            ) {
              col.createRow.hidden = true;
              col.col.querySelector('.pb-add-task').hidden = false;
            }
          }
        },
        true,
      );
      await this.refresh();
    }
    async onClose() {
      this.cancelColumnDrag?.();
      this.seq++;
      for (const c of this.cards.values()) this.disposeCard(c);
      this.toolbar?.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
    }
    beginCreate(status = 'open') {
      if (this.archive) {
        this.archive = false;
        this.mode = 'board';
        this.refresh().then(() => this.beginCreate(status));
        return;
      }
      const col = this.columns?.get(status);
      if (!col) return;
      if (col.createInput) {
        col.createRow.hidden = false;
        col.col.querySelector('.pb-add-task').hidden = true;
        col.createRow.scrollIntoView({ block: 'nearest' });
        col.createInput.focus();
        return;
      }
      const row = el(col.col, 'form', 'pb-create-row');
      col.col.insertBefore(row, col.list);
      col.createRow = row;
      const input = el(row, 'textarea', 'pb-create-input');
      col.createInput = input;
      input.rows = 1;
      input.placeholder =
        'Новая задача · ' + (this.boardColumns().find((s) => s.value === status)?.label || status);
      input.setAttribute('aria-label', 'Новая задача');
      const add = col.col.querySelector('.pb-add-task');
      add.hidden = true;
      const hide = () => {
        row.hidden = true;
        add.hidden = false;
      };
      row.onfocusout = () =>
        setTimeout(() => {
          if (!row.contains(document.activeElement) && !input.value.trim() && !row._busy) hide();
        }, 0);
      const send = icon(row, 'arrow-up', 'Создать задачу', () => row.requestSubmit());
      send.classList.add('pb-create-send');
      send.hidden = true;
      input.oninput = () => {
        send.hidden = !input.value.trim();
        grow(input, 36, 120);
      };
      input.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          hide();
          add.focus();
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          row._openTask = e.metaKey || e.ctrlKey;
          row.requestSubmit();
        }
      };
      row.onsubmit = async (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title || row._busy) return;
        row._busy = true;
        send.disabled = true;
        input.readOnly = true;
        const open = row._openTask;
        row._openTask = false;
        try {
          const f = await this.plugin.submitTask(title, status, this);
          input.value = '';
          send.hidden = true;
          grow(input, 36, 120);
          if (open && f instanceof TFile) {
            hide();
            new TaskModal(this.plugin, f).open();
          } else if (row.contains(document.activeElement)) input.focus();
          else hide();
        } catch (err) {
          new Notice(errorMessage(err));
          input.focus();
        } finally {
          row._busy = false;
          input.readOnly = false;
          send.disabled = false;
        }
      };
      row.scrollIntoView({ block: 'nearest' });
      input.focus();
    }
    changed() {
      this.recent.clear();
      this.app.workspace.requestSaveLayout();
      this.refresh();
    }
    switchMode(mode) {
      this.archive = mode === 'archive';
      this.mode = this.archive ? 'board' : mode;
      this.changed();
    }
    disposeCard(card) {
      card.composer?.dispose();
      card.nextWrap?._dispose?.();
      this.plugin.disposeHistory(card.feed);
      card.node.remove();
    }
    boardColumns() {
      return this.boardConfig?.columns || statuses;
    }
    columnForTask(task) {
      if (this.boardConfig)
        return this.boardConfig.columns.some((c) => c.value === task.status)
          ? task.status
          : '__unknown__';
      if (task.isCompleted ?? task.status === 'done') return 'done';
      if (task.isActive ?? task.status === 'in-progress') return 'in-progress';
      const known = this.plugin.columnsFor(task).some((c) => c.value === task.status);
      return known ? 'open' : '__unknown__';
    }
    async refresh() {
      if (!this.root?.isConnected || this.dragPath || this.dragColumn || this.moving) return;
      const seq = ++this.seq;
      if (this.file) {
        try {
          const loaded = await this.plugin.boards.load(this.file);
          if (seq !== this.seq) return;
          this.boardConfig = loaded.board;
          this.boardError = '';
        } catch (error) {
          if (seq !== this.seq) return;
          this.boardError = errorMessage(error);
        }
      }
      if (this.boardError) {
        for (const c of this.cards.values()) this.disposeCard(c);
        this.cards.clear();
        this.columns = null;
        this.layoutMode = null;
        this.toolbar.replaceChildren();
        this.domains.replaceChildren();
        this.area.replaceChildren();
        el(this.area, 'p', 'pb-error', this.boardError);
        return;
      }
      let tasks;
      try {
        tasks = await this.plugin.tasks();
      } catch (e) {
        if (seq === this.seq && !this.cards.size) {
          this.area.replaceChildren();
          this.layoutMode = null;
          this.columns = null;
          this.overviewSignature = null;
          el(this.area, 'p', 'pb-error', errorMessage(e));
        }
        return;
      }
      if (seq !== this.seq) return;
      tasks = C.orderedTasks(
        tasks.filter((t) => !this.boardConfig || t.board === this.boardConfig.id),
        this.plugin.data.order,
      );
      this.allTasks = tasks;
      this.renderToolbar();
      const focus = this.mode === 'focus' && !this.archive;
      const visible = tasks.filter(
        (t) =>
          !!t.archived === this.archive &&
          (focus
            ? (t.isActive ?? t.status === 'in-progress')
            : C.taskMatches(t, this.filters) || this.recent.has(t.path)),
      );
      const unknown = tasks.some((t) => this.columnForTask(t) === '__unknown__');
      const layout = JSON.stringify([
        this.archive,
        this.mode,
        this.boardColumns(),
        unknown,
        this.boardConfig?.id,
      ]);
      if (this.layoutMode !== layout) {
        for (const c of this.cards.values()) this.disposeCard(c);
        this.cards.clear();
        this.columns = null;
        this.layoutMode = layout;
        this.area.replaceChildren();
        this.area.className = 'pb-board pb-overview' + (this.archive ? ' pb-archive' : '');
      }
      if (!this.columns) {
        this.columns = new Map();
        const columns = this.archive
          ? [{ value: 'archive', label: 'Архив', color: '#858594', opacity: 0.05 }]
          : [
              ...this.boardColumns(),
              ...(unknown
                ? [
                    {
                      value: '__unknown__',
                      label: 'Без столбца',
                      color: '#858594',
                      opacity: 0.05,
                      icon: 'circle-help',
                    },
                  ]
                : []),
            ];
        const editable = this.boardConfig && !this.archive;
        this.area.style.gridTemplateColumns = `repeat(${columns.length}, minmax(min(260px, 85vw), 1fr))${editable ? ' 44px' : ''}`;
        for (const s of columns) {
          const col = el(this.area, 'section', 'pb-column'),
            header = el(col, 'header', 'pb-column-header');
          if (s.icon) {
            const mark = el(header, 'span', 'pb-status-icon');
            statusMark(mark, s.icon);
            mark.setAttribute('aria-hidden', 'true');
          }
          col.style.background = tint(s.color || '#858594', s.opacity ?? 0.06);
          el(header, 'span', '', s.label);
          const count = el(header, 'small'),
            list = el(col, 'div', 'pb-card-list');
          this.columns.set(s.value, { col, header, count, list });
          if (editable && s.value !== '__unknown__') this.bindColumnDrag(header, col, s.value);
          if (this.boardConfig && !this.archive && s.value !== '__unknown__')
            icon(header, 'ellipsis', 'Edit column ' + s.label, () =>
              new BoardSettingsModal(this.plugin, this.file, s.value).open(),
            );
          if (!this.archive && s.value !== '__unknown__')
            button(col, '+ Задача', () => this.plugin.createTask(s.value, this), 'pb-add-task');
        }
        if (editable) {
          const add = icon(this.area, 'plus', 'Добавить столбец', () =>
            new AddColumnModal(this.plugin, this.file).open(),
          );
          add.classList.add('pb-add-column');
          add.disabled = this.boardConfig.columns.length >= 30;
        }
      }
      const visiblePaths = new Set(visible.map((t) => t.path));
      for (const [path, c] of this.cards)
        if (!visiblePaths.has(path)) {
          this.disposeCard(c);
          this.cards.delete(path);
        }
      for (const [key, col] of this.columns) {
        const list = visible.filter((t) => key === 'archive' || this.columnForTask(t) === key);
        col.count.textContent = String(list.length);
        let index = 0;
        for (const task of list) {
          if (seq !== this.seq) return;
          let card = this.cards.get(task.path);
          if (!card) {
            card = this.makeCard(task);
            if (!card) continue;
            this.cards.set(task.path, card);
          }
          card.task = task;
          this.updateCard(card);
          const at = col.list.children[index++];
          if (at !== card.node) col.list.insertBefore(card.node, at || null);
          const note = await this.plugin.note(card.file);
          if (seq !== this.seq) return;
          this.plugin.journal(card.file).syncNext(note.nextAction || '');
          if (!card.journal.hidden) await this.plugin.history(card.feed, card.file, this);
        }
      }
    }

    renderToolbar() {
      const active = this.allTasks.filter((t) => !t.archived),
        focus = this.mode === 'focus' && !this.archive;
      const signature = JSON.stringify([
        this.boardConfig,
        this.file?.path,
        this.mode,
        this.archive,
        this.filters,
        this.plugin.projects(),
        this.allTasks.map((t) => [t.projects, t.visibleTags, t.status, t.archived]),
      ]);
      if (this.toolbarSignature === signature) return;
      this.toolbarSignature = signature;
      this.toolbar.querySelectorAll('.pb-picker-wrap').forEach((w) => w._dispose?.());
      this.toolbar.replaceChildren();
      this.domains.replaceChildren();
      button(
        this.toolbar,
        this.getDisplayText(),
        () => this.plugin.chooseBoard(),
        'pb-board-title',
      );
      const nav = el(this.toolbar, 'div', 'pb-nav');
      for (const [mode, label] of [
        ['board', 'Все'],
        [
          'focus',
          'В работе · ' + active.filter((t) => t.isActive ?? t.status === 'in-progress').length,
        ],
        ['archive', 'Архив'],
      ]) {
        const selected = mode === 'archive' ? this.archive : !this.archive && this.mode === mode;
        const b = button(nav, label, () => this.switchMode(mode), selected ? 'is-active' : '');
        b.setAttribute('aria-pressed', String(selected));
      }
      if (!focus) {
        const filters = el(this.toolbar, 'div', 'pb-filters');
        const tags = [...new Set(this.allTasks.flatMap((t) => t.visibleTags))].sort();
        picker(
          filters,
          this.filters.tags.length
            ? this.filters.tags.map((t) => (t === '__none__' ? 'Без тегов' : '#' + t)).join(', ')
            : 'Все теги',
          'Фильтр по тегам',
          [
            { value: '', label: 'Все теги', selected: !this.filters.tags.length },
            ...['__none__', ...tags].map((t) => ({
              value: t,
              label: t === '__none__' ? 'Без тегов' : '#' + t,
              selected: this.filters.tags.includes(t),
            })),
          ],
          (i) => {
            const t = i.value;
            this.filters.tags = !t
              ? []
              : this.filters.tags.includes(t)
                ? this.filters.tags.filter((x) => x !== t)
                : t === '__none__'
                  ? ['__none__']
                  : [...this.filters.tags.filter((x) => x !== '__none__'), t];
            this.changed();
          },
          'pb-filter',
        );
        if (this.filters.tags.length)
          icon(filters, 'x', 'Сбросить теги', () => {
            this.filters.tags = [];
            this.changed();
          });
      }
      button(
        this.toolbar,
        '+ Задача',
        () =>
          this.plugin.createTask(
            (focus ? this.boardColumns().find((s) => s.kind === 'active') : this.boardColumns()[0])
              ?.value || this.boardColumns()[0].value,
            this,
          ),
        'pb-new',
      );
      const optionsButton = icon(this.toolbar, 'ellipsis', 'Меню доски', () =>
        actionMenu(
          optionsButton,
          [
            ...(this.file
              ? [
                  {
                    label: 'Board settings',
                    icon: 'settings-2',
                    action: () => new BoardSettingsModal(this.plugin, this.file).open(),
                  },
                  {
                    label: 'Board folders',
                    icon: 'folder',
                    action: () => new BoardStorageModal(this.plugin, this.file).open(),
                  },
                  {
                    label: 'Добавить существующую задачу',
                    icon: 'list-plus',
                    action: () => this.plugin.addExisting(this),
                  },
                ]
              : []),
            { label: 'Создать доску', icon: 'plus', action: () => this.plugin.newBoard() },
            { label: 'Все задачи', icon: 'panels-top-left', action: () => this.plugin.openBoard() },
          ],
          'Меню доски',
          this.app,
        ),
      );
      this.domains.hidden = focus;
      if (focus) return;
      const options = new Map(this.plugin.projects().map((p) => [p.value, p.label]));
      for (const t of this.allTasks)
        for (const p of t.projects) options.set(C.linkTarget(p), fileTitle(p));
      const scope = this.allTasks.filter((t) => !!t.archived === this.archive);
      const choices = [
        {
          value: '',
          label: focus ? 'Все домены' : 'Все',
          count: focus
            ? active.filter((t) => t.isActive ?? t.status === 'in-progress').length
            : scope.length,
        },
        ...[...options].map(([value, label]) => ({
          value,
          label,
          count: scope.filter((t) => C.linkTarget(t.projects[0] || '') === value).length,
        })),
        {
          value: '__none__',
          label: 'Без проекта',
          count: scope.filter((t) => !t.projects.length).length,
        },
      ];
      for (const choice of choices) {
        if ((this.archive || this.boardConfig) && choice.value && choice.count === 0) continue;
        const selected = focus ? !choice.value : this.filters.project === choice.value;
        const b = button(
          this.domains,
          '',
          () => {
            if (focus) {
              this.mode = 'board';
              this.filters.tags = [];
            }
            this.filters.project = choice.value;
            this.changed();
          },
          'pb-domain' + (selected ? ' is-active' : ''),
        );
        el(b, 'span', '', choice.label);
        el(b, 'small', 'pb-domain-count', String(choice.count));
        b.setAttribute('aria-pressed', String(selected));
      }
    }
    makeCard(task) {
      const file = this.app.vault.getAbstractFileByPath(task.path);
      if (!(file instanceof TFile)) return null;
      const node = document.createElement('article');
      node.className = 'pb-task';
      node.dataset.path = file.path;
      const head = el(node, 'div', 'pb-task-head');
      const c = { node, head, file, task };
      const grip = el(head, 'span', 'pb-grip');
      setIcon(grip, 'grip-vertical');
      grip.setAttribute('aria-hidden', 'true');
      c.title = button(
        head,
        task.title || file.basename,
        () => new TaskModal(this.plugin, file).open(),
        'pb-task-title',
      );
      c.toggle = icon(head, 'chevron-down', 'История', async () => {
        const open = !this.expanded.has(file.path);
        if (open) this.expanded.add(file.path);
        else this.expanded.delete(file.path);
        c.journal.hidden = !open;
        c.toggle.setAttribute('aria-expanded', String(open));
        if (open) await this.plugin.history(c.feed, file, this);
      });
      c.toggle.classList.add('pb-history-toggle');
      c.toggle.setAttribute('aria-expanded', String(this.expanded.has(file.path)));
      head.draggable = false;
      head.onpointerdown = (e) => {
        if (this.archive || e.button !== 0 || e.target.closest('.pb-history-toggle')) return;
        const start = { x: e.clientX, y: e.clientY };
        let dragging = false,
          target = null;
        const move = (ev) => {
          if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
          if (!dragging) {
            dragging = true;
            this.dragPath = file.path;
            head.setPointerCapture(e.pointerId);
            node.classList.add('pb-dragging');
          }
          ev.preventDefault();
          this.clearDrop();
          target = null;
          for (const [status, col] of this.columns) {
            const r = col.col.getBoundingClientRect();
            if (
              ev.clientX >= r.left &&
              ev.clientX <= r.right &&
              ev.clientY >= r.top &&
              ev.clientY <= r.bottom
            ) {
              target = { status, ...this.dropTarget(col.list, ev.clientY, ev.clientX) };
              col.col.classList.add('pb-drop');
              if (target.node)
                target.node.classList.add(target.after ? 'pb-insert-after' : 'pb-insert-before');
              break;
            }
          }
        };
        const end = (ev) => {
          head.ownerDocument.removeEventListener('pointermove', move);
          head.ownerDocument.removeEventListener('pointerup', end);
          head.ownerDocument.removeEventListener('pointercancel', end);
          if (!dragging) return;
          this.suppressClickUntil = Date.now() + 350;
          this.dragPath = null;
          node.classList.remove('pb-dragging');
          this.clearDrop();
          if (head.hasPointerCapture(e.pointerId)) head.releasePointerCapture(e.pointerId);
          if (target && ev.type === 'pointerup')
            this.moveCard(file.path, target.status, target.anchor, target.after);
          else this.refresh();
        };
        head.ownerDocument.addEventListener('pointermove', move);
        head.ownerDocument.addEventListener('pointerup', end);
        head.ownerDocument.addEventListener('pointercancel', end);
      };
      head.addEventListener(
        'click',
        (e) => {
          if (Date.now() < (this.suppressClickUntil || 0)) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true,
      );
      node.oncontextmenu = (e) => {
        if (e.target.closest('.pb-card-journal')) return;
        e.preventDefault();
        const menu = new Menu();
        for (const s of this.plugin.columnsFor(c.task))
          menu.addItem((i) =>
            i
              .setTitle(s.label)
              .setIcon(/^[a-z-]+$/.test(s.icon || '') ? s.icon : 'circle')
              .setChecked(c.task.status === s.value)
              .onClick(() =>
                this.plugin
                  .patch(file, { status: s.value })
                  .catch((err) => new Notice(errorMessage(err))),
              ),
          );
        menu.addSeparator();
        menu.addItem((i) =>
          i.setTitle(c.task.archived ? 'Вернуть' : 'В архив').onClick(() => this.archiveTask(c)),
        );
        menu.addItem((i) =>
          i
            .setTitle('Перенести на доску')
            .setIcon('columns-3')
            .onClick(() => this.plugin.chooseTaskBoard(file)),
        );
        menu.addItem((i) => i.setTitle('Открыть файл').onClick(() => this.plugin.openFile(file)));
        menu.addSeparator();
        menu.addItem((i) =>
          i
            .setTitle('Удалить задачу')
            .setIcon('trash-2')
            .onClick(() =>
              this.plugin.requestTrash(file).catch((err) => new Notice(errorMessage(err))),
            ),
        );
        menu.showAtMouseEvent(e);
      };
      c.meta = el(node, 'div', 'pb-meta');
      if (this.archive) button(node, 'Вернуть', () => this.archiveTask(c), 'pb-restore');
      c.nextWrap = nextStep(node, this.plugin, file, async () => {
        this.expanded.add(file.path);
        c.journal.hidden = false;
        c.toggle.setAttribute('aria-expanded', 'true');
        await c.composer.setMode('next');
        await this.plugin.history(c.feed, file, this);
      });
      c.journal = el(node, 'div', 'pb-card-journal');
      c.journal.hidden = !this.expanded.has(file.path);
      c.feed = el(c.journal, 'div', 'pb-feed');
      c.feed.setAttribute('role', 'region');
      c.feed.setAttribute('aria-label', 'История задачи');
      c.composer = new JournalComposer(this.plugin, file, c.journal);
      return c;
    }
    bindColumnDrag(header, node, value) {
      header.classList.add('pb-column-handle');
      header.tabIndex = 0;
      header.setAttribute(
        'aria-label',
        'Передвинуть столбец ' + this.boardColumns().find((c) => c.value === value)?.label,
      );
      header.onkeydown = (event) => {
        if (
          !event.altKey ||
          !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
          event.target !== header
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const columns = this.boardColumns(),
          index = columns.findIndex((c) => c.value === value);
        const adjacent = columns[index + (event.key === 'ArrowRight' ? 1 : -1)];
        if (adjacent) this.moveColumn(value, adjacent.value, event.key === 'ArrowRight');
      };
      header.onpointerdown = (event) => {
        if (
          event.button !== 0 ||
          event.target.closest('button,input') ||
          this.moving ||
          this.dragPath
        )
          return;
        this.cancelColumnDrag?.();
        const doc = header.ownerDocument,
          win = doc.defaultView;
        const startX = event.clientX,
          startY = event.clientY;
        let dragging = false,
          target = null,
          frame = null,
          pointerX = startX;
        const clear = () =>
          this.area
            .querySelectorAll('.pb-column-before,.pb-column-after')
            .forEach((n) => n.classList.remove('pb-column-before', 'pb-column-after'));
        const locate = () => {
          clear();
          target = null;
          const columns = [...this.columns].filter(([id]) => id !== value && id !== '__unknown__');
          const before = columns.find(([, c]) => {
            const r = c.col.getBoundingClientRect();
            return pointerX < r.left + r.width / 2;
          });
          const found = before || columns.at(-1);
          if (found) {
            target = { value: found[0], after: !before };
            found[1].col.classList.add(before ? 'pb-column-before' : 'pb-column-after');
          }
        };
        const scroll = () => {
          if (!dragging) return;
          const r = this.area.getBoundingClientRect();
          const delta = pointerX > r.right - 48 ? 10 : pointerX < r.left + 48 ? -10 : 0;
          if (delta) {
            this.area.scrollLeft += delta;
            locate();
          }
          frame = win.requestAnimationFrame(scroll);
        };
        const move = (e) => {
          if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
          if (!dragging) {
            dragging = true;
            this.dragColumn = value;
            header.setPointerCapture(event.pointerId);
            node.classList.add('pb-column-dragging');
            scroll();
          }
          e.preventDefault();
          pointerX = e.clientX;
          node.style.transform = `translateX(${e.clientX - startX}px)`;
          locate();
        };
        const finish = (e) => {
          doc.removeEventListener('pointermove', move);
          doc.removeEventListener('pointerup', finish);
          doc.removeEventListener('pointercancel', finish);
          doc.removeEventListener('keydown', key, true);
          win.removeEventListener('blur', cancel);
          if (frame !== null) win.cancelAnimationFrame(frame);
          this.cancelColumnDrag = null;
          if (!dragging) return;
          this.dragColumn = null;
          node.classList.remove('pb-column-dragging');
          node.style.transform = '';
          clear();
          if (header.hasPointerCapture(event.pointerId))
            header.releasePointerCapture(event.pointerId);
          if (e?.type === 'pointerup' && target) this.moveColumn(value, target.value, target.after);
          else this.refresh();
        };
        const cancel = () => finish();
        const key = (e) => {
          if (e.key === 'Escape' && dragging) {
            e.preventDefault();
            e.stopPropagation();
            finish();
          }
        };
        this.cancelColumnDrag = cancel;
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', finish);
        doc.addEventListener('pointercancel', finish);
        doc.addEventListener('keydown', key, true);
        win.addEventListener('blur', cancel);
      };
    }
    async moveColumn(value, anchor, after = false) {
      if (!this.file || !this.boardConfig || this.archive || this.moving || value === anchor)
        return false;
      const columns = this.boardConfig.columns;
      if (!columns.some((c) => c.value === value) || !columns.some((c) => c.value === anchor))
        return false;
      this.moving = true;
      try {
        const expected = JSON.stringify(this.boardConfig);
        const source = await this.app.vault.read(this.file),
          board = B.parseBoard(source);
        if (JSON.stringify(board) !== expected)
          throw new Error('Доска уже изменена. Повторите перемещение.');
        const moved = board.columns.find((c) => c.value === value);
        board.columns = board.columns.filter((c) => c.value !== value);
        const index = board.columns.findIndex((c) => c.value === anchor) + (after ? 1 : 0);
        board.columns.splice(index, 0, moved);
        if (board.columns.every((c, i) => c.value === columns[i].value)) return true;
        const result = await this.plugin.boards.save(this.file, board, source);
        this.boardConfig = result.board;
        return true;
      } catch (e) {
        new Notice(errorMessage(e));
        return false;
      } finally {
        this.moving = false;
        await this.refresh();
        this.plugin.refresh();
        this.columns?.get(value)?.header?.focus();
      }
    }
    clearDrop() {
      this.area
        .querySelectorAll('.pb-drop,.pb-insert-before,.pb-insert-after')
        .forEach((n) => n.classList.remove('pb-drop', 'pb-insert-before', 'pb-insert-after'));
    }
    dropTarget(list, y, x) {
      const nodes = [...list.children].filter((n) => n.dataset.path !== this.dragPath);
      const before = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      const node = before || nodes.at(-1);
      return { node, anchor: node?.dataset.path || null, after: !!node && !before };
    }
    async moveCard(path, status, anchor, after) {
      if (this.moving || status === '__unknown__') return;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;
      this.moving = true;
      try {
        const task = this.allTasks.find((t) => t.path === path);
        if (!this.boardConfig && task?.board) {
          const kind = statuses.find((s) => s.value === status)?.kind;
          const currentKind = this.plugin
            .columnsFor(task)
            .find((s) => s.value === task.status)?.kind;
          status =
            currentKind === kind
              ? task.status
              : this.plugin.columnsFor(task).find((s) => s.kind === kind)?.value;
          if (!status) throw new Error('Перенесите задачу в нужный столбец на её доске.');
        }
        if (task?.status !== status) await this.plugin.patch(file, { status });
        const old = this.plugin.data.order;
        this.plugin.data.order = C.moveTaskOrder(
          C.orderedTasks(await this.plugin.tasks(), old).map((t) => t.path),
          path,
          anchor,
          after,
        );
        try {
          await this.plugin.persist();
        } catch (e) {
          this.plugin.data.order = old;
          throw e;
        }
      } catch (e) {
        new Notice(errorMessage(e));
      } finally {
        this.moving = false;
        await this.refresh();
        this.plugin.refresh();
      }
    }
    revealNew(path) {
      const card = this.cards.get(path);
      if (!card) return;
      card.node.classList.add('pb-new-task');
      card.node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const timer = setTimeout(() => card.node.classList.remove('pb-new-task'), 6500);
      this.register(() => clearTimeout(timer));
    }
    async archiveTask(c) {
      try {
        await this.plugin.api().tasks.archive(c.file.path, !c.task.archived, CONTEXT);
        this.plugin.refresh();
      } catch (e) {
        new Notice(errorMessage(e));
      }
    }
    updateCard(c, now = new Date()) {
      const t = c.task;
      c.title.textContent = t.title || c.file.basename;
      const matches = (this.mode === 'focus' && !this.archive) || C.taskMatches(t, this.filters);
      const due = duePresentation(t, now);
      const signature = JSON.stringify([t.projects, t.visibleTags, t.due, due, matches]);
      if (c.metaSignature === signature) return;
      c.metaSignature = signature;
      c.meta.replaceChildren();
      for (const p of t.projects)
        el(
          c.meta,
          'span',
          'pb-badge pb-project pb-color-' + C.colorFor(C.linkTarget(p)),
          fileTitle(p),
        );
      for (const tag of t.visibleTags) el(c.meta, 'span', 'pb-badge', '#' + tag);
      if (t.due) {
        const badge = el(c.meta, 'span', 'pb-badge pb-due', due.text);
        applyDueAppearance(badge, due);
      }
      if (!matches) el(c.meta, 'span', 'pb-badge', 'Вне фильтра');
      c.meta.hidden = !c.meta.children.length;
    }
  };
class BoardView extends BoardBase(ItemView) {}
class BoardFileView extends BoardBase(FileView) {
  getViewType() {
    return FILE_TYPE;
  }
}

module.exports = { BoardView, BoardFileView };
