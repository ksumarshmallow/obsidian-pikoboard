'use strict';
const { el, button } = require('./elements.js');

// Shared by new entries and inline edits. Only file drops are intercepted.
function entryInput(plugin, file, host, input, changed, fail) {
  const suggestions = el(host, 'div', 'pb-link-suggestions');
  suggestions.hidden = true;
  suggestions.setAttribute('popover', 'manual');
  suggestions.setAttribute('aria-label', 'Files');
  let active = true, pending = 0;
  const hide = () => {
    if (suggestions.matches?.(':popover-open')) suggestions.hidePopover();
    suggestions.hidden = true;
  };
  const show = () => {
    suggestions.hidden = false;
    if (typeof suggestions.showPopover !== 'function') {
      suggestions.scrollIntoView?.({block: 'nearest'});
      return;
    }
    const rect = input.getBoundingClientRect();
    const viewport = input.ownerDocument.defaultView;
    const width = Math.min(rect.width, viewport.innerWidth - 24);
    const height = Math.min(220, Math.max(100, viewport.innerHeight - 24));
    suggestions.style.width = width + 'px';
    suggestions.style.maxHeight = height + 'px';
    suggestions.style.left = Math.max(12, Math.min(rect.left, viewport.innerWidth - width - 12)) + 'px';
    // The top layer escapes the history's scroll clipping, even inside a task modal.
    suggestions.showPopover();
    const actualHeight = suggestions.getBoundingClientRect().height;
    const top = rect.bottom + 6 + actualHeight <= viewport.innerHeight - 12
      ? rect.bottom + 6 : Math.max(12, rect.top - actualHeight - 6);
    suggestions.style.top = top + 'px';
  };
  const insert = (value, start = input.selectionStart, end = input.selectionEnd) => {
    if (!active || input.disabled) return;
    input.setRangeText(value, start, end, 'end');
    changed();
    hide();
    input.focus();
  };
  const append = (target) => insert(plugin.app.fileManager.generateMarkdownLink(target, file.path));
  const suggest = () => {
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/\[\[([^\]\n]*)$/);
    suggestions.replaceChildren();
    if (!match) { hide(); return; }
    const start = input.selectionStart - match[0].length;
    const end = input.selectionEnd + (input.value.slice(input.selectionEnd).startsWith(']]') ? 2 : 0);
    const files = plugin.app.vault.getFiles().filter((f) =>
      f.path !== file.path && f.path.toLowerCase().includes(match[1].toLowerCase())).slice(0, 8);
    if (!files.length) el(suggestions, 'span', '', 'No matching files');
    for (const target of files) {
      const option = button(suggestions, target.path, () =>
        insert(plugin.app.fileManager.generateMarkdownLink(target, file.path), start, end));
      option.onmousedown = (e) => e.preventDefault();
    }
    show();
  };
  input.addEventListener('input', suggest);
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', (e) => {
    if (suggestions.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation(); hide();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      const first = suggestions.querySelector('button');
      if (first) { e.preventDefault(); e.stopImmediatePropagation(); first.click(); }
    }
  }, true);
  const filesDragged = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  host.addEventListener('dragover', (e) => {
    if (!filesDragged(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    host.classList.add('is-file-dragover');
  });
  host.addEventListener('dragleave', (e) => {
    if (!host.contains(e.relatedTarget)) host.classList.remove('is-file-dragover');
  });
  host.addEventListener('drop', async (e) => {
    if (!filesDragged(e)) return;
    e.preventDefault(); e.stopPropagation();
    host.classList.remove('is-file-dragover');
    if (pending || input.disabled) return;
    pending++;
    const start = input.selectionStart, end = input.selectionEnd;
    let cursor = start;
    input.readOnly = true;
    try { await plugin.importMaterials(Array.from(e.dataTransfer.files), (target) => {
      if (!active) return;
      const link = plugin.app.fileManager.generateMarkdownLink(target, file.path);
      const value = (cursor === start ? '' : '\n') + link;
      insert(value, cursor, cursor === start ? end : cursor);
      cursor += value.length;
    }, file); }
    catch (error) { fail(error); }
    finally { pending--; input.readOnly = false; }
  });
  return { append, get pending() { return pending; }, dispose() { active = false; hide(); } };
}
module.exports = { entryInput };
