'use strict';
// Audit source deliverables before zipping. Generated development artifacts
// are not source and are excluded from both this count and release packaging.
const fs = require('node:fs/promises');
const path = require('node:path');
const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'test-results', 'unread-icons', 'unread-icons-extra']);

async function sourceFiles(root) {
  const files = [], excluded = [];
  async function visit(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Source package must not contain symbolic links: ' + relative);
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name)) { excluded.push(relative); continue; }
        await visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) files.push(relative);
      else throw new Error('Unexpected source entry: ' + relative);
    }
  }
  await visit(path.resolve(root), '');
  return { files: files.sort(), excluded: excluded.sort() };
}

async function audit(root) {
  const { files, excluded } = await sourceFiles(root);
  const folders = {}, rootFiles = [];
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash < 0) rootFiles.push(file);
    else { const top = file.slice(0, slash); folders[top] = (folders[top] || 0) + 1; }
  }
  const overLimit = Object.entries(folders).filter(([, count]) => count > 100).map(([folder, count]) => ({ folder, count }));
  if (rootFiles.length > 100) overLimit.push({ folder: '(loose root files)', count: rootFiles.length });
  const privateKeys = files.filter(file => /(?:^|\/)(?:[^/]*private[^/]*\.pem|native-update-signing-key\.pem)$/i.test(file));
  if (privateKeys.length) throw new Error('Private signing keys must never be packaged: ' + privateKeys.join(', '));
  return { totalFiles: files.length, rootFileCount: rootFiles.length, folders, excludedGeneratedDirectories: excluded, overLimit, ok: overLimit.length === 0 };
}

module.exports = { sourceFiles, audit };
if (require.main === module) audit(process.argv[2] || path.join(__dirname, '..')).then(report => {
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });
