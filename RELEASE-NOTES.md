# Shared web 2026.11.04-2 — menu and interface refinements

Prepared locally from the latest supplied source. Native host remains 1.7.8. No publication or native build occurred.

## Requested refinements

1. Removed destructive-action red text and red hover backgrounds from context menus; icons/actions/permissions are preserved.
2. Removed sidebar icon hover transforms/animations. Ordinary hover/focus feedback remains.
3. Removed Sidebar Position from Settings, preference schema and boot cache. Old right-side values cannot enable the layout; compatibility helpers return left. Explicit right-sidebar CSS branches were removed. Independent activity/call/media features are retained.
4. Context-menu placement uses the full visual viewport. It preserves its location when it fits, flips or clamps when needed, and scrolls only for content taller than the viewport. Placement no longer removes its height constraint temporarily or reacts to internal wheel scrolling, so scroll positions are not reset. Define uses the same outer scroller without an artificial inner height cap.
5. Search, pin, reply-preview and other message jumps share a 1.1-second soft wash and leading accent, with no surrounding blue box. New jumps cancel previous cue timers and restart correctly. Reduced motion avoids animated scrolling/highlight motion.
6. Seen-by visibility behavior already met the request. Its receipt, presence and call lifecycle source remains byte-identical to the supplied ZIP. Focused tests covered offscreen/clipped content, obstructing overlays, hidden/unfocused windows, disconnected sessions and history ownership.
7. Long inline URLs fill the gap between vertically overlapping fragments of that same URL. Short/single-line links and separate URLs keep their normal decoration. Reflow, font readiness and message rendering update the measurement. Link confirmation/copy/navigation behavior remains unchanged.
8. Notepad's previous/next controls have equal sizes and centered icons. Room-section headings use the UI's bold font and align with the controls. The URL explanation uses the same UI font; the action/title now say Open URL.

## Future maintenance

Keep context menus on the shared lifecycle/placement helpers in js/ui/chat-popovers.js. Do not constrain them to the original side's small free area or remove max-height to measure: both caused the reported bugs. Use actual wheel tests on oversized menus and verify smaller content fits without scrollbars at both viewport edges.

Do not restore sidebarPosition to the settings schema or reintroduce right-sidebar CSS. Left-only compatibility helpers remain for internal callers; they cannot enable right positioning. Test old persisted right values before first paint and after sign-in.

Keep URL connection measurement batched (read all fragments, then write styles), based on actual overlapping line rectangles. Vertical padding must not change inline layout or turn links into block buttons. Keep single-line and wrapped-to-unwrapped tests. All message jump call sites must use App.flashMessage / App.scrollToMessageKey so the cue stays consistent.

---

# Historical release notes (superseded where the refinements above apply)

# Shared web 2026.11.04-1 — interface and reliability

Native host remains 1.7.8. This package is prepared locally and is not published.

## Message content and receipts

Reply previews size to their content so attachment icons no longer drift to the far edge. URLs are inline, selectable controls that fragment across wrapped lines and preserve the existing link-confirmation popup and keyboard access. Room message search includes sticker snapshot and cached metadata names, with straight/curly apostrophe normalization.

The seen-by row retains profile pictures in a compact pill, with 140ms arrival and 100ms retirement. Active receipt ownership is removed immediately when latest changes. The database listener observes the room's `_latest` marker as well as readers, preventing stale history tails from showing or saving readers on an older message. Writes require a fresh acknowledged presence lease, live connection, active visible window, unobstructed message content, and a continuous 450ms dwell. Disconnect/reconnect generations invalidate pending eligibility. Failed writes retry; the UI uses acknowledged values. Both ordinary and system sends prune older receipts, independent of unread-counter success. Existing receipts are historical facts and are not deleted simply because a reader goes offline. All clients should load this release; old client code can still write its legacy receipt paths.

## Interface

Settings, Notepad, Stickers and the room header share one responsive search component style. Notepad has a clearer filename/actions row, previous/next match navigation, match totals, keyboard shortcuts, word/line counts and draft status. Plain-text persistence and download functions are preserved, including protection from slow file imports overwriting newer edits.

Room rows retain their avatar sizes with clearer active/hover states and typography. Noninteractive Public Rooms headings use a normal cursor. A room-filter toggle is truly hidden when the account has no private rooms. Owner-only Admin Tools sits left of Settings at the same size. Sidebar icon controls share hover/focus motion and reduced-motion support. Offline dots use solid #80848e. Sticker changes are inside the existing popover shell: shared search, clearer tiles, and two-line names.

