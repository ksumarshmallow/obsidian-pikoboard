'use strict';

// Embedded editor prototype extraction adapted from Matthew Meyers / Fevol (MIT).
let EmbeddedEditorBase;
function richEditor(app, container, value, onChange) {
  if (!EmbeddedEditorBase) {
    const widget = app.embedRegistry.embedByExtension.md(
      { app, containerEl: document.createElement('div'), state: {} },
      null,
      '',
    );
    widget.load();
    widget.editable = true;
    widget.showEditor();
    EmbeddedEditorBase = Object.getPrototypeOf(Object.getPrototypeOf(widget.editMode)).constructor;
    widget.unload();
  }
  const owner = { app, onMarkdownScroll() {}, getMode: () => 'source' };
  class Editor extends EmbeddedEditorBase {
    onUpdate(update, changed) {
      super.onUpdate(update, changed);
      if (changed) this.changed?.();
    }
    updateBottomPadding() {}
    buildLocalExtensions() {
      const extensions = super.buildLocalExtensions();
      const { placeholder } = require('@codemirror/view');
      extensions.push(placeholder('Описание'));
      return extensions;
    }
  }
  const instance = new Editor(app, container, owner);
  instance.load();
  owner.editMode = instance;
  owner.editor = instance.editor;
  instance.set(value);
  instance.changed = onChange;
  const cm = instance.editor.cm;
  cm.contentDOM.setAttribute('aria-label', 'Описание');
  cm.contentDOM.addEventListener('focusin', () => {
    if (app.workspace.activeEditor !== owner) instance.previousEditor = app.workspace.activeEditor;
    app.workspace.activeEditor = owner;
  });
  cm.contentDOM.addEventListener('blur', () => {
    if (app.workspace.activeEditor === owner) app.workspace.activeEditor = instance.previousEditor;
  });
  instance.dispose = () => {
    instance.changed = null;
    if (app.workspace.activeEditor === owner) app.workspace.activeEditor = instance.previousEditor;
    instance.unload();
    instance.destroy();
  };
  return instance;
}

module.exports = { richEditor };
