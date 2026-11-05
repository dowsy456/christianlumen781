# Chat App — shared web 2026.11.04-2 / existing Windows host 1.7.8

This is a shared-web-only refinement release based on the latest supplied chat.zip. Publish this complete source package through the existing shared GitHub workflow. Windows 1.7.8 receives it through the shared web updater; browser and mobile use the same source. No EXE, native version, native manifest or verification key changed. Nothing was published during preparation.

Read RELEASE-INSTRUCTIONS.md for upload steps and final counts, RELEASE-NOTES.md for changes, and VALIDATION.md for checks and limits. build-info.json records the current package timestamp.

## Changes

- Context menu actions use neutral text and hover colors. Menus flip or move into the viewport to show their contents; scrolling is needed only when content exceeds the whole viewport. Necessary scrolling retains its position during layout and expansion. Define has no separate arbitrary scroll cap.
- Sidebar Position is removed from Settings and the saved preference schema. Old local values are removed and old remote right-side preferences are ignored. The sidebar remains left. Sidebar icon hover movement is removed, including Settings; normal hover colors remain.
- Public Rooms / All Rooms headings use the bold UI font with centered alignment. Notepad's previous/next arrow buttons have equal dimensions and centered icons.
- All message-jump entry points share a soft transient wash and slim leading accent, replacing the blue outline box. Repeated jumps restart the cue safely. Reduced-motion users get a static cue and immediate scrolling.
- Wrapped fragments of the same URL connect vertically only when they overlap. Short URLs remain compact, separate links remain separate, and width/font changes recalculate the connection. URLs remain inline/selectable and retain confirmation behavior. The popup uses the app's font and says Open URL.
- Seen-by was audited and tested, and left unchanged: it already requires actual focused, unobstructed visible message content for a continuous 450ms, latest-message ownership and a fresh acknowledged connection. Call fixes are also unchanged.

## Maintenance

Keep index.html at the archive root. Every supplied source file is retained. Run `node scripts/audit-upload-folders.cjs` before packaging; each complete top-level folder including subfolders and the loose root selection must be at most 100 files. Exclude node_modules, dist, test captures and signing secrets.

Shared version/revision metadata belongs in package.json, package-lock.json, build-info.json, desktop-capabilities.json and the entry/runtime/activity loader cache suffixes. Native updates are separate: read NATIVE-UPDATES.md before modifying that system. No native or shared admin update setting needs changing for this release.

The storage instructions below are historical documentation retained from the supplied package. This release does not change storage services or configuration.

## Free external file storage — setup required once

Use **Backblaze B2 Cloud Storage + Cloudflare Workers Free**. No Firebase Storage, R2, paid Worker plan or Firebase Functions deployment is required. B2 includes the first 10 GB of storage; Workers Free includes 100,000 requests per day. Downloads travel through the Worker to use the Backblaze/Cloudflare free-transfer integration. Free storage is finite: 10 GB is roughly 95 files at the maximum 100 MiB size, or many more smaller files. There is no unlimited permanent free cloud storage promise. Keep the accounts free and without a billing method; if a screen requires payment, stop instead of upgrading. B2 public buckets may require a payment history, so **create a private bucket** and use the Worker below.

