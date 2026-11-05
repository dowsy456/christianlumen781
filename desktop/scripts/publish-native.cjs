'use strict';

// Publisher-only tooling. Never included in the native runtime and never run
// by an installed Chat App. The private signing key stays outside this source.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function releaseURL(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('A public HTTPS EXE download URL is required.');
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('The EXE URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS download URL without credentials or a fragment.');
  return url.href;
}

function releaseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.split('.').some(part => !Number.isSafeInteger(Number(part)) || Number(part) > 99999)) {
    throw new Error('The native package version must be a stable three-part version such as 1.7.7.');
  }
  return value;
}

function canonicalManifest(value) {
  return JSON.stringify({ schemaVersion: 1, version: value.version, url: value.url, sha256: value.sha256, size: value.size });
}

function signManifest({ bytes, url, version, privateKey, publicKey }) {
  const signingKey = crypto.createPrivateKey(privateKey);
  if (signingKey.asymmetricKeyType !== 'ed25519') throw new Error('The native release signing key must use Ed25519.');
  const embeddedKey = crypto.createPublicKey(publicKey);
  if (embeddedKey.asymmetricKeyType !== 'ed25519') throw new Error('The embedded native release key must use Ed25519.');
  const expected = embeddedKey.export({ type: 'spki', format: 'der' });
  const actual = crypto.createPublicKey(signingKey).export({ type: 'spki', format: 'der' });
  if (!actual.equals(expected)) throw new Error('This private key does not match the public key shipped in Chat App. Keep using the original release signing key.');
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > 512 * 1024 * 1024) throw new Error('The EXE must contain between 1 KiB and 512 MiB.');
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('The input is not a Windows executable.');
  const pe = bytes.readUInt32LE(60);
  if (pe < 64 || pe + 6 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550 || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error('The native release must be a valid AMD64 Windows executable.');
  const manifest = {
    schemaVersion: 1,
    version: releaseVersion(version),
    url: releaseURL(url),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length
  };
  manifest.signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), signingKey).toString('base64');
  return manifest;
}

function argumentsFor(argv) {
  const flags = new Set(['--exe', '--url', '--key', '--out']);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!flags.has(flag) || typeof value !== 'string' || !value || value.startsWith('--') || Object.hasOwn(result, flag.slice(2))) throw new Error('Usage: node desktop/scripts/publish-native.cjs --exe "Chat App.exe" --url "https://host/Chat-App.exe" --key "private-key.pem" --out "native-update.json"');
    result[flag.slice(2)] = value;
  }
  if (Object.keys(result).length !== flags.size) throw new Error('Required arguments: --exe, --url, --key, --out.');
  return result;
}

async function publish(argv) {
  const options = argumentsFor(argv);
  const exePath = path.resolve(options.exe), keyPath = path.resolve(options.key), outputPath = path.resolve(options.out);
  if ([exePath, keyPath].some(value => value.toLowerCase() === outputPath.toLowerCase())) throw new Error('The output manifest cannot overwrite the EXE or signing key.');
  const [bytes, privateKey, keyDocument, packageDocument] = await Promise.all([
    fs.readFile(exePath), fs.readFile(keyPath, 'utf8'),
    fs.readFile(path.join(__dirname, '../native-update-key.json'), 'utf8'),
    fs.readFile(path.join(__dirname, '../package.json'), 'utf8')
  ]);
  const publicKey = JSON.parse(keyDocument).publicKey;
  const version = JSON.parse(packageDocument).version;
  const manifest = signManifest({ bytes, privateKey, publicKey, version, url: options.url });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = path.join(path.dirname(outputPath), '.' + path.basename(outputPath) + '.' + crypto.randomUUID() + '.tmp');
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporary, outputPath);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  // The private key is deliberately never logged or written to the output.
  return { output: outputPath, version: manifest.version, sha256: manifest.sha256, size: manifest.size, url: manifest.url };
}

module.exports = { canonicalManifest, releaseURL, releaseVersion, signManifest, argumentsFor, publish };
if (require.main === module) publish(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
