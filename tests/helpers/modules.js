'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Each fixture gets isolated module state and the same mocked Obsidian/DOM globals.
// Tests import public module exports, rather than appending code to a source file.
function createLoader(scope) {
  const root = path.resolve(__dirname, '../../src');
  const context = vm.createContext(scope);
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('Module outside src/');
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const requireModule = (name) =>
      name.startsWith('.')
        ? load(path.relative(root, path.resolve(path.dirname(filename), name)))
        : scope.require(name);
    const factory = vm.runInContext(
      `(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`,
      context,
      { filename },
    );
    factory(requireModule, module, module.exports);
    return module.exports;
  }
  return load;
}

module.exports = { createLoader };