Context menu surfaces share positioning and animation helpers and compact themed styling with icons. Dropdown expansion retains the chosen anchor and clips/scrolls when space runs out. Define is offered for eligible words and short selected phrases without waiting for a network fetch. It loads on demand, deduplicates senses and prioritizes modern meanings across word classes; source links provide full dictionary entries. Network failures remain retryable.

## Call joining

A reproduced cached-sign-in race allowed stale cleanup to remove new membership and signaling. Cleanup now checks account/lifecycle/session ownership transactionally. Leave cancels an in-flight join promptly and quietly. Delayed microphone results dispose only their own tracks and do not tear down replacement calls. See CALLING.md and the focused regression tests.

## Maintenance

Use shared search classes from css/interface-refresh.css. Use the context-menu lifecycle and placement helpers in js/ui/chat-popovers.js for future context menus instead of adding separate open/close transforms. Preserve room-level receipt compare-and-swap ordering; never infer a read from room presence alone. Keep call cleanup conditional on the exact session that created the record. Shared updater and native host behavior were not changed.

---

# Previous release notes (historical; not publishing instructions for this package)

# Release 2026.11.03-2 / Windows 1.7.8 — native update repair and Pages package

- Fixed the confirmed Electron-specific GitHub redirect failure. Electron net.fetch with manual redirects rejected the request with "Redirect was cancelled"; the updater now adapts Electron ClientRequest redirect events while checking every HTTPS hop before proceeding. The real public feed and complete published EXE download were verified with this transport and the unchanged publisher key.
- Failed version checks now say Check unavailable, show visible Checking progress on retry, and explain the error when explicitly clicked. A successful check with no newer native version clears the badge. Download/install errors remain distinct, and an available shared-web update remains usable.
- Version 1.7.7 requires a one-time manual upgrade to 1.7.8 because its broken native transport cannot fetch the repair from GitHub. The shared app can show that repair link for exactly 1.7.7 after the admin publishes/configures a newer legacy link. Newer updater-capable hosts retain automatic native updates.
- Keep the native manifest URL unchanged. Publish the new EXE and signed JSON together in latest normal release v1.7.8; do not overwrite the old v1.7.7 assets. All signing keys, user-data locations, launch behavior and the shared GitHub web system are retained.
- Added chat-pages.zip: a standard, deployment-only Cloudflare archive with 185 files and root index.html. The full chat.zip preserves all 377 supplied source paths, plus five implementation/test/guide files (382 total). Largest source upload folder: tests94; desktop85; loose root20.
- The supplied full ZIP passed decompression/CRC and file-limit checks. The screenshot did not establish why Cloudflare rejected its upload. The new static package and extracted-folder alternative remove development/native material from Pages uploads; a live successful dashboard upload is still separate from local validation.
- Follow SIMPLE-UPDATE-STEPS.txt, CLOUDFLARE-PAGES.md and the revised FUTURE-UPDATE-PROMPT.txt.

---

## Earlier release records

# Release 2026.11.03-1 / Windows 1.7.7 — unified updates

- Replaced the desktop update text button with a themed software-update icon, progress and retry states. It handles shared-web updates, native updates, or both.
- Added signed HTTPS native update discovery, streamed download, signature/hash/size/AMD64 verification, and a fixed compiled Windows replacement helper. It updates the original portable EXE path and reopens the app without runtime shell scripts or an installer.
- The helper stages and verifies replacement/recovery bytes before the app closes, waits for that exact process, swaps the EXE, and restores the previous file if launch fails. Calls, drafts, recordings and uploads are checked again immediately before committing the restart.
- Combined updates stage the verified shared-web release for the new native host; an offline restart can use it, and the previous known-good web release is retained until successful boot.
- The Admin Panel now has Native update manifest URL and separate Older EXE download URL. Existing legacy links remain compatible. Native 1.7.7 is the one-time migration release.
- Native release hosting is prepared for public GitHub Releases at dowsy456/chat-app-desktop. Upload Chat-App.exe and native-update.json to tag v1.7.7, then set the stable manifest URL described in NATIVE-UPDATES.md. These local files are not yet published.
- All 363 original source paths are preserved; 14 required implementation/test/documentation files were added. Final source count: 377. Largest upload folder: tests, 93 files; desktop: 84; loose root files: 18. The EXE belongs in GitHub Release assets, separately from the source uploader.
- Keep the separately supplied private signing key private and backed up. FUTURE-UPDATE-PROMPT.txt explains future native releases and shared-web-only updates.

---

## Earlier release records

# Release 2026.10.31-2 — call menu polish

