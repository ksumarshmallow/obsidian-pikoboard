'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  path = require('node:path'),
  C = require('../core');
function fixture() {
  const watchers = [],
    listeners = new Map();
  let disposed = 0;
  const doc = {
    defaultView: {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener(k, fn) {
        listeners.set(k, fn);
      },
      removeEventListener(k) {
        listeners.delete(k);
      },
    },
    addEventListener(k, fn) {
      listeners.set(k, fn);
    },
    removeEventListener(k) {
      listeners.delete(k);
    },
    createElement: (tag) => new Element(tag),
  };
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.ownerDocument = doc;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.attrs = {};
      this.isConnected = true;
      this.offsetWidth = 200;
      this.offsetHeight = 130;
    }
    append(c) {
      this.children.push(c);
      c.parent = this;
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    closest() {
      return null;
    }
    focus() {
      doc.activeElement = this;
    }
    contains(t) {
      return t === this || this.children.some((c) => c.contains(t));
    }
    remove() {
      this.isConnected = false;
      disposed++;
    }
    getBoundingClientRect() {
      return { left: 750, right: 780, top: 560, bottom: 580 };
    }
  }
  doc.body = new Element();
  const base = class {};
  const scope = {
    require: (n) =>
      n === 'obsidian'
        ? {
            Plugin: base,
            ItemView: base,
            Modal: base,
            FuzzySuggestModal: base,
            Notice: base,
            Scope: class {
              register(mods, key, fn) {
                this.key = key;
                this.handler = fn;
              }
            },
            setIcon() {},
          }
        : C,
    document: doc,
    module: { exports: {} },
    console,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(fn) {
        this.fn = fn;
        watchers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8') +
      '\nmodule.exports={actionMenu,positionPopup};',
    scope,
  );
  const anchor = new Element('button');
  return {
    ...scope.module.exports,
    doc,
    anchor,
    watchers,
    listeners,
    get disposed() {
      return disposed;
    },
  };
}
const event = (key) => ({ key, preventDefault() {}, stopPropagation() {} });
test('custom menu stays inside viewport, uses keyboard navigation and restores focus on Escape', () => {
  const f = fixture(),
    menu = f.actionMenu(f.anchor, [
      { label: 'Copy', icon: 'copy', action() {} },
      { separator: true },
      { label: 'Delete', danger: true, icon: 'trash', action() {} },
    ]);
  assert.equal(menu.popup.style.left, '580px');
  assert.equal(menu.popup.style.top, '425px');
  assert.equal(menu.popup.attrs.role, 'menu');
  assert.equal(f.anchor.attrs['aria-expanded'], 'true');
  const first = menu.popup.children[0],
    last = menu.popup.children[2];
  assert.equal(f.doc.activeElement, first);
  menu.popup.onkeydown(event('ArrowDown'));
  assert.equal(f.doc.activeElement, last);
  menu.popup.onkeydown(event('Home'));
  assert.equal(f.doc.activeElement, first);
  f.listeners.get('keydown')(event('Escape'));
  assert.equal(f.doc.activeElement, f.anchor);
  assert.equal(f.anchor.attrs['aria-expanded'], 'false');
  assert.equal(f.listeners.size, 0);
  assert.equal(f.watchers[0].disconnected, true);
});
test('custom menu closes before invoking an action and does not survive removal of its anchor', async () => {
  const f = fixture();
  let called = 0;
  const menu = f.actionMenu(f.anchor, [
    {
      label: 'Copy',
      icon: 'copy',
      action() {
        assert.equal(f.listeners.size, 0);
        called++;
      },
    },
  ]);
  menu.popup.children[0].onclick();
  await Promise.resolve();
  assert.equal(called, 1);
  f.actionMenu(f.anchor, [{ label: 'Copy', icon: 'copy', action() {} }]);
  f.anchor.isConnected = false;
  f.watchers.at(-1).fn();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.anchor.attrs['aria-expanded'], 'false');
});

test('menu owns an Obsidian keyboard scope so Escape cannot close the parent task', () => {
  const f = fixture(),
    stack = [],
    app = {
      keymap: {
        pushScope(s) {
          stack.push(s);
        },
        popScope(s) {
          assert.equal(stack.pop(), s);
        },
      },
    };
  const menu = f.actionMenu(
    f.anchor,
    [{ label: 'Copy', icon: 'copy', action() {} }],
    'Message actions',
    app,
  );
  assert.equal(stack.length, 1);
  assert.equal(stack[0].key, 'Escape');
  assert.equal(stack[0].handler(event('Escape')), false);
  assert.equal(stack.length, 0);
  assert.equal(f.anchor.attrs['aria-expanded'], 'false');
  assert.equal(f.doc.activeElement, f.anchor);
});
