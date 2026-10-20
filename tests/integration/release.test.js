'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { artifacts } = require('../../scripts/build.js');
const { validate, pack, ASSETS } = require('../../scripts/release.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pikoboard-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const manifest = { id: 'pikoboard', name: 'PikoBoard', version: '1.2.3', minAppVersion: '1.14.4',
    author: 'Example', description: 'Plan tasks in notes.', isDesktopOnly: false };
  write('manifest.json', manifest);
  write('package.json', { version: '1.2.3', license: 'MIT' });
  write('versions.json', { '1.2.3': '1.14.4' });
  for (const name of ['LICENSE', 'THIRD-PARTY-LICENSES.txt', 'README.md', 'docs/usage.md', 'docs/releasing.md'])
    write(name, 'Fixture text');
  write('src/plugin.js', "module.exports = require('obsidian').Plugin;");
  write('src/styles/pikoboard.css', '.pb { color: inherit; }');
  for (const [name, contents] of Object.entries(artifacts(root))) write(name, contents);
  return { root, write, manifest };
}

test('release checks reject mismatched versions, tags, compatibility and stale runtime files', (t) => {
  const { root, write, manifest } = fixture(t);
  assert.equal(validate(root, '1.2.3').version, '1.2.3');
  assert.throws(() => validate(root, 'v1.2.3'), /tag must exactly match/);
  write('package.json', { version: '1.2.4', license: 'MIT' });
  assert.throws(() => validate(root), /versions differ/);
  write('package.json', { version: '1.2.3', license: 'MIT' });
  write('versions.json', { '1.2.3': '1.12.2' });
  assert.throws(() => validate(root), /compatibility entry/);
  write('versions.json', { '1.2.3': '1.14.4' });
  write('manifest.json', { ...manifest, version: 'v1.2.3' });
  assert.throws(() => validate(root), /Version must/);
  write('manifest.json', manifest);
  write('main.js', 'stale');
  assert.throws(() => validate(root), /Stale generated file/);
});

test('distribution includes only allowlisted assets with matching checksums, even with local state present', (t) => {
  const { root, write } = fixture(t);
  write('data.json', '{"private":"draft"}');
  write('Notes/private.md', 'Private note');
  write('dist/pikoboard/old-data.json', 'Stale output');
  const result = pack(root, '1.2.3');
  assert.deepEqual(fs.readdirSync(result.target).sort(), [...ASSETS, 'SHA256SUMS'].sort());
  for (const name of ASSETS) {
    const bytes = fs.readFileSync(path.join(result.target, name));
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, name)));
    const expected = crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name;
    assert.ok(fs.readFileSync(path.join(result.target, 'SHA256SUMS'), 'utf8').includes(expected));
  }
  fs.unlinkSync(path.join(root, 'LICENSE'));
  assert.throws(() => pack(root), /ENOENT/);
});
