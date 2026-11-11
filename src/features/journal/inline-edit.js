'use strict';
const { el, button, icon, growEntry } = require('../../ui/elements.js');
const { entryInput } = require('../../ui/entry-input.js');
function editEntry(plugin, file, update, rendered) {
  if (rendered._editing) return;
  rendered._editing = true;
  const host = el(rendered.parentElement, 'div', 'pb-inline-entry');
  rendered.after(host);
  rendered.hidden = true;
  const input = el(host, 'textarea', 'pb-comment-input');
  input.value = update.text;
  input.setAttribute('aria-label', 'Edit entry');
  const actions = el(host, 'div', 'pb-entry-edit-actions');
  const error = el(host, 'div', 'pb-compose-error');
  error.setAttribute('role', 'status');
  let busy = false;
  input.oninput = () => growEntry(input, 80, 400);
  const files = entryInput(plugin, file, host, input, () => growEntry(input, 80, 400),
    (e) => { error.textContent = e.message || String(e); });
  icon(actions, 'paperclip', 'Attach file', () =>
    plugin.uploadMaterial(files.append, file).catch((e) => { error.textContent = e.message; }));
  icon(actions, 'link', 'Link note or file', () => plugin.chooseNote(file, files.append));
  const close = () => {
    files.dispose(); host.remove(); rendered.hidden = false; rendered._editing = false;
    plugin.refresh?.();
  };
  const cancel = button(actions, 'Cancel', () => { if (!busy) close(); });
  const save = button(actions, 'Save', async () => {
    if (busy || files.pending || !input.value.trim()) return;
    busy = true; save.disabled = true; cancel.disabled = true; input.disabled = true;
    try { await plugin.editMessage(file, update, input.value.trim()); close(); }
    catch (e) {
      error.textContent = e.message || String(e);
      busy = false; save.disabled = false; cancel.disabled = false; input.disabled = false;
    }
  }, 'pb-new');
  host._dispose = () => files.dispose();
  host.addEventListener('click', (e) => e.stopPropagation());
  host.addEventListener('contextmenu', (e) => e.stopPropagation());
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save.click(); }
    if (e.key === 'Escape') { e.preventDefault(); if (!busy) close(); }
  };
  growEntry(input, 80, 400);
  input.focus({preventScroll: true});
  input.setSelectionRange?.(0, 0);
  if (host.closest?.('.pb-task-modal')) host.scrollIntoView({block: 'start'});
}
module.exports = { editEntry };
