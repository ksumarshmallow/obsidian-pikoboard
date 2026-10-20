'use strict';

// Embedded editor prototype extraction adapted from Matthew Meyers / Fevol (MIT).
// This optional adapter uses a private API. The task modal keeps a normal
// textarea when the host implementation is unavailable or changes.
const editorBases = new WeakMap();
function editorBase(app, document) {
  if (editorBases.has(app)) return editorBases.get(app);
  const registry = app.embedRegistry?.embedByExtension;
  if (typeof registry?.md !== 'function') throw new Error('Embedded Markdown editor unavailable');
  const widget = registry.md({ app, containerEl: document.createElement('div'), state: {} }, null, '');
  try {
    widget.load();
    widget.editable = true;
    widget.showEditor();
    const base = Object.getPrototypeOf(Object.getPrototypeOf(widget.editMode)).constructor;
    if (typeof base !== 'function' || typeof base.prototype.buildLocalExtensions !== 'function')
      throw new Error('Unsupported embedded Markdown editor');
    editorBases.set(app, base);
    return base;
  } finally {
    widget?.unload();
  }
}

function richEditor(app, container, value, onChange) {
  const Base = editorBase(app, container.ownerDocument);
  const owner = { app, onMarkdownScroll() {}, getMode: () => 'source' };
  class Editor extends Base {
    onUpdate(update, changed) {
      super.onUpdate(update, changed);
      if (changed) this.changed?.();
    }
    updateBottomPadding() {}
    buildLocalExtensions() {
      const extensions = super.buildLocalExtensions();
      const { placeholder } = require('@codemirror/view');
      extensions.push(placeholder('Description'));
      return extensions;
    }
  }
  const instance = new Editor(app, container, owner);
  let content, disposed = false;
  const restore = () => {
    if (app.workspace.activeEditor === owner) app.workspace.activeEditor = instance.previousEditor;
  };
  const focus = () => {
    if (app.workspace.activeEditor !== owner) instance.previousEditor = app.workspace.activeEditor;
    app.workspace.activeEditor = owner;
  };
  instance.dispose = () => {
    if (disposed) return;
    disposed = true;
    instance.changed = null;
    content?.removeEventListener('focusin', focus);
    content?.removeEventListener('blur', restore);
    restore();
    try {
      instance.unload();
    } finally {
      instance.destroy();
    }
  };
  try {
    instance.load();
    owner.editMode = instance;
    owner.editor = instance.editor;
    instance.set(value);
    content = instance.editor.cm.contentDOM;
    content.setAttribute('aria-label', 'Description');
    content.addEventListener('focusin', focus);
    content.addEventListener('blur', restore);
    instance.changed = onChange;
    return instance;
  } catch (error) {
    try {
      instance.dispose();
    } catch (cleanupError) {
      console.error('PikoBoard editor cleanup', cleanupError);
    }
    editorBases.delete(app);
    throw error;
  }
}

module.exports = { richEditor };
