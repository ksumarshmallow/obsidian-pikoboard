'use strict';
const C = require('../../domain/tasks.js');
const { el, icon } = require('../../ui/elements.js');

const key = (value) => value.normalize('NFC').toLocaleLowerCase('ru-RU');
function applyTagEdit(tags, edit, system) {
  const next = edit.remove
    ? C.tagList(tags).filter((tag) => key(tag) !== key(edit.remove))
    : [...C.tagList(tags), ...(edit.add || [])];
  return C.taskTags(next, tags, system);
}

class TagEditor {
  constructor(parent, options) {
    this.options = options;
    this.operations = (options.draft?.tagOperations || []).map((edit) => ({ ...edit }));
    this.node = el(parent, 'div', 'pb-tag-editor');
    this.node.setAttribute('role', 'group');
    this.node.setAttribute('aria-label', 'Теги');
    this.chips = el(this.node, 'div', 'pb-tag-chips');
    this.input = el(this.node, 'input', 'pb-tags-input');
    this.input.type = 'text';
    this.input.placeholder = '#тег';
    this.input.setAttribute('aria-label', 'Новый тег');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.value = options.draft?.tagInput || '';
    this.input.oninput = () => {
      this.resize();
      this.persist().catch(options.fail);
    };
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.flush().catch(options.fail);
      }
    };
    this.input.onblur = () => this.flush().catch(options.fail);
    this.resize();
    this.render();
  }
  resize() {
    this.input.size = Math.max(5, Math.min(24, this.input.value.length + 1));
  }
  draft() {
    return {
      tagInput: this.input.value || undefined,
      tagOperations: this.operations.length ? this.operations.map((edit) => ({ ...edit })) : undefined,
    };
  }
  persist() {
    return this.options.persist(this.draft());
  }
  values() {
    return this.operations.reduce(
      (tags, edit) => applyTagEdit(tags, edit, this.options.system()),
      this.options.tags(),
    );
  }
  render() {
    if (this.disposed) return;
    const system = new Set(this.options.system().map(key));
    const visible = this.values().filter((tag) => !system.has(key(tag)));
    const signature = JSON.stringify(visible);
    if (signature === this.signature) return;
    this.signature = signature;
    const focusWasInChips = this.chips.contains(this.node.ownerDocument.activeElement);
    this.chips.replaceChildren();
    for (const tag of visible) {
      const chip = el(this.chips, 'span', 'pb-tag-chip');
      el(chip, 'span', 'pb-tag-label', '#' + tag);
      const remove = icon(chip, 'x', 'Убрать тег #' + tag, () => {
        this.operations.push({ remove: tag });
        this.render();
        this.drain().catch(this.options.fail);
      });
      remove.classList.add('pb-tag-remove');
      // Clicking a chip must not submit the half-written tag beside it.
      remove.onmousedown = (e) => e.preventDefault();
    }
    if (focusWasInChips) this.input.focus();
  }
  flush() {
    const value = this.input.value;
    let tags;
    try {
      tags = C.taskTags(value, [], this.options.system());
    } catch (error) {
      return Promise.reject(error);
    }
    if (tags.length) {
      this.operations.push({ add: tags });
      this.input.value = '';
      this.resize();
      this.render();
    } else if (value.trim() === '#') {
      this.input.value = '';
      this.resize();
    }
    return this.drain();
  }
  drain() {
    if (this.saving) {
      // Persist edits queued while an earlier write is still in progress.
      this.persist().catch(this.options.fail);
      return this.saving;
    }
    this.saving = Promise.resolve().then(async () => {
      await this.persist();
      while (this.operations.length) {
        const edit = this.operations[0];
        await this.options.save((tags) => applyTagEdit(tags, edit, this.options.system()));
        this.operations.shift();
        this.render();
        await this.persist();
      }
      this.node.classList.remove('is-error');
    }).catch((error) => {
      this.node.classList.add('is-error');
      throw error;
    }).finally(() => { this.saving = null; });
    return this.saving;
  }
  dispose() {
    this.disposed = true;
    this.input.onblur = null;
  }
}

module.exports = { TagEditor, applyTagEdit };