Sources: [B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [private buckets and public-bucket requirements](https://www.backblaze.com/docs/cloud-storage-create-and-manage-buckets), [B2/Cloudflare free transfers](https://www.backblaze.com/docs/cloud-storage-cloudflare-integrations), [Workers Free pricing](https://developers.cloudflare.com/workers/platform/pricing/).

1. Create a free B2 Cloud Storage account at Backblaze. Do not purchase Computer Backup. Leave billing unset and keep the free caps; in Caps & Alerts keep any spending caps at $0. Quota exhaustion should stop requests, not trigger an upgrade. Free plans also have API-operation limits.
2. Create a **new private bucket just for this app**, for example a unique name beginning chatapp-files-. Do not enable Object Lock or retention rules that prohibit deletion. Note its S3 endpoint, such as https://s3.us-west-004.backblazeb2.com; the middle part is the region. Do not set rules that expire current files if you want long-term retention.
3. Create an application key restricted to that bucket, with read/write/list/delete permissions. Save its keyID and applicationKey privately. The Worker needs to list and permanently delete object versions. Never paste these secrets into GitHub, call-config.js, Firebase, screenshots or chat.
4. Enable browser PUT uploads on the bucket. The simple web-console download CORS option is insufficient. Install the official [B2 command-line tool](https://www.backblaze.com/docs/cloud-storage-command-line-tools), then run its interactive account authorization locally using a key allowed to update bucket CORS. Use your master key only for this local setup if necessary, never in the app. The [official CORS guide](https://help.backblaze.com/hc/en-us/articles/360010522673-B2-CLI-CORS-rules-in-the-command-line) documents this step; the [current CLI reference](https://b2-command-line-tool.readthedocs.io/en/master/subcommands/bucket_update.html) confirms the command syntax below. In **PowerShell 7.3 or newer**, with the downloaded executable renamed b2.exe:

```powershell
.\b2.exe account authorize
$chatCors = '[{"corsRuleName":"chat-app-direct-uploads","allowedOrigins":["*"],"allowedHeaders":["content-type"],"allowedOperations":["s3_put"],"exposeHeaders":["etag"],"maxAgeSeconds":3600}]'
.\b2.exe bucket update --cors-rules $chatCors YOUR_BUCKET_NAME allPrivate
.\b2.exe account clear
```

The wildcard allows browser origins to send an already signed PUT. Native version 1.7.3 handles signed-upload custom origins, missing optional Electron request metadata, and successful opaque CORS responses. The rule does not make the B2 bucket public. This command replaces CORS on the new dedicated bucket only. If you use a different shell, follow its argument-quoting instructions from the linked guide.

5. Create a **Cloudflare Workers Free** account and a Worker with a workers.dev address. Open Edit Code, replace the default module with the complete Worker code at the end of this README, and deploy it. There is no package install or build step for the Worker. Keep the Free plan; no R2 bucket is needed.
6. In the Worker's Settings → Variables and Secrets, set B2_KEY_ID and B2_APP_KEY as **secrets**. Set B2_BUCKET to your bucket name, B2_REGION to its region (for example us-west-004), and ALLOWED_ORIGINS to a comma-separated list of app origins. For this app: https://chatapphs.pages.dev,null,chatapp://app,https://appassets.androidplatform.net. An origin has no repository path or trailing slash; null permits local file openings. Use the actual desktop origin if it differs. Redeploy after saving settings.
7. Set only the public Worker URL in the existing call-config.js:

```javascript
globalThis.CHAT_FILE_CONFIG = globalThis.CHAT_FILE_CONFIG || {
  endpoint: 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev'
};
```

8. Open that URL with /health appended. It should report ready:true. This checks configuration shape; the actual upload below also tests B2 credentials and CORS. Upload all updated app folders and root files to GitHub, then reload every client. Older clients could otherwise continue writing RTDB file bytes.
9. Upload a small attachment, open/download it from a second browser or phone, and upload/open an HTML Hub file. Clear an unpinned attachment message's chat, then check that the B2 object is gone, including old versions. Delete the HTML item and check that its objects disappear too. Test a larger video on your actual connection. Earlier release notes reported isolated live uploads. This release validates upload behavior with isolated tests; the deployed Worker/B2 service and affected users’ networks still need a live acceptance check.

Until endpoint setup is complete, new attachment/HTML uploads show a clear setup message and do not fall back to filling RTDB. Text chat, old attachments and the other existing features remain available. The Worker intentionally follows the existing public read/write model: CORS is not authentication, and anyone able to call its API can consume the free quota. Free-plan limits can interrupt service; check both dashboards periodically.

## Transfer speed, clearing and retention

Successful file reads allow the receiving browser to reuse the same UUID file URL for **five minutes** (`Cache-Control: private, max-age=300`). This reduces repeated Class B requests when previews reopen; shared caches cannot store these responses. Clear still permanently deletes stored B2 versions, but a browser can retain bytes it already received for that five-minute period. API responses and storage errors remain `no-store`. Fresh requests for deleted objects return 404.

Storage failures now distinguish a known account cap from rejected credentials and temporary service failures. The Worker does not report an unexplained HEAD 403 as a confirmed quota problem. Known cap and permission failures are terminal so the updated shared client avoids retrying them repeatedly. `/health` identifies this Worker with `storageRevision: "2026-10-28-free-backup"`, `browserCacheSeconds: 300`, and the backup binding state. Five-minute browser reuse reduces avoidable requests; it does not increase Backblaze's account allowances.

### Free backup for new uploads

Bind a separate **Cloudflare Workers KV** namespace to this Worker as `FILE_BACKUP`, keeping the Workers account on its Free plan. The updated shared web client first tries B2; an eligible provider failure can retry the new upload through KV. The existing EXE/APK can receive this client change through their shared web update path. Old B2 object URLs remain compatible. B2-only files are not automatically copied, so this provides a second destination for **new uploads**, not a replica of every existing file.

KV backup files are limited to **100 MiB each** and use 8 MiB parts. Signed receipts verify the parts before the manifest is committed. Pending parts expire after three days; committed parts have **no expiry**. The backup shares the Workers Free account's finite KV allowance: 1 GB total KV storage, 1,000 writes/day, 1,000 deletes/day, 1,000 list operations/day and 100,000 reads/day. A multipart upload uses several operations; these are not file counts. B2 and KV allowances do not add up to 200 GB, and both destinations or the Worker itself can still reach their free limits. See [KV limits](https://developers.cloudflare.com/kv/platform/limits/).

KV changes can take a minute or longer to reach another region. A reader whose chunks are not available yet gets a retryable error; the Worker does not return a successfully truncated file. Clearing messages deletes known KV part keys directly, also scans for leftovers, preserves pinned prefixes, and reports failure if either provider could not be cleaned. Previously downloaded bytes can remain in the recipient's browser cache for five minutes.

Configure the Worker's scheduled trigger to **`17 * * * *`** (hourly, UTC). The scheduled handler revisits deletion markers after the 48-hour upload-ticket lifetime plus a full extra day, removing late writes from interrupted uploads before discarding each marker. It handles one object or prefix page per run, stays below 50 service calls, preserves pinned/newer data, and never expires completed files. A failed cleanup keeps its marker for a later run; heavy use can create a cleanup backlog. Keep this trigger enabled while using the backup.

Files go as original binary bytes directly from the browser to B2 using signed PUTs. Files larger than 8 MiB use three concurrent multipart transfers and retry only failed parts. On direct-upload CORS failures, parts up to 16 MiB use a signed, size-bounded Worker relay. No base64 conversion or old RTDB pacing applies. B2 assembles the recorded part ETags, then a server HEAD verifies size before a usable message or HTML entry becomes available to everyone. The chat placeholder appears immediately; remote users can open the file after its bytes have reached storage. Media reads support byte ranges through the Worker, so a phone can stream video without downloading the entire file first.

33 MB in three seconds and 100 MB in eight seconds require roughly 90–105 Mbps of upstream capacity before overhead. Network conditions, device suspension and provider latency prevent a guaranteed time. Ordinary mobile File/Blob uploads and progress are supported; keep the tab open during upload. There is no unmeasured three-second or eight-second claim.

The Admin Panel limit does not override [B2's provider maximum of 10 TB per file](https://www.backblaze.com/docs/cloud-storage-large-files), account storage quotas, or network capacity. Multipart size scales for very large files; relay fallback is capped at 16 MiB per request, so files requiring larger parts need the documented direct B2 CORS rule. Cloudflare uses [FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/) to enforce exact part length with backpressure and bounded memory.

Clear operates on a snapshot of attachment message IDs, preserves pins and messages that arrive after the cutoff, and deletes every stored B2 version under each removed message with up to four parallel version deletions per page. It does not just hide objects with S3 delete markers. If deletion fails, the app reports it and keeps compact references so Clear can retry. HTML deletion removes external content before removing its database reference. Normal cancellation/failure attempts object cleanup and aborts unfinished multipart uploads. Temporary Firebase disconnects no longer cancel external uploads, and cancellation or preview errors after database commit cannot delete acknowledged files. Unfinished uploads can be cleared with a B2 lifecycle rule for **unfinished large files only**; do not expire completed/current files. A force-closed tab or network loss at exactly the storage/RTDB handoff can still leave an orphan because the services cannot share an atomic transaction; inspect and remove abandoned objects in the dedicated B2 bucket when needed. No background process silently expires saved files or paid service is required.

Existing legacy RTDB uploads are not automatically copied elsewhere, avoiding a large download/reupload and unexpected quota use. Clearing their messages still deletes the legacy payloads. Stickers, small profile/settings media, live game state and normal chat records retain their current storage behavior. The app's previous targeted listeners, sparse settings writes and paginated history remain in place.

## Desktop build and verification

Publish the shared source and native release separately as described at the top of this README and in NATIVE-UPDATES.md. The storage reference in this section was retained from the prior release; the native updater work does not change or redeploy the storage Worker, B2 or Firebase settings.

Build with `npm.cmd --prefix desktop ci` followed by `npm.cmd --prefix desktop run dist`. The existing launcher uses standard .NET ZIP and process APIs and does not launch PowerShell scripts. No antivirus exclusions, disabled protections, obfuscation, or security bypass switches are added. The build is unsigned because no signing certificate is configured; antivirus false-positive behavior cannot be guaranteed.

Run `npm.cmd ci`, `npm.cmd test` and `npm.cmd --prefix desktop test`. Tests use local Firebase and external-storage fixtures; see VALIDATION.md for actual checks. build-info.json and every ZIP entry get the current packaging timestamp. All originally supplied paths are preserved. The Worker is retained below inside this README. Protocol references: [B2 multipart creation](https://www.backblaze.com/apidocs/s3-create-multipart-upload), [uploading parts](https://www.backblaze.com/apidocs/s3-upload-part), [completion](https://www.backblaze.com/apidocs/s3-complete-multipart-upload), and [Cloudflare request limits](https://developers.cloudflare.com/workers/platform/limits/).

## Cloudflare Worker source

Copy the complete code block below into the Cloudflare Worker editor. Secrets are supplied through Worker settings, not inserted into this source.

<!-- BEGIN STORAGE WORKER -->
```javascript
// Paste this entire module into a Cloudflare Workers Free worker.
// B2_KEY_ID and B2_APP_KEY are Worker secrets, never browser configuration.
const encoder = new TextEncoder();
const DEFAULT_FILE_LIMIT_MB = 100;
const FILE_LIMIT_URL = 'https://chatappv6-e9da9-default-rtdb.firebaseio.com/admin/fileUploadLimitMB.json';
async function readFileLimit() {
  let value;
  try {
    const response = await fetch(FILE_LIMIT_URL, {cache:'no-store', headers:{'Cache-Control':'no-cache'}});
    if (!response.ok) throw new Error('Firebase settings unavailable.');
    value = await response.json();
  } catch {
    throw Object.assign(new Error('The File Upload Limit could not be loaded. Please retry.'), {status:503});
  }
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  const number = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
  const bytes = Math.floor(number * 1024 * 1024);
  const megabytes = Number.isFinite(number) && number > 0 && Number.isSafeInteger(bytes) && bytes >= 1 ? number : DEFAULT_FILE_LIMIT_MB;
  return {megabytes, bytes:Math.floor(megabytes * 1024 * 1024)};
}
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const validKey = key => typeof key === 'string' && key.length <= 400 && /^(attachments|html)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(key);
const decodeXML = value => String(value || '').replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[entity]);
const xmlValue = (xml, name) => decodeXML(xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'))?.[1]);
async function hmac(key, text) {
  const imported = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}
let keyCache;
async function signS3(env, method, key = '', query = {}, contentType = '') {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = now.slice(0, 8), scope = `${day}/${env.B2_REGION}/s3/aws4_request`;
  const endpoint = `https://s3.${env.B2_REGION}.backblazeb2.com`;
  const pathname = '/' + encode(env.B2_BUCKET) + '/' + key.split('/').map(encode).join('/');
  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const params = { ...query, 'X-Amz-Algorithm':'AWS4-HMAC-SHA256', 'X-Amz-Credential':`${env.B2_KEY_ID}/${scope}`,
    'X-Amz-Date':now, 'X-Amz-Expires':'7200', 'X-Amz-SignedHeaders':signedHeaders };
  const canonicalQuery = Object.entries(params).map(([k,v]) => [encode(k),encode(String(v))]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
  const canonicalHeaders = (contentType ? `content-type:${contentType}\n` : '') + `host:s3.${env.B2_REGION}.backblazeb2.com\n`;
  const canonical = [method, pathname, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const hash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
  if (!keyCache || keyCache.day !== day || keyCache.id !== env.B2_KEY_ID || keyCache.secret !== env.B2_APP_KEY || keyCache.region !== env.B2_REGION) {
    const dateKey = await hmac('AWS4' + env.B2_APP_KEY, day);
    const regionKey = await hmac(dateKey, env.B2_REGION);
    const serviceKey = await hmac(regionKey, 's3');
    keyCache = { day, id:env.B2_KEY_ID, secret:env.B2_APP_KEY, region:env.B2_REGION, key:await hmac(serviceKey, 'aws4_request') };
  }
  const signature = hex(await hmac(keyCache.key, `AWS4-HMAC-SHA256\n${now}\n${scope}\n${hash}`));
  return `${endpoint}${pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
async function storageFailure(response, method) {
  // Error pages are untrusted and can be large. Read only enough to classify
  // the provider failure; never return its raw body, URL or request details.
  let text = '', size = 0;
  const reader = response.body?.getReader(), decoder = new TextDecoder();
  if (reader) {
    try {
      while (size < 16384) {
        const {value, done} = await reader.read();
        if (done) break;
        const bytes = value.subarray(0, 16384 - size);
        size += bytes.length;
        text += decoder.decode(bytes, {stream:true});
      }
      text += decoder.decode();
    } catch {} finally { try { await reader.cancel(); } catch {} }
  }
  let code = xmlValue(text, 'Code'), message = xmlValue(text, 'Message');
  if (!code && text.trim().startsWith('{')) {
    try { const value = JSON.parse(text); code = String(value.code || ''); message = String(value.message || ''); } catch {}
  }
  const quota = /^(?:cap_exceeded|transaction_cap_exceeded|storage_cap_exceeded|download_cap_exceeded|usage_cap_exceeded|quota_exceeded)$/i.test(code) ||
    /\b(?:usage |transaction |storage |download )?cap (?:has been )?exceeded\b|\bexceeded (?:the |your )?(?:daily |usage |transaction |storage |download )?cap\b/i.test(message);
  const dailyQuota = /transaction_cap_exceeded|download_cap_exceeded/i.test(code) || /\b(?:daily|transaction|download)\b/i.test(message);
  let status = response.status, failureCode = 'B2_REQUEST_FAILED', retryable = status === 408 || status === 429 || status >= 500;
  let detail = `Backblaze returned ${status}. Please retry if the service is temporarily unavailable.`;
  let retryAfter;
  if (quota) {
    status = 429; failureCode = 'B2_ACCOUNT_CAP'; retryable = false;
    detail = 'Backblaze account usage cap reached. Check Caps & Alerts; extra buckets do not increase the account allowance.';
    if (dailyQuota) {
      retryAfter = Math.max(1, Math.ceil((86400000 - Date.now() % 86400000) / 1000));
      detail = 'Backblaze daily account cap reached. It resets at 00:00 UTC. Extra buckets do not increase this allowance.';
    }
  } else if (status === 401 || status === 403) {
    status = 403; failureCode = 'B2_FORBIDDEN'; retryable = false;
    detail = method === 'HEAD'
      ? 'Backblaze blocked the file check (403). Check account Caps & Alerts and application-key permissions.'
      : 'Backblaze denied this request (403). Check application-key permissions and account Caps & Alerts.';
    if (/^(?:SignatureDoesNotMatch|InvalidAccessKeyId|ExpiredToken|InvalidToken|unauthorized|bad_auth_token|expired_auth_token)$/i.test(code)) {
      failureCode = 'B2_AUTH_FAILED';
      detail = 'Backblaze rejected the storage credentials or signature. Check the Worker application key and region.';
    }
  } else if (status === 404) {
    failureCode = 'B2_NOT_FOUND'; retryable = false;
    detail = 'This file is no longer in storage.';
  } else if (status === 429) {
    failureCode = 'B2_RATE_LIMIT';
    detail = 'Backblaze is receiving requests too quickly. Please retry shortly.';
    const seconds = Number(response.headers.get('Retry-After'));
    if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400) retryAfter = seconds;
  } else if (status >= 500) {
    status = 502;
    detail = 'Backblaze is temporarily unavailable. Please retry.';
  }
  return Object.assign(new Error(detail), {status, code:failureCode, providerStatus:response.status, retryable, ...(retryAfter ? {retryAfter} : {})});
}
async function storage(env, method, key = '', query = {}, headers = {}, body) {
  const response = await fetch(await signS3(env, method, key, query, headers['Content-Type'] || ''), {method, headers, body, redirect:'manual'});
  if (!response.ok) {
    throw await storageFailure(response, method);
  }
  return response;
}
async function readJSON(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Request body required.'), {status:400});
  const chunks = []; let length = 0;
  for (;;) {
    const {value, done} = await reader.read(); if (done) break;
    length += value.length;
    if (length > 1024 * 1024) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), {status:413}); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Invalid request JSON.'), {status:400}); }
}
async function deletePage(env, body) {
  const prefix = String(body.prefix || '');
  if (!validKey(prefix) || (body.exact !== true && !prefix.endsWith('/'))) throw Object.assign(new Error('Invalid deletion prefix.'), {status:400});
  const keep = body.keepPrefixes || [];
  if (!Array.isArray(keep) || keep.length > 1000 || keep.some(value => !validKey(value) || !value.startsWith(prefix) || !value.endsWith('/'))) {
    throw Object.assign(new Error('Invalid retained-file prefixes.'), {status:400});
  }
  const query = {versions:'', prefix, 'max-keys':'16'};
  if (body.cursor && body.cursor.restart !== true) {
    if (!validKey(body.cursor.key) || !body.cursor.key.startsWith(prefix) || typeof body.cursor.version !== 'string' || body.cursor.version.length > 1024) {
      throw Object.assign(new Error('Invalid continuation.'), {status:400});
    }
    query['key-marker'] = body.cursor.key;
    query['version-id-marker'] = body.cursor.version;
  }
  const listing = await storage(env, 'GET', '', query);
  const xml = await listing.text();
  if (!xml.includes('<ListVersionsResult')) throw new Error('Invalid storage listing.');
  const versions = [...xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)].map(match => ({key:xmlValue(match[2], 'Key'),version:xmlValue(match[2], 'VersionId')}));
  let deleted = 0;
  // Explicit version IDs permanently free bytes. Plain S3 DELETE only adds a
  // delete marker, which would leave the old file consuming storage.
  const removable = versions.filter(file => {
    if (!validKey(file.key) || !file.key.startsWith(prefix) || !file.version) throw new Error('Invalid object version.');
    return !(body.exact === true && file.key !== prefix) && !keep.some(value => file.key.startsWith(value));
  });
  let next = 0, failure = null;
  await Promise.all(Array.from({length:Math.min(4, removable.length)}, async () => {
    while (!failure && next < removable.length) {
      const file = removable[next++];
      try {
        const response = await storage(env, 'DELETE', file.key, {versionId:file.version});
        await response.body?.cancel(); deleted++;
      } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  let cursor = null;
  if (xmlValue(xml, 'IsTruncated') === 'true') {
    if (deleted > 0) cursor = {restart:true}; // Never continue from a deleted version marker.
    else {
      cursor = { key:xmlValue(xml,'NextKeyMarker'), version:xmlValue(xml,'NextVersionIdMarker') };
      if (!validKey(cursor.key) || !cursor.version || (cursor.key === body.cursor?.key && cursor.version === body.cursor?.version)) throw new Error('Storage continuation did not advance.');
    }
  }
  return {deleted,cursor};
}
const PART_BYTES = 8 * 1024 * 1024;
const MAX_RELAY_BYTES = 16 * 1024 * 1024;
const MAX_B2_FILE_BYTES = 10000000000000;
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
async function issueTicket(env, value) {
  const payload = encodeURIComponent(JSON.stringify({...value, expires:Date.now() + 48 * 60 * 60 * 1000}));
  return payload + '.' + hex(await hmac(env.B2_APP_KEY, payload));
}
async function readTicket(env, token) {
  if (typeof token !== 'string' || token.length > 6000) throw Object.assign(new Error('Invalid upload ticket.'), {status:400});
  const at = token.lastIndexOf('.'), payload = token.slice(0, at), signature = token.slice(at + 1);
  const expected = hex(await hmac(env.B2_APP_KEY, payload));
  let difference = expected.length ^ signature.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (signature.charCodeAt(i) || 0);
  if (difference) throw Object.assign(new Error('Invalid upload ticket.'), {status:403});
  let ticket;
  try { ticket = JSON.parse(decodeURIComponent(payload)); } catch {}
  if (!ticket || !validKey(ticket.objectKey) || ticket.objectKey.endsWith('/') || !Number.isSafeInteger(ticket.size) || ticket.size < 0 || ticket.expires < Date.now()) {
    throw Object.assign(new Error('Upload session expired. Please select the file again.'), {status:400});
  }
  return ticket;
}
async function uploadPlan(env, ticket, token, partNumber = 0) {
  const query = ticket.uploadId ? {uploadId:ticket.uploadId, partNumber:String(partNumber)} : {};
  const size = ticket.uploadId ? Math.min(ticket.partSize, ticket.size - (partNumber - 1) * ticket.partSize) : ticket.size;
  const transferTicket = await issueTicket(env, {...ticket, partNumber, transferSize:size});
  if (ticket.storageBackend === 'kv') {
    validateBackupTicket(ticket);
    return {storageBackend:'kv',relayOnly:true,uploadURL:'',relayURL:'/transfer?ticket=' + encodeURIComponent(transferTicket)};
  }
  return {uploadURL:await signS3(env, 'PUT', ticket.objectKey, query, ticket.contentType),
    ...(size <= MAX_RELAY_BYTES ? {relayURL:'/transfer?ticket=' + encodeURIComponent(transferTicket)} : {})};
}
async function relayUpload(request, env, token) {
  const ticket = await readTicket(env, token);
  if (!Number.isSafeInteger(ticket.transferSize) || ticket.transferSize < 0 || ticket.transferSize > MAX_RELAY_BYTES) throw Object.assign(new Error('Invalid upload part size.'), {status:400});
  if (request.headers.has('Content-Length') && Number(request.headers.get('Content-Length')) !== ticket.transferSize) throw Object.assign(new Error('Upload part size does not match.'), {status:400});
  if (ticket.storageBackend === 'kv') return backupTransfer(request,env,ticket);
  const query = ticket.uploadId ? {uploadId:ticket.uploadId, partNumber:String(ticket.partNumber)} : {};
  let stored;
  if (typeof FixedLengthStream === 'function') {
    // Cloudflare streams directly to B2 with backpressure and an enforced
    // Content-Length. Concurrent phones never accumulate whole parts here.
    const stream = new FixedLengthStream(ticket.transferSize), controller = new AbortController();
    const pumping = request.body ? request.body.pipeTo(stream.writable, {signal:controller.signal}) : stream.writable.getWriter().close();
    pumping.catch(() => {});
    try {
      stored = await storage(env, 'PUT', ticket.objectKey, query, {'Content-Type':ticket.contentType}, stream.readable);
      await pumping;
    } catch (error) {
      controller.abort();
      await pumping.catch(() => {});
      throw error;
    }
  } else {
    // Portable test runtimes without FixedLengthStream use one bounded buffer.
    const bytes = new Uint8Array(ticket.transferSize), reader = request.body?.getReader();
    let length = 0;
    if (reader) for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      if (length + value.length > bytes.length) { await reader.cancel(); throw Object.assign(new Error('Upload part is too large.'), {status:413}); }
      bytes.set(value, length); length += value.length;
    }
    if (length !== ticket.transferSize) throw Object.assign(new Error('Upload part is incomplete.'), {status:409});
    stored = await storage(env, 'PUT', ticket.objectKey, query, {'Content-Type':ticket.contentType}, bytes);
  }
  await stored.body?.cancel();
  return stored.headers.get('ETag') || '';
}
async function completeMultipart(env, ticket, parts) {
  const count = Math.ceil(ticket.size / ticket.partSize);
  if (!Array.isArray(parts) || parts.length !== count || count > 10000 || parts.some((part, i) => part.partNumber !== i + 1 || !/^"?[a-fA-F0-9]{32}"?$/.test(String(part.etag || '')))) {
    throw Object.assign(new Error('The upload part receipts are incomplete. Retry the upload.'), {status:400});
  }
  const xml = '<CompleteMultipartUpload>' + parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXML(part.etag)}</ETag></Part>`).join('') + '</CompleteMultipartUpload>';
  const result = await storage(env, 'POST', ticket.objectKey, {uploadId:ticket.uploadId}, {'Content-Type':'application/xml'}, xml);
  const response = await result.text();
  // S3 can report a completion error inside a 200 response.
  if (!response.includes('<CompleteMultipartUploadResult') || response.includes('<Error>')) throw Object.assign(new Error('File storage could not finish assembling the upload. Please retry.'), {status:502});
}

// The free KV backup is independent of B2 caps, but has its own finite limits.
// Pending chunks expire; successfully committed chunks never expire.
const BACKUP_MAX_BYTES = 100 * 1024 * 1024;
const BACKUP_TICKET_MS = 48 * 60 * 60 * 1000;
const BACKUP_PENDING_TTL = 3 * 24 * 60 * 60;
const isBackupKey = key => validKey(key) && /-kv1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key);
const backupPartKey = (key, number, staged = false) => `${key}/${staged ? 'stage' : 'parts'}/${String(number).padStart(6,'0')}`;
const backupCount = size => Math.max(1, Math.ceil(size / PART_BYTES));
const backupPartBytes = (size, number) => Math.max(0, Math.min(PART_BYTES, size - (number - 1) * PART_BYTES));
const backupError = (message, code = 'BACKUP_UNAVAILABLE', status = 503, retryable = false) => Object.assign(new Error(message), {code,status,retryable});
const backupNotReady = () => Object.assign(backupError('The backup file is still reaching this region. Please retry shortly.', 'BACKUP_NOT_READY',503,true), {retryAfter:60});
function backupNamespace(env) {
  if (!env.FILE_BACKUP?.get || !env.FILE_BACKUP?.put || !env.FILE_BACKUP?.delete || !env.FILE_BACKUP?.list) {
    throw backupError('The free file backup has not been configured.');
  }
  return env.FILE_BACKUP;
}
async function backupCall(operation) {
  try { return await operation(); }
  catch (error) {
    if (error?.code?.startsWith('BACKUP_')) throw error;
    const detail = String(error?.message || '');
    if (/daily|quota|storage limit|capacity|limit exceeded/i.test(detail)) {
      throw backupError('The free backup has reached its own allowance. Existing chat text is unaffected.', 'BACKUP_LIMIT');
    }
    if (/429|rate|too many requests/i.test(detail)) {
      throw Object.assign(backupError('The free backup is busy. Please retry shortly.', 'BACKUP_BUSY',503,true), {retryAfter:2});
    }
    throw backupError('The free backup is unavailable. Please retry later.', 'BACKUP_UNAVAILABLE',503,true);
  }
}
function validateBackupTicket(ticket) {
  if (ticket.storageBackend !== 'kv' || !isBackupKey(ticket.objectKey) || ticket.objectKey.split('/').length > 4 ||
      ticket.partSize !== PART_BYTES || !Number.isSafeInteger(ticket.size) || ticket.size < 0 || ticket.size > BACKUP_MAX_BYTES ||
      !Number.isSafeInteger(ticket.createdAt) || !Number.isSafeInteger(ticket.sessionExpires) || ticket.sessionExpires < Date.now()) {
    throw backupError('Invalid or expired backup upload session.', 'BACKUP_SESSION',400);
  }
}
async function backupDeleted(env, objectKey, createdAt = 0) {
  const kv = backupNamespace(env);
  if (await backupCall(() => kv.get(`__deleted/${objectKey}`))) return true;
  const segments = objectKey.split('/');
  for (let count = 2; count < segments.length; count++) {
    const prefix = segments.slice(0,count).join('/') + '/';
    const mark = await backupCall(() => kv.get(`__prefix_deleted/${prefix}`, 'json'));
    if (mark && Number(mark.cutoff) >= createdAt && !(mark.keep || []).some(value => objectKey.startsWith(value))) return true;
  }
  return false;
}
async function assertBackupActive(env, ticket) {
  validateBackupTicket(ticket);
  if (await backupDeleted(env,ticket.objectKey,ticket.createdAt)) throw backupError('This file upload was cancelled or its message was cleared.', 'BACKUP_DELETED',409);
}
async function backupTransfer(request, env, ticket) {
  await assertBackupActive(env,ticket);
  if (!Number.isInteger(ticket.partNumber) || ticket.partNumber < 1 || ticket.partNumber > backupCount(ticket.size) ||
      ticket.transferSize !== backupPartBytes(ticket.size,ticket.partNumber)) throw backupError('Invalid backup part.', 'BACKUP_PART',400);
  // Only one bounded part is buffered for integrity hashing, never a full file.
  const bytes = new Uint8Array(ticket.transferSize), reader = request.body?.getReader();
  let offset = 0;
  if (reader) for (;;) {
    const {value,done} = await reader.read(); if (done) break;
    if (offset + value.length > bytes.length) { await reader.cancel(); throw backupError('The backup part is too large.', 'BACKUP_PART',413); }
    bytes.set(value,offset); offset += value.length;
  }
  if (offset !== bytes.length) throw backupError('The backup part is incomplete.', 'BACKUP_PART',409);
  const digest = hex(await crypto.subtle.digest('SHA-256',bytes));
  const etag = hex(await hmac(env.B2_APP_KEY, `kv-part-v1\n${ticket.objectKey}\n${ticket.partNumber}\n${bytes.length}\n${digest}`)).slice(0,32);
  const metadata = {objectKey:ticket.objectKey,bytes:bytes.length,etag,digest,createdAt:ticket.createdAt};
  const kv = backupNamespace(env), key = backupPartKey(ticket.objectKey,ticket.partNumber,true);
  await backupCall(() => kv.put(key,bytes,{metadata,expirationTtl:BACKUP_PENDING_TTL}));
  // Recheck cancellation after the write. KV is eventually consistent; the
  // deferred reaper also cleans writes that raced a clear in another region.
  if (await backupDeleted(env,ticket.objectKey,ticket.createdAt)) {
    await backupCall(() => kv.delete(key));
    throw backupError('This file upload was cancelled or its message was cleared.', 'BACKUP_DELETED',409);
  }
  return `"${etag}"`;
}
async function backupReceipt(env,ticket,metadata,number,etag) {
  if (!metadata || metadata.objectKey !== ticket.objectKey || metadata.bytes !== backupPartBytes(ticket.size,number) ||
      !/^[0-9a-f]{64}$/.test(metadata.digest || '') || metadata.etag !== etag) return false;
  const expected = hex(await hmac(env.B2_APP_KEY, `kv-part-v1\n${ticket.objectKey}\n${number}\n${metadata.bytes}\n${metadata.digest}`)).slice(0,32);
  return expected === etag;
}
async function backupComplete(env,ticket,parts) {
  await assertBackupActive(env,ticket);
  const count = backupCount(ticket.size);
  if (!Array.isArray(parts) || parts.length !== count || parts.some((part,index) => part.partNumber !== index + 1 || !/^"?[0-9a-f]{32}"?$/.test(String(part.etag || '')))) {
    throw backupError('The backup upload receipts are incomplete.', 'BACKUP_PARTS',400);
  }
  const kv = backupNamespace(env), manifestKey = ticket.objectKey + '/manifest';
  const receipts = parts.map(part => String(part.etag).replace(/"/g,''));
  const previous = await backupCall(() => kv.get(manifestKey,'json'));
  if (previous?.size === ticket.size && JSON.stringify(previous.parts?.map(part => part.etag)) === JSON.stringify(receipts)) return;
  const committed = [];
  // Sequential promotion holds at most one open KV stream. At 100 MiB this is
  // at most 13 parts; each costs a get, a put and a staging delete.
  for (let index = 0; index < count; index++) {
    const number = index + 1, stagingKey = backupPartKey(ticket.objectKey,number,true), finalKey = backupPartKey(ticket.objectKey,number);
    let part = await backupCall(() => kv.getWithMetadata(stagingKey,'stream'));
    const staged = !!part.value;
    if (!staged) part = await backupCall(() => kv.getWithMetadata(finalKey,'stream'));
    if (!part.value) throw backupNotReady();
    if (!await backupReceipt(env,ticket,part.metadata,number,receipts[index])) {
      await part.value.cancel();
      throw backupError('A backup upload receipt does not match its stored bytes.', 'BACKUP_INTEGRITY',409);
    }
    if (staged) {
      validateBackupTicket(ticket);
      // Permanent chunks deliberately have no expiration.
      try { await backupCall(() => kv.put(finalKey,part.value,{metadata:part.metadata})); }
      catch (error) { try { await part.value.cancel(); } catch {} throw error; }
      await backupCall(() => kv.delete(stagingKey));
    } else await part.value.cancel();
    committed.push({bytes:part.metadata.bytes,etag:part.metadata.etag,digest:part.metadata.digest});
  }
  validateBackupTicket(ticket);
  const manifest = {version:1,objectKey:ticket.objectKey,size:ticket.size,contentType:ticket.contentType,createdAt:ticket.createdAt,partSize:PART_BYTES,parts:committed};
  await backupCall(() => kv.put(manifestKey,JSON.stringify(manifest),{metadata:{objectKey:ticket.objectKey,size:ticket.size,createdAt:ticket.createdAt}}));
  if (await backupDeleted(env,ticket.objectKey,ticket.createdAt)) {
    await backupDeleteObject(env,ticket.objectKey,ticket.size);
    throw backupError('This file upload was cancelled or its message was cleared.', 'BACKUP_DELETED',409);
  }
}
function validBackupManifest(value,key) {
  return value && value.version === 1 && value.objectKey === key && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= BACKUP_MAX_BYTES &&
    Number.isSafeInteger(value.createdAt) && value.partSize === PART_BYTES && Array.isArray(value.parts) && value.parts.length === backupCount(value.size) &&
    value.parts.every((part,index) => part.bytes === backupPartBytes(value.size,index + 1) && /^[0-9a-f]{32}$/.test(part.etag || '') && /^[0-9a-f]{64}$/.test(part.digest || ''));
}
async function backupRead(request,env,key) {
  const kv = backupNamespace(env), manifest = await backupCall(() => kv.get(key + '/manifest','json'));
  if (!manifest) {
    if (await backupDeleted(env,key)) throw backupError('This file is no longer in storage.', 'BACKUP_NOT_FOUND',404);
    throw backupNotReady();
  }
  if (!validBackupManifest(manifest,key)) throw backupError('The backup file manifest is invalid.', 'BACKUP_INTEGRITY',502);
  if (await backupDeleted(env,key,manifest.createdAt)) throw backupError('This file is no longer in storage.', 'BACKUP_NOT_FOUND',404);
  let start = 0, end = manifest.size - 1, status = 200;
  const headers = new Headers({'Content-Type':manifest.contentType || 'application/octet-stream','Accept-Ranges':'bytes',ETag:`"kv-${key.split('/').pop()}"`});
  const range = request.headers.get('Range');
  if (range && request.method !== 'HEAD') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let valid = !!match && !!(match[1] || match[2]) && manifest.size > 0;
    if (valid && !match[1]) { const suffix = Number(match[2]); valid = Number.isSafeInteger(suffix) && suffix > 0; start = Math.max(0,manifest.size - suffix); }
    else if (valid) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]),end) : end; valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < manifest.size; }
    if (!valid) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${manifest.size}`,'Cache-Control':'no-store'}});
    status = 206; headers.set('Content-Range',`bytes ${start}-${end}/${manifest.size}`);
  }
  headers.set('Content-Length',String(Math.max(0,end - start + 1)));
  if (request.method === 'HEAD' || manifest.size === 0) return new Response(null,{status,headers});
  const first = Math.floor(start / PART_BYTES) + 1, last = Math.floor(end / PART_BYTES) + 1;
  // Check every selected part before returning a successful response. Close each
  // probe stream before opening another, then stream one part at a time below.
  for (let number = first; number <= last; number++) {
    const part = await backupCall(() => kv.getWithMetadata(backupPartKey(key,number),'stream'));
    if (!part.value) throw backupNotReady();
    await part.value.cancel();
    if (part.metadata?.etag !== manifest.parts[number - 1].etag || part.metadata?.bytes !== manifest.parts[number - 1].bytes) throw backupError('The backup file is incomplete.', 'BACKUP_INTEGRITY',502);
  }
  let number = first, reader = null, offset = 0, cancelled = false;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (cancelled) return;
          if (!reader) {
            if (number > last) { controller.close(); return; }
            const part = await backupCall(() => kv.getWithMetadata(backupPartKey(key,number),'stream'));
            if (!part.value) throw backupNotReady();
            if (cancelled) { await part.value.cancel(); return; }
            if (part.metadata?.etag !== manifest.parts[number - 1].etag || part.metadata?.bytes !== manifest.parts[number - 1].bytes) { await part.value.cancel(); throw backupError('The backup file is incomplete.', 'BACKUP_INTEGRITY',502); }
            reader = part.value.getReader(); offset = 0;
          }
          const {value,done} = await reader.read();
          if (done) {
            if (offset !== manifest.parts[number - 1].bytes) throw backupError('A backup file chunk is incomplete.', 'BACKUP_INTEGRITY',502);
            reader.releaseLock(); reader = null; number++; continue;
          }
          const absolute = (number - 1) * PART_BYTES + offset;
          offset += value.length;
          if (offset > manifest.parts[number - 1].bytes) throw backupError('A backup file chunk is invalid.', 'BACKUP_INTEGRITY',502);
          const from = Math.max(0,start - absolute), to = Math.min(value.length,end + 1 - absolute);
          if (to > from) { controller.enqueue(value.subarray(from,to)); return; }
        }
      } catch (error) {
        try { await reader?.cancel(); } catch {}
        controller.error(error);
      }
    },
    async cancel() { cancelled = true; try { await reader?.cancel(); } catch {} }
  });
  if (typeof FixedLengthStream === 'function') {
    // workerd derives Content-Length from the stream, not a manually supplied
    // header on a generic ReadableStream. It also rejects truncated output.
    const fixed = new FixedLengthStream(end - start + 1);
    stream.pipeTo(fixed.writable).catch(() => {});
    return new Response(fixed.readable,{status,headers});
  }
  return new Response(stream,{status,headers});
}
async function backupTombstone(env,key,size) {
  const kv = backupNamespace(env), name = `__deleted/${key}`;
  if (!await backupCall(() => kv.get(name))) {
    const mark = {objectKey:key,deletedAt:Date.now(),cleanupAfter:Date.now() + BACKUP_PENDING_TTL * 1000,...(Number.isSafeInteger(size) && size >= 0 && size <= BACKUP_MAX_BYTES ? {size} : {})};
    // Keep deletion markers until a later cleanup succeeds. Expiring these
    // markers alone could expose a late cross-region write after cancellation.
    await backupCall(() => kv.put(name,JSON.stringify(mark),{metadata:{cleanupAfter:mark.cleanupAfter}}));
  }
}
async function backupDeleteObject(env,key,size) {
  if (!isBackupKey(key)) throw backupError('Invalid backup deletion reference.', 'BACKUP_DELETE',400);
  await backupTombstone(env,key,size);
  const count = Number.isSafeInteger(size) && size >= 0 && size <= BACKUP_MAX_BYTES ? backupCount(size) : backupCount(BACKUP_MAX_BYTES);
  const kv = backupNamespace(env);
  // Explicit deterministic keys work even when KV listing has not caught up.
  for (let number = 1; number <= count; number++) {
    await backupCall(() => kv.delete(backupPartKey(key,number,true)));
    await backupCall(() => kv.delete(backupPartKey(key,number)));
  }
  await backupCall(() => kv.delete(key + '/manifest'));
  return count * 2 + 1;
}
function deletionInput(body) {
  const prefix = String(body.prefix || ''), keep = body.keepPrefixes || [];
  if (!validKey(prefix) || (body.exact !== true && !prefix.endsWith('/')) || !Array.isArray(keep) || keep.length > 1000 ||
      keep.some(value => !validKey(value) || !value.startsWith(prefix) || !value.endsWith('/'))) throw backupError('Invalid deletion prefix.', 'BACKUP_DELETE',400);
  if ((body.objects !== undefined && !Array.isArray(body.objects)) || (body.objectKeys !== undefined && !Array.isArray(body.objectKeys))) throw backupError('Invalid deletion objects.', 'BACKUP_DELETE',400);
  const objects = [...(body.objectKeys || []).map(objectKey => ({objectKey})),...(body.objects || [])];
  if ((body.objects || []).length > 1000 || (body.objectKeys || []).length > 1000 || objects.some(item => !item || !validKey(item.objectKey) || !item.objectKey.startsWith(prefix) ||
      (body.exact === true && item.objectKey !== prefix) || (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size < 0)))) throw backupError('Invalid deletion objects.', 'BACKUP_DELETE',400);
  const candidates = objects.filter(item => isBackupKey(item.objectKey) && !keep.some(value => item.objectKey.startsWith(value)));
  return {prefix,keep,objects:[...new Map(candidates.map(item => [item.objectKey,item])).values()]};
}
async function backupDeletePage(env,body) {
  const {prefix,keep,objects} = deletionInput(body), kv = backupNamespace(env);
  if (body.exact === true && isBackupKey(prefix)) {
    return {deleted:await backupDeleteObject(env,prefix,objects.find(item => item.objectKey === prefix)?.size),cursor:null};
  }
  const cursor = body.cursor || {}, phase = cursor.backend || 'kv-known';
  if (!['kv-known','kv-list'].includes(phase)) throw backupError('Invalid backup continuation.', 'BACKUP_DELETE',400);
  if (!body.cursor && body.exact !== true) {
    const markKey = `__prefix_deleted/${prefix}`;
    const previous = await backupCall(() => kv.get(markKey,'json'));
    if (!previous || JSON.stringify(previous.keep || []) !== JSON.stringify(keep)) {
      const mark = {prefix,cutoff:Date.now(),keep,cleanupAfter:Date.now() + BACKUP_PENDING_TTL * 1000};
      await backupCall(() => kv.put(markKey,JSON.stringify(mark),{metadata:{cleanupAfter:mark.cleanupAfter}}));
    }
  }
  if (phase === 'kv-known') {
    const index = Number(cursor.index || 0);
    if (!Number.isSafeInteger(index) || index < 0 || index > objects.length) throw backupError('Invalid backup continuation.', 'BACKUP_DELETE',400);
    if (index < objects.length) {
      const item = objects[index];
      return {deleted:await backupDeleteObject(env,item.objectKey,item.size),cursor:{backend:'kv-known',index:index + 1}};
    }
  }
  const token = phase === 'kv-list' ? cursor.token : undefined;
  if (token !== undefined && (typeof token !== 'string' || token.length > 2048)) throw backupError('Invalid backup continuation.', 'BACKUP_DELETE',400);
  const listed = await backupCall(() => kv.list({prefix,limit:16,...(token ? {cursor:token} : {})}));
  let deleted = 0;
  const marked = new Set(objects.map(item => item.objectKey));
  for (const item of listed.keys || []) {
    const key = String(item.name || ''), objectKey = key.replace(/\/(?:manifest|(?:stage|parts)\/\d{6})$/,'');
    if (!isBackupKey(objectKey) || !objectKey.startsWith(prefix) || (body.exact === true && objectKey !== prefix) || keep.some(value => objectKey.startsWith(value))) continue;
    if (!marked.has(objectKey)) { await backupTombstone(env,objectKey); marked.add(objectKey); }
    await backupCall(() => kv.delete(key)); deleted++;
  }
  if (!listed.list_complete) {
    if (!listed.cursor || listed.cursor === token) throw backupError('The backup cleanup continuation did not advance.', 'BACKUP_DELETE',502,true);
    return {deleted,cursor:{backend:'kv-list',token:listed.cursor}};
  }
  return {deleted,cursor:body.backupOnly === true ? null : {backend:'b2'}};
}
async function deleteStoredPage(env,body) {
  deletionInput(body);
  if (body.exact === true && isBackupKey(body.prefix)) return backupDeletePage(env,body);
  if (body.cursor?.backend === 'b2') {
    const result = await deletePage(env,{...body,cursor:body.cursor.next || null});
    return {...result,cursor:result.cursor ? {backend:'b2',next:result.cursor} : null};
  }
  // Old B2 continuation objects retain their original meaning.
  if (body.cursor && !body.cursor.backend) return deletePage(env,body);
  if (!env.FILE_BACKUP) return deletePage(env,body);
  try { return await backupDeletePage(env,body); }
  catch (error) {
    // A backup limit must not prevent an independent attempt to clean B2.
    if (body.backupOnly !== true) { try { await deletePage(env,{...body,cursor:null}); } catch {} }
    throw error;
  }
}

async function reapBackupDeletes(env) {
  if (!env.FILE_BACKUP) return;
  const kv = backupNamespace(env), stateKey = '__gc_state';
  const state = await backupCall(() => kv.get(stateKey,'json')) || {};
  const kind = state.kind === 'prefix' ? 'prefix' : 'exact';
  const cursorField = kind + 'Cursor', markerPrefix = kind === 'exact' ? '__deleted/' : '__prefix_deleted/';
  const page = await backupCall(() => kv.list({prefix:markerPrefix,limit:16,...(typeof state[cursorField] === 'string' && state[cursorField] ? {cursor:state[cursorField]} : {})}));
  const due = (page.keys || []).find(item => Number(item.metadata?.cleanupAfter) > 0 && Number(item.metadata.cleanupAfter) <= Date.now());
  if (due) {
    const mark = await backupCall(() => kv.get(due.name,'json'));
    if (mark && Number(mark.cleanupAfter) <= Date.now()) {
      if (kind === 'exact' && isBackupKey(mark.objectKey)) {
        const count = Number.isSafeInteger(mark.size) && mark.size >= 0 && mark.size <= BACKUP_MAX_BYTES ? backupCount(mark.size) : backupCount(BACKUP_MAX_BYTES);
        // Tickets are expired and the extra propagation day has passed. This
        // deterministic pass removes any late write before removing its marker.
        for (let number = 1; number <= count; number++) {
          await backupCall(() => kv.delete(backupPartKey(mark.objectKey,number,true)));
          await backupCall(() => kv.delete(backupPartKey(mark.objectKey,number)));
        }
        await backupCall(() => kv.delete(mark.objectKey + '/manifest'));
        await backupCall(() => kv.delete(due.name));
      } else if (kind === 'prefix' && validKey(mark.prefix) && mark.prefix.endsWith('/') && Array.isArray(mark.keep)) {
        const listed = await backupCall(() => kv.list({prefix:mark.prefix,limit:16,...(mark.cursor ? {cursor:mark.cursor} : {})}));
        for (const item of listed.keys || []) {
          const objectKey = String(item.name || '').replace(/\/(?:manifest|(?:stage|parts)\/\d{6})$/,'');
          if (isBackupKey(objectKey) && objectKey.startsWith(mark.prefix) && Number(item.metadata?.createdAt) <= Number(mark.cutoff) &&
              !mark.keep.some(prefix => objectKey.startsWith(prefix))) await backupCall(() => kv.delete(item.name));
        }
        if (listed.list_complete) await backupCall(() => kv.delete(due.name));
        else {
          if (!listed.cursor || listed.cursor === mark.cursor) throw backupError('Backup cleanup could not advance.', 'BACKUP_CLEANUP',503,true);
          await backupCall(() => kv.put(due.name,JSON.stringify({...mark,cursor:listed.cursor}),{metadata:{cleanupAfter:mark.cleanupAfter}}));
        }
      }
    }
  } else state[cursorField] = page.list_complete ? '' : page.cursor;
  // One bounded object or prefix page per invocation, alternating queues. An
  // hourly trigger therefore cannot consume the whole free delete allowance.
  state.kind = kind === 'exact' ? 'prefix' : 'exact';
  await backupCall(() => kv.put(stateKey,JSON.stringify(state)));
}

export default {
  async scheduled(event,env,context) {
    context.waitUntil(reapBackupDeletes(env));
  },
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type, Range', 'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges, ETag',
      'Access-Control-Max-Age':'86400', 'Cache-Control':'no-store' };
    const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status,headers:{...cors,'Content-Type':'application/json',...headers}});
    try {
      if (!env.B2_KEY_ID || !env.B2_APP_KEY || !/^[a-z0-9-]+$/.test(env.B2_REGION || '') || !/^[A-Za-z0-9-]{6,63}$/.test(env.B2_BUCKET || '')) {
        return json({error:'Worker storage configuration is incomplete.'}, 503);
      }
      const url = new URL(request.url);
      // CORS is a browser restriction, not authentication. This intentionally
      // follows the app's public read/write model; keep B2 spending caps at $0.
      if (request.method === 'POST' || request.method === 'OPTIONS') {
        const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!origins.includes(request.headers.get('Origin') || '')) return json({error:`This app origin is not enabled for uploads: ${request.headers.get('Origin') || '(missing)'}. Add it to Worker ALLOWED_ORIGINS and redeploy.`}, 403);
      }
      if (request.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
      if (request.method === 'GET' && url.pathname === '/health') return json({ready:true,provider:'b2-worker-v1',uploadProtocol:2,multipart:true,storageRevision:'2026-10-28-free-backup',browserCacheSeconds:300,backup:{configured:!!env.FILE_BACKUP,provider:'cloudflare-kv',maxFileBytes:BACKUP_MAX_BYTES},maxFileBytes:(await readFileLimit()).bytes});
      if (request.method === 'POST' && url.pathname === '/transfer') {
        const etag = await relayUpload(request, env, url.searchParams.get('ticket'));
        return new Response(null, {status:200,headers:{...cors,ETag:etag}});
      }
      if (request.method === 'POST') {
        const body = await readJSON(request);
        if (url.pathname === '/sign') {
          const limit = await readFileLimit();
          if (!validKey(body.path) || body.path.length > 360 || body.path.endsWith('/') || !Number.isSafeInteger(body.size) || body.size < 0 || body.size > limit.bytes) return json({error:`Invalid file or size. Maximum ${limit.megabytes} MB.`}, 400);
          if (body.size > MAX_B2_FILE_BYTES) return json({error:'This file exceeds the B2 provider maximum of 10 TB.'}, 400);
          const objectKey = `${body.path}-${crypto.randomUUID()}`;
          const contentType = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(body.mimeType || '') ? body.mimeType : 'application/octet-stream';
          if (body.fallback === true) {
            backupNamespace(env);
            if (body.size > BACKUP_MAX_BYTES || body.path.split('/').length > 4 || body.path.length > 350) return json({error:'The free backup supports files up to 100 MiB.',code:'BACKUP_SIZE',retryable:false},400);
            const session = {objectKey:`${body.path}-kv1-${crypto.randomUUID()}`,storageBackend:'kv',contentType,size:body.size,uploadId:'kv1',partSize:PART_BYTES,createdAt:Date.now(),sessionExpires:Date.now() + BACKUP_TICKET_MS};
            await assertBackupActive(env,session);
            const ticket = await issueTicket(env,session);
            return json({objectKey:session.objectKey,storageBackend:'kv',relayOnly:true,contentType,ticket,uploadId:session.uploadId,partSize:session.partSize});
          }
          let uploadId = '', partSize = 0;
          if (body.multipart === true && body.size > PART_BYTES) {
            partSize = Math.max(PART_BYTES, Math.ceil(body.size / 10000 / 1048576) * 1048576);
            if (partSize > 5 * 1024 ** 3) return json({error:'This file exceeds the storage provider multipart capacity.'}, 400);
            const created = await storage(env, 'POST', objectKey, {uploads:''}, {'Content-Type':contentType});
            uploadId = xmlValue(await created.text(), 'UploadId');
            if (!uploadId) throw new Error('File storage could not start the upload.');
          }
          const session = {objectKey, contentType, size:body.size, uploadId, partSize};
          const ticket = await issueTicket(env, session);
          return json({objectKey,contentType,ticket,...(uploadId ? {uploadId,partSize} : await uploadPlan(env,session,ticket))});
        }
        if (url.pathname === '/part-sign') {
          const ticket = await readTicket(env, body.ticket);
          if (!ticket.uploadId || !Number.isInteger(body.partNumber) || body.partNumber < 1 || body.partNumber > (ticket.storageBackend === 'kv' ? backupCount(ticket.size) : Math.ceil(ticket.size / ticket.partSize))) return json({error:'Invalid upload part.'}, 400);
          return json(await uploadPlan(env, ticket, body.ticket, body.partNumber));
        }
        if (url.pathname === '/abort') {
          const ticket = await readTicket(env, body.ticket);
          if (ticket.storageBackend === 'kv') {
            validateBackupTicket(ticket);
            await backupDeleteObject(env,ticket.objectKey,ticket.size);
            return json({aborted:true});
          }
          if (!ticket.uploadId) return json({aborted:true});
          try {
            const response = await storage(env, 'DELETE', ticket.objectKey, {uploadId:ticket.uploadId});
            await response.body?.cancel();
          } catch (error) { if (error.status !== 404) throw error; }
          return json({aborted:true});
        }
        if (url.pathname === '/complete') {
          const limit = await readFileLimit();
          if (!validKey(body.objectKey) || !Number.isSafeInteger(body.size) || body.size < 0 || body.size > limit.bytes) return json({error:`Invalid file reference. Maximum ${limit.megabytes} MB.`}, 400);
          const ticket = body.ticket ? await readTicket(env, body.ticket) : null;
          if (ticket && (ticket.objectKey !== body.objectKey || ticket.size !== body.size)) return json({error:'Upload ticket does not match this file.'}, 400);
          if (ticket?.storageBackend === 'kv') {
            await backupComplete(env,ticket,body.parts);
            return json({complete:true,storageBackend:'kv'});
          }
          if (isBackupKey(body.objectKey)) return json({error:'A signed backup upload ticket is required.',code:'BACKUP_SESSION',retryable:false},403);
          let stored;
          try { stored = await storage(env, 'HEAD', body.objectKey); }
          catch (error) {
            if (error.status !== 404 || !ticket?.uploadId) throw error;
            await completeMultipart(env, ticket, body.parts);
            stored = await storage(env, 'HEAD', body.objectKey);
          }
          if (!stored.headers.has('Content-Length') || Number(stored.headers.get('Content-Length')) !== body.size) return json({error:'The uploaded file size does not match. Retry the upload.'}, 409);
          return json({complete:true});
        }
        if (url.pathname === '/delete') return json(await deleteStoredPage(env, body));
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/objects/')) {
        const key = decodeURIComponent(url.pathname.slice('/objects/'.length));
        if (!validKey(key) || key.endsWith('/')) return json({error:'Invalid file reference.'}, 400);
        const headers = {};
        if (request.headers.has('Range')) headers.Range = request.headers.get('Range');
        const stored = isBackupKey(key) ? await backupRead(request,env,key) : await storage(env, request.method, key, {}, headers);
        const output = new Headers(cors);
        // UUID file URLs never change content. Only the receiving browser may
        // reuse bytes for five minutes; shared caches must not store them.
        // Clear still deletes B2 versions immediately, subject to its result.
        output.set('Cache-Control',stored.ok ? 'private, max-age=300' : 'no-store');
        for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']) {
          if (stored.headers.has(name)) output.set(name,stored.headers.get(name));
        }
        output.set('X-Content-Type-Options','nosniff');
        output.set('Content-Security-Policy',"sandbox; default-src 'none'");
        // HTML runs only in the app's existing sandbox, never as Worker code.
        if (/html|svg|javascript|xml/i.test(output.get('Content-Type') || '')) output.set('Content-Disposition','attachment');
        return new Response(stored.body, {status:stored.status,headers:output});
      }
      return json({error:'Not found.'}, 404);
    } catch (error) {
      return json({error:error?.message || 'File storage is unavailable.',
        ...(error?.code ? {code:error.code} : {}),
        ...(Number.isInteger(error?.providerStatus) ? {providerStatus:error.providerStatus} : {}),
        ...(typeof error?.retryable === 'boolean' ? {retryable:error.retryable} : {}),
        ...(error?.retryAfter ? {retryAfter:error.retryAfter} : {})}, error?.status || 500,
        error?.retryAfter ? {'Retry-After':String(error.retryAfter)} : {});
    }
  }
};

```
<!-- END STORAGE WORKER -->
