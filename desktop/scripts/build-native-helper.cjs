'use strict';
// Build-only compilation. The shipped application runs a fixed native helper.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function buildNativeUpdater() {
  if (process.platform !== 'win32') throw new Error('Build the native update helper on 64-bit Windows.');
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const output = path.resolve(__dirname, '../helpers/native-update-helper.exe');
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await execute(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/debug-', '/out:' + output,
      '/win32icon:' + path.resolve(__dirname, '../assets/chat-app.ico'),
      '/reference:' + path.join(framework, 'System.Web.Extensions.dll'), '/reference:' + path.join(framework, 'System.Windows.Forms.dll'),
      path.join(__dirname, 'native-update-helper.cs')], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  } catch (error) { throw new Error(String(error.stdout || error.message || 'Native updater compilation failed.')); }
  const binary = await fs.readFile(output);
  if (binary.readUInt16LE(binary.readUInt32LE(60) + 4) !== 0x8664) throw new Error('The native updater helper is not AMD64.');
  console.log('Built fixed 64-bit native update helper.');
  return output;
}
module.exports = { buildNativeUpdater };
if (require.main === module) buildNativeUpdater().catch(error => { console.error(error.message); process.exitCode = 1; });
