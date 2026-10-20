'use strict';

// The body attribute selects only PikoBoard's scoped palette. Native notes and
// Obsidian's theme classes/variables are never changed.
function appearanceController(plugin) {
  const workspace = plugin.app.workspace;
  const documents = new Set();
  let disposed = false;
  const add = (doc) => {
    if (disposed || !doc?.body || doc.defaultView?.closed) return;
    documents.add(doc);
    doc.body.dataset.pikoboardAppearance = plugin.settings.appearance;
  };
  const apply = () => {
    if (disposed) return;
    add(workspace.containerEl?.ownerDocument);
    workspace.iterateAllLeaves?.((leaf) => add(leaf.view?.containerEl?.ownerDocument));
    for (const doc of documents) {
      if (doc.defaultView?.closed) documents.delete(doc);
      else doc.body.dataset.pikoboardAppearance = plugin.settings.appearance;
    }
  };
  plugin.registerEvent(workspace.on('window-open', (_workspaceWindow, win) => add(win.document)));
  plugin.registerEvent(workspace.on('window-close', (_workspaceWindow, win) => documents.delete(win.document)));
  workspace.onLayoutReady(apply);
  plugin.register(() => {
    disposed = true;
    for (const doc of documents) delete doc.body.dataset.pikoboardAppearance;
    documents.clear();
  });
  apply();
  return { apply };
}

module.exports = { appearanceController };
