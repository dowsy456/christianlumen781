# Publish shared web 2026.11.04-2

This package is prepared locally. No GitHub shared source, Cloudflare deployment, Firebase change or native release asset was published during this work.

1. Extract chat.zip. index.html and all top-level folders must be directly at the root, without an enclosing chat folder.
2. Upload each complete top-level folder separately to the existing shared-web GitHub repository, including all its subfolders. Upload loose root files together last, including index.html, build-info.json, desktop-capabilities.json, package.json and .nojekyll. Complete the entire release before asking users to update.
3. Use the existing shared update configuration. No Admin Tools setting change is needed. Existing Windows 1.7.8 hosts receive the release through their shared web updater; browser and mobile use the same shared source.
4. No new EXE or native-update.json is supplied or required. Leave the native manifest URL `https://github.com/dowsy456/chat-app-desktop/releases/latest/download/native-update.json`, native version and Older EXE migration setting unchanged. Version 1.7.7 still follows its established one-time move to 1.7.8.
5. After you publish, verify the shared web version 2026.11.04-2 on your actual accounts/devices. Test menu placement at window edges, long URLs, Notepad controls and message jumps. Local regression tests used isolated Firebase fixtures and browser emulation.

All 386 files from the latest supplied source archive are retained. No source file was deleted or relocated. Every desktop source/helper/public-key file, read-receipt module, app-presence module and call lifecycle/state file remains byte-identical to the supplied ZIP. Source packaging excludes dependencies, generated builds/captures and private signing material.

## Future releases

Run `npm ci --ignore-scripts`, `npm test` and the relevant browser commands from VALIDATION.md. Keep all shared revision fields/cache suffixes consistent and stamp build-info.json when packaging. Run the included upload-folder audit. Read NATIVE-UPDATES.md before any native updater work; do not bump native versions or touch signed manifests for shared-only changes.

## Final upload counts

| Upload selection | Files including subfolders |
| --- | ---: |
| Loose root files | 18 |
| activities | 19 |
| activity-modules | 9 |
| assets | 11 |
| backend | 5 |
| call-modules | 17 |
| css | 35 |
| desktop | 85 |
| js | 83 |
| scripts | 3 |
| tests | 98 |
| vendor | 3 |

Total: **386 source files**, all 386 supplied paths retained. Every selection passes. Packaged: `2026-11-05T02:31:38.731Z`.
