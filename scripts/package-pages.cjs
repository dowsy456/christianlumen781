'use strict';

// Developer packaging only. The full source ZIP remains unchanged in scope;
// this second artifact contains the static assets Cloudflare Pages serves.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { sourceFiles } = require('./audit-upload-folders.cjs');
const requireDesktop = createRequire(path.join(__dirname, '../desktop/package.json'));
const AdmZip = requireDesktop('adm-zip');

const FOLDERS = new Set(['activities', 'activity-modules', 'assets', 'call-modules', 'css', 'js', 'vendor']);
const ROOT_FILES = new Set(['index.html', 'app.js', 'styles.css', 'call-config.js', 'desktop-capabilities.json', 'build-info.json', '_headers', '.nojekyll', 'THIRD-PARTY.md']);
const EXTRA_RUNTIME_FILES = new Set(['desktop/assets/chat-app.png']); // Used by the mobile stylesheet.
const FILE_LIMIT = 1000;
const BYTE_LIMIT = 25 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function isRuntimeFile(file) {
  return ROOT_FILES.has(file) || EXTRA_RUNTIME_FILES.has(file) || file.includes('/') && FOLDERS.has(file.split('/')[0]);
}

function inspectFiles(files) {
  if (!Array.isArray(files) || files.length > FILE_LIMIT) throw new Error(`Cloudflare dashboard uploads support at most ${FILE_LIMIT} files.`);
  const names = new Set();
  let totalBytes = 0, largestFile = { path: '', bytes: 0 };
  for (const file of files) {
    if (typeof file.path !== 'string' || !file.path || file.path.startsWith('/') || /[\\\x00-\x1f]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The Pages package contains an unsafe path.');
    if (names.has(file.path.toLowerCase())) throw new Error('The Pages package contains duplicate paths: ' + file.path);
    names.add(file.path.toLowerCase());
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > BYTE_LIMIT) throw new Error(`Cloudflare Pages files must not exceed 25 MiB: ${file.path}`);
    if (!isRuntimeFile(file.path) || /\.(?:exe|dll|lnk|pem|key)$/i.test(file.path)) throw new Error('Non-web or private material is not eligible for Pages: ' + file.path);
    totalBytes += file.bytes;
    if (file.bytes > largestFile.bytes) largestFile = { path: file.path, bytes: file.bytes };
  }
  if (!names.has('index.html')) throw new Error('The Pages package needs index.html at its root.');
  return { files: files.length, totalBytes, largestFile, dashboardFileLimit: FILE_LIMIT, maximumFileBytes: BYTE_LIMIT };
}

function localReference(from, value) {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return null;
  let pathname;
  try { pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { throw new Error('Invalid local asset URL in ' + from); }
  if (!pathname) return null;
  return path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(from), pathname));
}

function checkReferences(entries) {
  const content = new Map(entries.map(file => [file.path, file.data]));
  const requireAsset = (from, value) => {
    const asset = localReference(from, value);
    if (asset && !content.has(asset)) throw new Error(`Missing Pages asset ${asset}, referenced by ${from}.`);
  };
  for (const file of entries) {
    if (/\.html$/i.test(file.path)) {
      const text = file.data.toString('utf8');
      for (const tag of text.matchAll(/<(?:script|link|img|source|audio|video)\b[^>]*>/gi)) {
        for (const attr of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) requireAsset(file.path, attr[1]);
      }
    }
    if (/\.css$/i.test(file.path)) {
      for (const ref of file.data.toString('utf8').matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) requireAsset(file.path, ref[1]);
    }
  }
  const manifest = content.get('js/module-manifest.js');
  if (!manifest) throw new Error('Missing Pages module manifest.');
  for (const ref of manifest.toString('utf8').matchAll(/["']?src["']?\s*:\s*["']([^"']+)["']/g)) requireAsset('index.html', ref[1]);
}

async function buildPages({ sourceRoot = path.resolve(__dirname, '..'), zipFile, folder } = {}) {
  const root = path.resolve(sourceRoot);
  const zipPath = path.resolve(zipFile || path.join(root, 'dist/chat-pages.zip'));
  const folderPath = folder ? path.resolve(folder) : null;
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('Choose a .zip output filename.');
  if (folderPath && (folderPath === root || root.startsWith(folderPath + path.sep))) throw new Error('The Pages output folder cannot replace the source directory.');
  const { files } = await sourceFiles(root);
  const entries = [];
  for (const file of files.filter(isRuntimeFile)) {
    const data = await fs.readFile(path.join(root, file));
    entries.push({ path: file, data, bytes: data.length });
  }
  const report = inspectFiles(entries);
  checkReferences(entries);
  if (folderPath) {
    await fs.mkdir(folderPath, { recursive: true });
    if ((await fs.readdir(folderPath)).length) throw new Error('Choose an empty Pages output folder; existing files will not be deleted.');
    for (const file of entries) {
      const target = path.join(folderPath, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.data, { flag: 'wx' });
    }
  }
  // Standard ZIP32 + DEFLATE/STORE, with sizes and CRCs in every local header.
  // No encrypted entries, data descriptors, ZIP64, outer directory or symlinks.
  const archive = new AdmZip();
  const created = new Date();
  for (const file of entries) { archive.addFile(file.path, file.data); archive.getEntry(file.path).header.time = created; }
  const bytes = archive.toBuffer(), verified = new AdmZip(bytes);
  if (verified.getEntries().length !== entries.length) throw new Error('The Pages archive has unexpected entries.');
  for (const file of entries) {
    const entry = verified.getEntry(file.path);
    if (!entry || entry.isDirectory || entry.header.flags & 9 || ![0, 8].includes(entry.header.method) || !entry.getData().equals(file.data)) throw new Error('The Pages archive failed validation: ' + file.path);
  }
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  const temporary = path.join(path.dirname(zipPath), '.' + path.basename(zipPath) + '.' + crypto.randomUUID() + '.tmp');
  try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, zipPath); }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  return { ...report, zipFile: zipPath, folder: folderPath, archiveBytes: bytes.length, sha256: hash(bytes), createdAt: created.toISOString(), rootIndex: true, runtimeBytesPreserved: true, compression: 'ZIP32 DEFLATE/STORE; no data descriptors' };
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--out', '--folder'].includes(flag) || !value || value.startsWith('--')) throw new Error('Usage: node scripts/package-pages.cjs --out "chat-pages.zip" [--folder "empty-pages-folder"]');
    result[flag === '--out' ? 'zipFile' : 'folder'] = value;
  }
  return result;
}

module.exports = { buildPages, inspectFiles, checkReferences, isRuntimeFile, localReference };
if (require.main === module) buildPages(options(process.argv.slice(2))).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
