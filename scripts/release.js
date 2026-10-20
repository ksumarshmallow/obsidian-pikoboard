'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { artifacts } = require('./build.js');

const ASSETS = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt'];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function validate(root, tag) {
  const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const manifest = json('manifest.json'), pkg = json('package.json'), versions = json('versions.json');
  const demand = (condition, message) => { if (!condition) throw new Error(message); };
  demand(manifest.id === 'pikoboard' && manifest.name === 'PikoBoard', 'Unexpected plugin identity');
  demand(VERSION.test(manifest.version), 'Version must be x.y.z without a prefix');
  demand(VERSION.test(manifest.minAppVersion), 'Minimum app version must be x.y.z');
  demand(pkg.version === manifest.version, 'Package and manifest versions differ');
  demand(versions[manifest.version] === manifest.minAppVersion, 'Missing or mismatched compatibility entry');
  demand(!tag || tag === manifest.version, 'Release tag must exactly match manifest.version');
  demand(typeof manifest.description === 'string' && manifest.description.length <= 250 &&
    /^[A-Z][\x20-\x7e]+\.$/.test(manifest.description), 'Use a short English description ending with a period');
  demand(typeof manifest.author === 'string' && manifest.author.trim(), 'Author is required');
  demand(typeof manifest.isDesktopOnly === 'boolean', 'isDesktopOnly must be a boolean');
  demand(pkg.license === 'MIT', 'Check the distribution license');
  for (const name of [...ASSETS, 'README.md', 'docs/usage.md', 'docs/releasing.md'])
    demand(fs.statSync(path.join(root, name)).size > 0, `Empty required file: ${name}`);
  for (const [name, expected] of Object.entries(artifacts(root)))
    demand(fs.readFileSync(path.join(root, name), 'utf8') === expected, `Stale generated file: ${name}. Run npm run build.`);
  return manifest;
}
function pack(root, tag) {
  const manifest = validate(root, tag);
  const target = path.join(root, 'dist', 'pikoboard');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const sums = [];
  for (const name of ASSETS) {
    const bytes = fs.readFileSync(path.join(root, name));
    fs.writeFileSync(path.join(target, name), bytes);
    sums.push(crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name);
  }
  fs.writeFileSync(path.join(target, 'SHA256SUMS'), sums.join('\n') + '\n');
  return { target, version: manifest.version };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), [command = 'check', tag] = process.argv.slice(2);
  try {
    if (command === 'pack') console.log('Release files ready', pack(root, tag));
    else if (command === 'check') console.log('Release checks passed for', validate(root, tag).version);
    else throw new Error('Usage: node scripts/release.js check|pack [version]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { ASSETS, validate, pack };