- Sidebar Call Overlay now uses the main call menu button component and its green active/hover styling, icon, transitions, pressed/focus/disabled states and tooltip. It continues to fit its sidebar grid.
- Removed Refresh Microphone from Input Settings and removed the routine RNNoise description. Automatic microphone recovery, device changes, suppression, sensitivity and account persistence remain functional. Error-only status messages remain available.
- All 363 supplied source paths are preserved. Largest top-level folder: 92 files; loose root batch: 16 files. Native source is unchanged. Publish the shared web source through the existing update system.

---

## Earlier release records

# Release 2026.10.31-1 — mobile calls, media and microphone controls

The web source supplies all changes to web, EXE and APK through the existing updater. Both supplied native binaries and all desktop native source files are preserved. Copies and ZIP entries are newly packaged; the native applications are not rebuilt.

Fixed mobile call-control visibility, companion composer sizing, room header search/gap, scoped media pinch/pan, and the opaque media viewer header. Optional remote video settings cannot block displaying an attachment. Added manual account-saved microphone sensitivity (-100..0 dB, default -70) and account-saved RNNoise/Standard/None suppression (default None). Real outgoing audio processing is used. RNNoise is the approved free alternative to Krisp and is labeled accurately. Its neural noise processing runs locally using an embedded model.

Removed the main call connection label while retaining sidebar status. Added sidebar Call Overlay in the same supported hosts as the main control. Removed the calendar month icon and persistent non-today selection highlight.

All 363 original source paths remain, with a maximum of 92 files per top-level folder and 16 loose root files. Upload folders separately, then root files. No hosting, storage or Firebase production changes were made by packaging.

---

## Earlier supplied release records

# Release 2026.10.30-1 / Desktop 1.7.6

- Grade 9–10 Full Day, Half Day (noon dismissal), and 2 Hr Delay use the supplied bell times. Vinny can edit each person's period start/end times and class details independently for each day type. Existing class assignments are preserved. The existing Admin Panel chooses the shared day type.
- Mobile navigation follows horizontal swipes, revealing the rooms/members pane with chat still visible at the edge. Companion members use the full chat region with correct stacking. Colors match desktop; mobile call controls remain usable down to 320px.
- Mobile Return inserts a newline. The composer Send button sends messages and saves edits. Keyboard viewport changes retain the latest-message position or the user's reading position, and keep Send above the keyboard.
- Calls retain healthy media during signaling interruptions, debounce network handoffs, suspend recovery attempts while offline, and recover with bounded backoff. An unrecovered connection leaves call state instead of remaining falsely connected. TURN UDP/TCP/TLS uses the supplied service alongside retained STUN/direct candidates; automatic routing cannot guarantee service on networks needing an unavailable relay.
- Room message insertion yields between small batches; offscreen avatars/media defer work until visible. The retained room/history cache and live message behavior remain.
- Dialogs use a short 100–120ms opacity/translation transition without backdrop blur, one X dismissal control, and contextual header actions instead of the fixed footer. Settings has compact category navigation and independent columns; password actions live in Account.
- Slash focuses the login password. Enter still logs in.
- Windows tray appears while the window is open. The unread count draws a native taskbar overlay in memory, retaining the app's base icon. Installed web apps use the browser badge API where available.
- Removed the 100 numbered unread PNG files from the deliverable as requested. The other 363 original source paths are retained; no source paths were added. Each top-level folder contains at most 92 files, and the 16 root files form one upload batch.
- EXE rebuilt from desktop source and this shared web tree, preserving the original launcher, updater and helper. APK host copied byte-for-byte as requested because it needs no native changes. No runtime PowerShell, AV exclusions, or security changes were introduced.

See VALIDATION.md for measured tests and physical-device limits. Publishing the web source and installing the new EXE are still required to activate this release on existing installations.

---

# Release 2026.10.28-1 / native binaries preserved

- B2 remains the primary file store. New uploads automatically fall back to the independent Cloudflare KV reserve after eligible B2 quota, permission or service failures. The backup accepts the current 100 MB app limit (100 MiB), uses signed binary parts, and verifies completion before publishing a file reference.
- Existing B2-only files are not replicated. KV has a 1 GB account allowance and finite daily operations; its replication may delay visibility for about a minute or longer. This is a bounded free fallback, not 200 GB or unlimited storage. Neither plan was upgraded and no card was added.
- Known quota failures stop immediate retry storms. Successful file reads allow five minutes of private browser caching. Shared/public caching is not enabled.
- Clear and HTML Delete carry exact object references, preserve pins/new messages, and retain compact retry records when storage cleanup fails. Pending backup chunks expire; committed files do not. An hourly Worker cleanup revisits old cancellation/deletion markers to remove late writes.
- All code changes live in shared web files and the existing README Worker. Supplied EXE/APK binaries are preserved byte-for-byte; their built-in GitHub updater receives the new web release after publication. No native launcher, runtime PowerShell, antivirus exclusions or security bypasses were added.
- All 463 source paths remain; each top-level folder contains at most 92 files. Upload one folder at a time at the repository root, then upload the 16 loose root files together.

