'use strict';
const { MarkdownRenderer, Component } = require('obsidian');
const C = require('../../domain/tasks.js');
const { el, icon } = require('../../ui/elements.js');

function nextStep(parent, plugin, file, edit) {
  const wrap = el(parent, 'div', 'pb-next-step');
  wrap.hidden = true;
  el(wrap, 'span', 'pb-next-label', 'Следующий шаг');
  const content = el(wrap, 'div', 'pb-next-text markdown-rendered');
  const change = icon(wrap, 'pencil', 'Изменить следующий шаг', edit);
  change.classList.add('pb-next-edit');
  const done = icon(wrap, 'x', 'Убрать следующий шаг', () => model.clearNext());
  done.classList.add('pb-next-remove');
  const model = plugin.journal(file);
  let signature = null,
    component = null,
    pending = null,
    seq = 0;
  const unsubscribe = model.subscribe(() => {
    wrap.hidden = !model.next;
    done.disabled = change.disabled = !!(model.busy || model.checkPending);
    content.querySelectorAll('input[type=checkbox]').forEach((box) => {
      if (box.dataset.pbCheck) box.disabled = !!model.busy;
    });
    if (signature === model.next) return;
    signature = model.next;
    const source = model.next,
      checks = C.parseChecklist(source);
    const generation = ++seq,
      stage = document.createElement('div'),
      renderComponent = new Component();
    pending?.unload();
    pending = renderComponent;
    renderComponent.load();
    MarkdownRenderer.render(plugin.app, model.next, stage, file.path, renderComponent)
      .then(() => {
        if (seq !== generation) return;
        stage.querySelectorAll('a.internal-link').forEach(
          (a) =>
            (a.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              plugin.app.workspace.openLinkText(
                a.dataset.href || a.getAttribute('href'),
                file.path,
                true,
              );
            }),
        );
        const boxes = [...stage.querySelectorAll('input[type=checkbox]')].filter(
          (box) => !box.closest('.internal-embed'),
        );
        stage.querySelectorAll('input[type=checkbox]').forEach((box) => {
          box.disabled = true;
        });
        if (boxes.length === checks.length)
          boxes.forEach((box, index) => {
            const item = checks[index];
            box.dataset.pbCheck = 'true';
            box.disabled = !!model.busy;
            box.checked = item.checked;
            box.setAttribute('aria-label', item.text || 'Пункт чеклиста');
            box.onclick = (e) => e.stopPropagation();
            box.onchange = async () => {
              const checked = box.checked;
              if (!(await model.toggleNextCheck(source, item.line, checked)) && box.isConnected)
                box.checked = item.checked;
            };
          });
        component?.unload();
        component = renderComponent;
        content.replaceChildren(...stage.childNodes);
      })
      .catch((e) => {
        if (seq === generation) signature = null;
        console.error(e);
      })
      .finally(() => {
        if (component !== renderComponent) renderComponent.unload();
        if (pending === renderComponent) pending = null;
      });
  });
  wrap._dispose = () => {
    seq++;
    unsubscribe();
    pending?.unload();
    component?.unload();
  };
  return wrap;
}

module.exports = { nextStep };
