# Validation — shared web 2026.11.04-2

Native source remains 1.7.8. These are local checks for the requested shared-web refinements.

- Full included Node suite: 577 passed, 0 failed.
- Context placement at 1440×900, 390×844 and 390×230: all context surfaces, top/bottom Define, expanded Assets near the bottom, no scrolling when complete content fits, real wheel input and preserved offsets during observer/explicit relayout when it genuinely does not fit. Neutral Delete text and hover match ordinary actions. Screenshots visually reviewed.
- Define browser suite at 1440px/390px and shared audio menu animation suite passed.
- Message-polish desktop/mobile suite: actual reply-preview jump, no full outline, repeated-cue lifetime, one active cue, reduced motion, multiline URL connection, compact short/separate URLs, width changes, repeated stable measurement, unchanged confirmation/copy behavior, Open URL caption and font consistency. Existing sticker-search and receipt regressions also pass.
- Interface suite at 1440×900, 390×844 and 740×390: legacy local/remote right-side preferences cannot enable right layout; Sidebar Position absent; sidebar icon geometry unchanged on hover; equal centered Notepad controls; UI-bold room headers; existing shared-search/sticker behavior retained. Settings suite passed desktop/iPhone/Android emulation.
- Receipt verification left production code unchanged. 93 presence/call unit checks plus media-receipt, profile-receipt, room-loading and real Firebase SDK call-join tests passed. Visibility tests include offscreen/clipped message content, obscuring surfaces including pointer-events:none overlays, blackout/modal, inactive companion chat, unfocused windows and disconnected/expired sessions. Read receipts reflect displayed content, not human comprehension; existing historical receipts remain after a reader goes offline.
- Final menu-controls suite passed desktop/mobile URL confirmation, editor controls, icon centering, shared Leave controls, companion member close actions and sidebar wheel behavior. Companion suite passed activity/call layouts, resizing, menus and preserved the original chat with zero reopens.
- Obsolete right-sidebar cases in broader existing browser suites were updated to fixed-left behavior or ignored-legacy-request checks and syntax-checked; only the explicitly listed completed suites above were executed for this release.

No production database or accounts were used. Browser/mobile checks use local fixtures and Chrome device emulation, not physical phone acceptance. No new packaged EXE execution, native build, native redirect test or Avast scan was performed because native behavior did not change. No publication is claimed. The native public key and all desktop files are compared byte-for-byte against the supplied archive.

## Useful regression commands

```text
npm test
node tests/message-polish.browser.cjs
node tests/interface-refresh.browser.cjs
node tests/menu-placement.browser.cjs
node tests/definitions.browser.cjs
node tests/menu-controls.browser.cjs
node tests/audio-menu-animation.browser.cjs
node tests/people-settings.browser.cjs
node tests/companion-chat-v2.browser.cjs
node tests/media-receipts.browser.cjs
node scripts/audit-upload-folders.cjs
```

Keep captures outside the source tree. Existing tests were extended instead of adding files, preserving the 98-file tests folder under the upload limit.


## Final archive verification

Included upload audit passes: 386 files, 18 loose root files, largest folder tests 98; all original paths retained. Full counts are in RELEASE-INSTRUCTIONS.md. Every desktop file and the receipt/presence/call lifecycle/state modules match the supplied archive byte-for-byte. All local HTML/CSS asset references resolve. Shared version/cache metadata agrees. ZIP CRC and extracted bytes verified; index.html is at root. No generated dependencies/builds/captures or private signing material included.