The Worker and FILE_BACKUP namespace are live. Publish the shared source ZIP to activate automatic failover in clients. See VALIDATION.md for checks and limits.

---

# Release 2026.10.25-1 / Desktop 1.7.5 / Android 2026.10.25

- B2 transfers use independently retried multipart uploads with three concurrent parts. Binary bytes stay outside Firebase. The Worker verifies the assembled size before the final attachment reference is published. A bounded Worker relay handles direct-upload CORS failures, including mobile WebViews.
- Upload failures report the underlying cause. Transient retries cover web, EXE and APK. Disconnect/cancellation handling preserves successfully committed chat and HTML library files. B2 version deletion runs in bounded parallel batches.
- Android's real origin is `https://appassets.androidplatform.net`. Add it to the storage Worker's ALLOWED_ORIGINS. This release requires deploying the updated Worker in README.md; updating the website or APK alone does not deploy Cloudflare code.
- Native incoming-call popups accept the first click, periodically restore their topmost position without activating on arrival, and recover from a crashed popup renderer. Join restores Chat App, waits for an existing call transition and joins the selected room; a failed join keeps the invitation available to retry.
- Minecraft launcher presence now reads “Playing Minecraft on Dawn Client” (and the corresponding detected launcher). Added/repaired Minecraft Dungeons, Minecraft Dungeons II, Minecraft Legends, both Minecraft: Story Mode editions and Palworld recognition with authentic embedded game artwork.
- Desktop 1.7.5 is rebuilt from the supplied desktop source for native popup/detection changes. Its portable launcher and GitHub update mechanism remain intact. Shared upload and presence UI changes remain in the web source. No runtime PowerShell, injection, antivirus exclusions or security-setting changes were added.
- Android is freshly packaged with the same native DEX and signing certificate as the supplied APK, the repaired shared web assets and an increased installation version. Install it over the existing APK to retain local data.
- All 463 original source file paths are retained, and every top-level folder stays below 100 files recursively. Upload each top-level folder separately at the repository root; upload the 16 loose root files together last. Dependencies and build output are excluded.

Large-file transfer time still depends on bandwidth, network stability and provider quotas. The local tests do not constitute live B2 or physical Android-device acceptance. Ordinary Windows topmost windows cannot override the secure desktop or guarantee visibility over true exclusive fullscreen. Antivirus verdicts cannot be guaranteed for an unsigned application. See VALIDATION.md for measured checks.

---

# Release 2026.10.23-1 / Desktop source 1.7.4

- Default file upload limit remains 100 MB per file. Vinny's Admin Panel now has only the File Upload Limit label and a text input directly below Update URL. Valid numeric MB changes save automatically to Firebase at admin/fileUploadLimitMB and update connected clients in real time.
- All upload entry points and the send/upload checks use the current limit. Positive decimal MB and values above 100 are supported. Lowering the limit does not invalidate existing stored-file references. Invalid values and failed writes remain unsaved and are reflected through the input's validation state.
- The existing README storage Worker now reads the current Firebase limit for each upload request. Deploy this updated Worker once; later limit changes need no deployment. The native clipboard bridge source accepts the current byte limit; rebuilding the desktop app is required for Explorer clipboard pastes above an installed EXE's fixed limit. Upload and drag-and-drop use shared web code.
- All 463 original source files and paths remain. Every top-level folder has at most 92 files recursively, so each can upload separately through GitHub's website. The whole-project browser selection limit is controlled by GitHub; use Git or GitHub Desktop for one whole-project operation.

No production Firebase, Worker, B2 or GitHub data was changed. No executable was built or included. See VALIDATION.md for the checks performed on this release.

---
# Release 2026.10.18-2 / Desktop 1.7.4

- Cameras now use the same Screen sound category as screen sharing for starting, stopping and viewer changes, on web and desktop. Screen and camera generations are tracked independently, with local confirmation deduplicated against realtime echoes.
- Desktop ping popups are suppressed only when the app is visible and focused in the pinged room. Opening that room dismisses its existing popups; other rooms' concurrent pings stay visible. Returning from another application, restoring a minimized window, switching rooms and delayed message fetches recheck this policy.
- Desktop ping surfaces accept mouse clicks immediately, without a cursor-polling race. Clicking raises and focuses Chat App, opens the destination only if needed and uses the same bounded history jump and highlight as Filters/Pins. Consecutive clicks serialize room entry so the newest destination wins even while an activity closes.
- Push Notifications, DND privacy/sound behavior, three-second lifetime, close animation and separate ring popup handling are preserved.

