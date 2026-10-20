'use strict';
const { Modal } = require('obsidian');
const B = require('../../storage/board-store.js');
const { tint, el, button, icon } = require('../../ui/elements.js');
const { errorMessage } = require('../../ui/format.js');
const { symbolPicker, columnColors } = require('./column-controls.js');

class BoardEditModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
  }
  async onOpen() {
    this.modalEl.addClass('pb-config-modal');
    this.contentEl.addClass('pikoboard');
    try {
      this.original = await this.app.vault.read(this.file);
      this.board = B.parseBoard(this.original);
      this.render();
    } catch (e) {
      el(this.contentEl, 'p', 'pb-error', errorMessage(e));
    }
  }
  actions(label = 'Сохранить') {
    this.error = el(this.contentEl, 'div', 'pb-error');
    this.error.setAttribute('role', 'alert');
    const actions = el(this.contentEl, 'div', 'pb-config-actions');
    button(actions, 'Отмена', () => this.close());
    this.saveButton = button(actions, label, () => this.save(), 'pb-new');
  }
  async save() {
    if (this.saving || this.removing) return false;
    this.saving = true;
    this.onClose();
    const controls = [...this.contentEl.querySelectorAll('button,input,textarea,select')].map(
      (node) => [node, node.disabled],
    );
    controls.forEach(([node]) => {
      node.disabled = true;
    });
    this.saveButton.disabled = true;
    try {
      const next = B.normalizeBoard(this.board);
      const previous = B.parseBoard(this.original);
      const removed = previous.columns.filter(
        (c) => !next.columns.some((n) => n.value === c.value),
      );
      if (removed.length) {
        const tasks = (await this.plugin.tasks()).filter((t) => t.board === next.id);
        if (removed.some((c) => tasks.some((t) => t.status === c.value)))
          throw new Error(
            'В столбце есть задачи, включая архив. Сначала перенесите их в другой столбец.',
          );
      }
      await this.plugin.boards.save(this.file, next, this.original);
      this.plugin.refresh();
      this.close();
      return true;
    } catch (e) {
      this.error.textContent = errorMessage(e);
      return false;
    } finally {
      this.saving = false;
      controls.forEach(([node, disabled]) => {
        node.disabled = disabled;
      });
      this.saveButton.disabled = false;
    }
  }
  onClose() {
    this.contentEl.querySelectorAll('.pb-symbol-wrap').forEach((n) => n._dispose?.());
  }
}
class AddColumnModal extends BoardEditModal {
  render() {
    this.modalEl.addClass('pb-add-column-modal');
    el(this.contentEl, 'h2', '', 'Новый столбец');
    const form = el(this.contentEl, 'form', 'pb-config-form');
    this.column = {
      value: crypto.randomUUID(),
      label: '',
      kind: 'active',
      color: '#a99bea',
      opacity: 0.06,
      icon: '',
    };
    const preview = el(form, 'div', 'pb-new-column-preview');
    const paint = () => {
      preview.style.background = tint(this.column.color, this.column.opacity);
    };
    symbolPicker(preview, this.column, paint, this.plugin);
    const name = el(preview, 'input', 'pb-config-column-name');
    name.placeholder = 'Название столбца';
    name.setAttribute('aria-label', 'Название столбца');
    name.oninput = () => {
      this.column.label = name.value;
    };
    columnColors(form, this.column, paint);
    paint();
    this.actions('Добавить');
    form.onsubmit = (e) => {
      e.preventDefault();
      this.save();
    };
    name.focus();
  }
  async save() {
    if (this.saving) return false;
    if (!this.column.label.trim()) {
      this.error.textContent = 'Введите название столбца.';
      return false;
    }
    if (
      this.board.columns.length >= 30 &&
      !this.board.columns.some((c) => c.value === this.column.value)
    ) {
      this.error.textContent = 'На доске уже 30 столбцов.';
      return false;
    }
    // Keep the pending column only once when retrying after an error.
    if (!this.board.columns.some((c) => c.value === this.column.value))
      this.board.columns.push(this.column);
    const saved = await super.save();
    if (saved) {
      for (const leaf of this.plugin.boardLeaves?.() || []) {
        const view = leaf.view;
        if (view.file?.path !== this.file.path) continue;
        await view.refresh();
        const column = view.columns?.get(this.column.value);
        column?.col.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'smooth' });
        if (column) {
          column.col.classList.add('pb-new-task');
          const timer = setTimeout(() => column.col.classList.remove('pb-new-task'), 4000);
          view.register(() => clearTimeout(timer));
        }
      }
    }
    return saved;
  }
}
class BoardSettingsModal extends BoardEditModal {
  constructor(plugin, file, focusColumn) {
    super(plugin, file);
    this.focusColumn = focusColumn;
  }
  render() {
    this.onClose();
    this.contentEl.replaceChildren();
    el(this.contentEl, 'h2', '', 'Столбцы');
    const list = el(this.contentEl, 'div', 'pb-config-columns');
    let focusInput;
    for (const [index, c] of this.board.columns.entries()) {
      const row = el(list, 'div', 'pb-config-column');
      const paint = () => {
        row.style.background = tint(c.color, c.opacity);
      };
      const top = el(row, 'div', 'pb-config-column-top');
      symbolPicker(top, c, paint, this.plugin);
      const title = el(top, 'input', 'pb-config-column-name');
      title.value = c.label;
      title.setAttribute('aria-label', 'Название столбца ' + (index + 1));
      title.oninput = () => {
        c.label = title.value;
      };
      const remove = icon(top, 'trash-2', 'Удалить столбец ' + c.label, async () => {
        if (this.saving || this.removing) return;
        this.removing = true;
        try {
          const tasks = await this.plugin.tasks();
          const count = tasks.filter(
            (t) => t.board === this.board.id && t.status === c.value,
          ).length;
          if (count) {
            this.error.textContent = `В «${c.label}» есть задачи: ${count}, включая архив. Сначала перенесите их в другой столбец.`;
            return;
          }
          this.board.columns = this.board.columns.filter((x) => x.value !== c.value);
          this.focusColumn = null;
          this.render();
        } catch (e) {
          this.error.textContent = errorMessage(e);
        } finally {
          this.removing = false;
        }
      });
      remove.classList.add('pb-trash');
      remove.disabled = this.board.columns.length === 1;
      const controls = el(row, 'div', 'pb-column-appearance');
      const color = el(controls, 'input', 'pb-color-custom');
      color.type = 'color';
      color.value = c.color;
      color.setAttribute('aria-label', 'Цвет столбца ' + c.label);
      color.oninput = () => {
        c.color = color.value;
        paint();
      };
      const label = el(controls, 'label', 'pb-opacity-control');
      el(label, 'span', '', 'Прозрачность');
      const range = el(label, 'input', 'pb-opacity-range');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '1';
      range.value = String(Math.round((1 - c.opacity) * 100));
      range.setAttribute('aria-label', 'Прозрачность фона ' + c.label);
      const amount = el(label, 'output', '', range.value + '%');
      range.oninput = () => {
        c.opacity = (100 - Number(range.value)) / 100;
        amount.textContent = range.value + '%';
        paint();
      };
      paint();
      if (this.focusColumn === c.value) focusInput = title;
    }
    this.actions();
    focusInput?.focus();
  }
}
class BoardStorageModal extends BoardEditModal {
  render() {
    this.modalEl.addClass('pb-storage-modal');
    el(this.contentEl, 'h2', '', 'Папки доски');
    const form = el(this.contentEl, 'form', 'pb-config-form');
    for (const [key, label] of [
      ['tasksFolder', 'Новые задачи'],
      ['attachmentsFolder', 'Вложения'],
    ]) {
      const group = el(form, 'div', 'pb-folder-setting');
      const top = el(group, 'div', 'pb-folder-heading');
      el(top, 'span', '', label);
      const badge = el(top, 'span', 'pb-folder-origin');
      const row = el(group, 'div', 'pb-folder-input');
      const input = el(row, 'input', 'pb-config-input');
      input.setAttribute('aria-label', label);
      input.placeholder = 'Корень хранилища';
      const reset = icon(row, 'undo-2', 'Вернуть общую папку', () => {
        delete this.board[key];
        paint();
      });
      const paint = () => {
        input.value = this.board[key] ?? this.plugin.settings[key] ?? '';
        badge.textContent = this.board[key] === undefined ? 'Общая папка' : 'Для этой доски';
        reset.hidden = this.board[key] === undefined;
      };
      input.oninput = () => {
        this.board[key] = input.value.trim();
        badge.textContent = 'Для этой доски';
        reset.hidden = false;
      };
      paint();
    }
    this.actions();
    form.onsubmit = (e) => {
      e.preventDefault();
      this.save();
    };
  }
}

module.exports = { BoardEditModal, AddColumnModal, BoardSettingsModal, BoardStorageModal };
