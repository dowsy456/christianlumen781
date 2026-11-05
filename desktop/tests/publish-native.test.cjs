'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signManifest, canonicalManifest, argumentsFor } = require('../scripts/publish-native.cjs');
const { validateManifest } = require('../native-updater.cjs');

function fixture() {
  const keys = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const bytes = Buffer.alloc(2048, 0);
  bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x00004550, 128); bytes.writeUInt16LE(0x8664, 132);
  return { ...keys, bytes, url: 'https://example.test/releases/1.7.7/Chat-App.exe', version: '1.7.7' };
}

test('publisher signs actual EXE hash and size using the shared canonical fields', () => {
  const inputs = fixture(), manifest = signManifest(inputs);
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'version', 'url', 'sha256', 'size', 'signature']);
  assert.equal(manifest.size, inputs.bytes.length);
  assert.equal(manifest.sha256, crypto.createHash('sha256').update(inputs.bytes).digest('hex'));
  assert.equal(crypto.verify(null, Buffer.from(canonicalManifest(manifest)), inputs.publicKey, Buffer.from(manifest.signature, 'base64')), true);
  assert.deepEqual(validateManifest(manifest, inputs.publicKey), manifest, 'installed updater accepts publisher output');
  assert.equal(crypto.verify(null, Buffer.from(canonicalManifest({ ...manifest, url: 'https://example.test/other.exe' })), inputs.publicKey, Buffer.from(manifest.signature, 'base64')), false);
  assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE KEY/);
});

test('publisher rejects wrong keys, unsafe URLs, non-release versions and invalid executables', () => {
  const inputs = fixture(), other = fixture();
  assert.throws(() => signManifest({ ...inputs, privateKey: other.privateKey }), /does not match/);
  for (const url of ['http://example.test/app.exe', 'https://user:secret@example.test/app.exe', 'https://example.test/app.exe#fragment', 'file:///app.exe']) assert.throws(() => signManifest({ ...inputs, url }), /HTTPS/);
  for (const version of ['1.7', '1.7.7-beta', '01.7.7', '1.7.100000', '1.7.9007199254740992']) assert.throws(() => signManifest({ ...inputs, version }), /three-part/);
  assert.throws(() => signManifest({ ...inputs, bytes: Buffer.from('<html>Download</html>') }), /EXE/);
  const malformed = Buffer.from(inputs.bytes); malformed.writeUInt32LE(0xffffffff, 60);
  assert.throws(() => signManifest({ ...inputs, bytes: malformed }), /AMD64/);
  const x86 = Buffer.from(inputs.bytes); x86.writeUInt16LE(0x14c, 132);
  assert.throws(() => signManifest({ ...inputs, bytes: x86 }), /AMD64/);
});

test('publisher CLI requires all explicit paths and rejects duplicates or unknown switches', () => {
  const args = ['--exe', 'app.exe', '--url', 'https://example.test/app.exe', '--key', 'secret.pem', '--out', 'native-update.json'];
  assert.equal(argumentsFor(args).key, 'secret.pem');
  assert.throws(() => argumentsFor(args.slice(0, -2)), /Required/);
  assert.throws(() => argumentsFor([...args, '--key', 'other.pem']), /Usage/);
  assert.throws(() => argumentsFor([...args, '--version', '9.9.9']), /Usage/);
});
