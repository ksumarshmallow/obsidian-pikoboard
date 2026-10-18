'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { bundle } = require('../../scripts/bundle.js');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pikoboard-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test('bundle preserves module isolation, shared state and Obsidian-provided imports', (t) => {
  const root = fixture(t, {
    'plugin.js': `
      const shared = require('./shared.js');
      const feature = require('./feature/view.js');
      const { label } = require('obsidian');
      const load = () => 'local name';
      module.exports = { shared, feature, label, local: load() };
    `,
    'shared.js': `module.exports = { count: 0 };`,
    'feature/view.js': `
      const state = require('../shared.js');
      state.count++;
      module.exports = state;
    `,
  });
  const output = bundle(path.join(root, 'plugin.js'), root);
  // No source files remain available to the executing plugin.
  fs.rmSync(root, { recursive: true });
  const externals = [];
  const scope = {
    module: { exports: {} },
    require(name) {
      externals.push(name);
      assert.equal(name, 'obsidian');
      return { label: 'host' };
    },
  };
  vm.runInNewContext(output, scope);
  const result = scope.module.exports;
  assert.equal(result.shared, result.feature);
  assert.equal(result.shared.count, 1);
  assert.equal(result.label, 'host');
  assert.equal(result.local, 'local name');
  assert.deepEqual(externals, ['obsidian']);
});

test('build rejects missing, invalid and unexpected runtime dependencies before emitting a bundle', (t) => {
  const root = fixture(t, {
    'missing.js': `require('./absent.js');`,
    'external.js': `require('node:fs');`,
    'outside.js': `require('../outside.js');`,
    'invalid.js': `const broken = ;`,
  });
  assert.throws(() => bundle(path.join(root, 'missing.js'), root), /ENOENT/);
  assert.throws(() => bundle(path.join(root, 'external.js'), root), /Unsupported external/);
  assert.throws(() => bundle(path.join(root, 'outside.js'), root), /outside src/);
  assert.throws(() => bundle(path.join(root, 'invalid.js'), root), SyntaxError);
});

test('installable JavaScript and styles reproduce from the documented source paths', () => {
  const root = path.resolve(__dirname, '../..');
  const source = path.join(root, 'src');
  const output = bundle(path.join(source, 'plugin.js'), source);
  assert.equal(output, fs.readFileSync(path.join(root, 'main.js'), 'utf8'));
  assert.equal(output, bundle(path.join(source, 'plugin.js'), source));
  assert.equal(
    fs.readFileSync(path.join(root, 'styles.css'), 'utf8'),
    fs.readFileSync(path.join(source, 'styles/pikoboard.css'), 'utf8'),
  );
});