Desktop 1.7.4 must be installed for the native popup input and focus changes. Shared sound/navigation changes remain in the web source and use the existing GitHub update system. The portable launch mechanism is unchanged. No runtime PowerShell scripts, antivirus exclusions or security-setting changes were added.

All 463 original source file paths are retained. Each top-level folder contains at most 92 files recursively; upload one top-level folder at a time at the repository root, then the 16 loose root files. Selecting the entire project still exceeds GitHub's 100-file selection limit.

See VALIDATION.md for tests and limits.

---

# Release 2026.10.18-1 / Desktop 1.7.3

- Removed the watched-camera label icon; the viewers eye sits after the zoom percentage and opens an unclipped tooltip.
- High screen/camera zoom uses a bounded visible crop instead of an enormous transformed video layer. Focused, fullscreen and Multi Screen View retain per-feed zoom and pan.
- Watching survives call-menu dismissal. Hiding multi-view controls retains the same column layout and increases available media area. Ordinary call grids center incomplete rows; minimum panel sizing preserves readable avatars, previews and controls.
- Desktop signed uploads handle opaque/custom origins and missing optional Electron request metadata. Transient transfer failures retry the same object before publishing its descriptor.
- Ring/Stop updates optimistically with session-scoped cleanup. Stale member snapshots cannot cancel fresh invitations. Desktop DND waits for account policy before playing blocked sounds or showing rings; it silences an invitation without declining it.
- Desktop DND ends after six hours or the next 6 AM, using the same network-adjusted time and timezone as Time Display, with a persisted deadline and offline retry.
- Native ring windows are prewarmed and shown without activation. Desktop ping notifications use an independent bottom-right stack, retain Push Notifications control, last three seconds with an exit animation, close via X, and open the exact message. DND retains the popup but removes its message preview and sound.
- Join Call uses an upright handset. Blackout cloak immediately publishes Idle, and Tab Name/Icon/Presets are omitted from desktop settings.
- Caden's Monday-Friday schedule matches the supplied screenshots; lunch is retained, room codes omit H, and homeroom stays after Period 1.

The EXE was rebuilt because popup-window and upload-origin changes require native code. It still loads shared web releases through the existing GitHub updater and uses the existing portable launcher. No runtime PowerShell scripts, antivirus exclusions, or security-setting changes were added.

The ZIP retains all 463 original file paths. Each top-level folder has at most 92 files recursively; upload each folder separately at the repository root, followed by the 16 root files. GitHub's 100-file selection limit still applies to selecting the entire project at once. See VALIDATION.md for executed checks and remaining live-environment limits.

---

# Release 2026.10.14-5

- Natural scrolling for multi-page PDF, DOCX and PPTX and text/HTML previews; no document zoom badge or wheel interception. Image/video zoom remains.
- Focused, fullscreen and multi-view screen/camera zoom with a 100% minimum, bounded drag-to-pan, independent per-feed state and reliable click-versus-drag handling. Unfocused tiles cannot zoom. Leaving the viewing mode resets zoom and pan.
- Frame-coalesced per-tile transforms avoid global layout work during wheel/drag input. The existing source resolution, encoding and network budgets remain in place; magnification cannot add missing source pixels.
- Compact zoom status and viewers button; viewers attached to the label. Transparent multi-view backgrounds retain the label, viewers and percentage while omitting minimize/fullscreen/close actions.
- Multi Screen View button moved left of Show Chat with matching styling; the tooltip changes to Hide Chat when chat is open.
- Blackout cloak reads the active saved shortcut instead of a stale legacy setting. Default Shift+Z, custom chords, shortcut editing and reload persistence are repaired. Escape no longer closes application modals.

The preceding account, media, voice, screen pause/mute, mobile chat and attachment embed changes remain included. All 463 source paths and existing upload/storage configuration are preserved. Each top-level folder remains below 100 files. Upload folders separately, then the 16 loose root files. Uploading all 463 files in one operation requires Git/GitHub Desktop; ZIP changes cannot remove GitHub's browser selection limit.

No production Firebase, B2, Worker or GitHub changes were deployed. Native desktop version remains 1.7.2. See VALIDATION.md for executed checks. ZIP timestamps and build-info.json are refreshed during final packaging.
