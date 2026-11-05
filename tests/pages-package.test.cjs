'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('../desktop/node_modules/adm-zip');
const { buildPages, inspectFiles, checkReferences, isRuntimeFile } = require('../scripts/package-pages.cjs');

test('Pages validation checks documented limits, root index and safe static paths', () => {
  assert.equal(inspectFiles([{ path: 'index.html', bytes: 10 }]).files, 1);
  assert.throws(() => inspectFiles(Array.from({ length: 1001 }, (_, i) => ({ path: 'js/' + i + '.js', bytes: 1 }))), /1000/);
  assert.throws(() => inspectFiles([{ path: 'index.html', bytes: 25 * 1024 * 1024 + 1 }]), /25 MiB/);
  assert.throws(() => inspectFiles([{ path: 'assets/Chat-App.exe', bytes: 100 }]), /Non-web/);
  assert.throws(() => inspectFiles([{ path: '../index.html', bytes: 10 }]), /unsafe/);
  assert.throws(() => inspectFiles([{ path: 'js/a.js', bytes: 10 }]), /root/);
  assert.throws(() => inspectFiles([{ path: 'index.html', bytes: 10 }, { path: 'INDEX.HTML', bytes: 10 }]), /duplicate/);
  assert.equal(isRuntimeFile('desktop/main.cjs'), false);
  assert.equal(isRuntimeFile('tests/runtime.test.cjs'), false);
  assert.equal(isRuntimeFile('backend/functions/index.js'), false);
  assert.equal(isRuntimeFile('assets/sounds/Ping.mp3'), true);
});

test('Pages asset audit catches missing CSS/HTML/module assets without requiring external CDNs locally', () => {
  const entry = (file, text) => ({ path: file, data: Buffer.from(text) });
  const files = [entry('index.html', '<script src="./app.js?v=2"></script><script src="https://example.test/cdn.js"></script>'), entry('app.js', ''), entry('js/module-manifest.js', '[]')];
  assert.doesNotThrow(() => checkReferences(files));
  assert.throws(() => checkReferences(files.filter(file => file.path !== 'app.js')), /Missing Pages asset app.js/);
  assert.throws(() => checkReferences([...files, entry('css/a.css', 'a{background:url(../assets/missing.png)}')]), /Missing Pages asset assets\/missing.png/);
  assert.throws(() => checkReferences(files.map(file => file.path === 'js/module-manifest.js' ? entry(file.path, '[{src:"js/missing.js"}]') : file)), /Missing Pages asset js\/missing.js/);
});

test('real Pages artifact preserves every static runtime byte with index at ZIP and folder root', async t => {
  const source = path.resolve(__dirname, '..');
  const scratchParent = path.resolve(source, '..', 'pages-package-test');
  await fs.mkdir(scratchParent, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(scratchParent, 'case-'));
  t.after(async () => { if (path.dirname(scratch) !== scratchParent) throw Error('Unsafe test cleanup'); await fs.rm(scratch, { recursive: true, force: true }); });
  const result = await buildPages({ sourceRoot: source, zipFile: path.join(scratch, 'chat-pages.zip'), folder: path.join(scratch, 'chat-pages') });
  assert.ok(result.files > 100 && result.files < 1000);
  assert.equal(result.rootIndex, true);
  const zip = new AdmZip(await fs.readFile(result.zipFile));
  for (const entry of zip.getEntries()) {
    assert.equal(entry.isDirectory, false);
    assert.equal(entry.header.flags & 9, 0);
    assert.deepEqual(entry.getData(), await fs.readFile(path.join(source, entry.entryName)));
    assert.deepEqual(entry.getData(), await fs.readFile(path.join(result.folder, entry.entryName)));
    assert.equal(isRuntimeFile(entry.entryName), true);
  }
  assert.ok(zip.getEntry('index.html'));
  assert.equal(zip.getEntry('desktop/main.cjs'), null);
  await assert.rejects(buildPages({ sourceRoot: source, zipFile: path.join(scratch, 'again.zip'), folder: result.folder }), /empty/);
});
