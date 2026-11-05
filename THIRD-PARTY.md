# Third-party software and assets

The supplied application retains its existing Firebase project configuration and its original game code/artwork. Their inclusion does not change the ownership or licenses of those materials.

`activities/merge-party/assets/menu-reference.png` is the user-supplied `Activity start screen.png` from `Merge Party Physics and Design Visual Examples.zip`. The menu displays its machine illustration through a CSS crop; scores and the Play button are live interface controls. The supplied image is preserved unchanged.

`vendor/firebase-app-compat.js` and `vendor/firebase-database-compat.js` are the unchanged Firebase JavaScript SDK 10.12.5 files distributed by Google at:

- https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js
- https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js

Firebase JavaScript SDK: https://github.com/firebase/firebase-js-sdk (Apache License 2.0). License notices in the distributed scripts are preserved.

The existing app may load optional third-party resources for features such as emoji, time synchronization and uploaded HTML. Those features retain their existing service dependencies. This ZIP does not bundle an external TURN or SFU service.

Game recognition uses a sanitized public executable-signature snapshot retrieved on October 8, 2026 from Discord's public detectable-applications endpoint: https://discord.com/api/v9/applications/detectable . The snapshot in `desktop/games.cjs` contains 11,135 Windows executable signatures, independent of this computer's installed games. The desktop can refresh this catalog anonymously; no process list, local paths, or Chat App account data is sent to Discord. The endpoint is an external service and may change or become unavailable; the bundled snapshot and local Steam/Epic manifests remain available.

The Roblox logo, Minecraft grass-block icon, and Fortnite artwork are the corresponding game-identification images distributed through Discord's application-icon CDN. The 64-pixel PNGs are embedded in the existing native/web game-presence modules to avoid broken executable-icon substitutes and image-network failures. Original sources:

- Roblox: https://cdn.discordapp.com/app-icons/363445589247131668/f2b60e350a2097289b3b0b877495e55f.png?size=64
- Minecraft: https://cdn.discordapp.com/app-icons/1402418491272986635/166fbad351ecdd02d11a3b464748f66b.png?size=64
- Fortnite: https://cdn.discordapp.com/app-icons/1402418703554842694/c1864b38910c209afd5bf6423b672022.png?size=64

Game names, logos, and artwork remain the property of their respective owners; their inclusion identifies the running game and does not imply affiliation or transfer ownership. Other catalog icons are loaded from the same CDN. Roblox experience titles, creator names, and thumbnails are resolved through Roblox's public `apis.roblox.com`, `games.roblox.com`, and `thumbnails.roblox.com` endpoints, with completed thumbnails restricted to `rbxcdn.com`.

Additional game-identification PNGs were verified against Discord's public detectable-applications catalog and embedded at 64 pixels on October 25, 2026. Each title retains its own original artwork, including the distinct Dungeons II icon:

- Minecraft Dungeons: https://cdn.discordapp.com/app-icons/1124352351269048370/ad4a3e3a4e267728b7476a80261399f1.png?size=64
- Minecraft Dungeons II: https://cdn.discordapp.com/app-icons/1554947773751627928/02ed9486e57a3ba7a7fd4933258ee357.png?size=64
- Minecraft Legends: https://cdn.discordapp.com/app-icons/1124356402102685828/b598b3eac8bf5827e188ee366212460f.png?size=64
- Minecraft: Story Mode: https://cdn.discordapp.com/app-icons/1164995818055549058/5a3ed04db6cf896e64e2d9e0a75865d1.png?size=64
- Minecraft: Story Mode - Season Two: https://cdn.discordapp.com/app-icons/1124357696926273586/c62c4bd8435db717518b60c74d7fbc33.png?size=64
- Palworld: https://cdn.discordapp.com/app-icons/1197827812623650866/f2039761488809de552d44ebc6739ffe.png?size=64

Minecraft Dungeons II's identity was verified with the [official launch announcement](https://www.minecraft.net/en-us/article/minecraft-dungeons-ii-is-live) and [Steam listing](https://store.steampowered.com/app/1912410/Minecraft_Dungeons_II/). Its live Discord record has no executable signatures; detection uses the installed Steam identity or an exact named Dungeons II installation folder with a Dungeons game binary. It does not assume that every Dungeons executable is the sequel.

The desktop includes Electron 44.4.2 and its accompanying license files. The build uses electron-builder 26.15.3 and its 7-Zip toolset. The x64 portable bootstrap is transparent source in `desktop/scripts/benchmark-games.cjs`; it uses standard .NET ZIP/file/process APIs, not a shell or a downloaded runtime script. Shipping JavaScript stays inside the hardened Electron ASAR package, while the shared web bundle retains its existing GitHub update mechanism.

PDF/TXT media viewing: PDF.js (Mozilla, Apache License 2.0), pdfjs-dist 6.4.299, is loaded only when opening a PDF from https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/ . Its worker, CMaps, standard fonts, and WASM support use the same pinned distribution. Project and license: https://github.com/mozilla/pdf.js . No extra source files are added to this archive.

DOCX preview loads **docx-preview 0.4.1** on demand from [the pinned jsDelivr ES module](https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/+esm). Source: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs). License: [Apache License 2.0](https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/LICENSE). This ES module resolves its ZIP reader to **JSZip 3.10.2** at `https://cdn.jsdelivr.net/npm/jszip@3.10.2/+esm`.

PPTX preview loads **@aiden0z/pptx-renderer 1.3.0** on demand from [the pinned standalone browser module](https://cdn.jsdelivr.net/npm/@aiden0z/pptx-renderer@1.3.0/dist/aiden0z-pptx-renderer.browser.es.js). Source: [aiden0z/pptx-renderer](https://github.com/aiden0z/pptx-renderer). License: [Apache License 2.0](https://cdn.jsdelivr.net/npm/@aiden0z/pptx-renderer@1.3.0/LICENSE). The upstream bundle includes **JSZip 3.10.1**, Apache ECharts, and **mtx-decompressor 1.4.2**. Upstream license comments remain in the remote bundle. See its [third-party notices](https://cdn.jsdelivr.net/npm/@aiden0z/pptx-renderer@1.3.0/THIRD_PARTY_NOTICES.md), including the MPL-2.0 font decompressor and ECMA DrawingML geometry notices.

JSZip source: [Stuk/jszip](https://github.com/Stuk/jszip). JSZip is available under MIT or GPLv3; this application uses the **MIT option**. Versioned license copies: [3.10.1](https://cdn.jsdelivr.net/npm/jszip@3.10.1/LICENSE.markdown), [3.10.2](https://cdn.jsdelivr.net/npm/jszip@3.10.2/LICENSE.markdown). Its upstream bundle also retains the MIT notice for pako. Apache ECharts source and license: [apache/echarts](https://github.com/apache/echarts), [Apache License 2.0](https://github.com/apache/echarts/blob/master/LICENSE). The unmodified MPL-covered font decompressor's corresponding source is [mtx-decompressor v1.4.2](https://github.com/ChristopherVR/mtx-decompressor/tree/v1.4.2); its license copy is [MPL-2.0](https://cdn.jsdelivr.net/npm/@aiden0z/pptx-renderer@1.3.0/licenses/mtx-decompressor-MPL-2.0.txt).

These document libraries are fetched only when their preview is opened; this archive does not add copies of their library files. Document contents are parsed in the browser and are not uploaded to an Office or Google conversion service. Initial library loading requires internet access. Rendering depends on browser fonts and supported Office features; original downloads remain available.

## RNNoise microphone suppression — added October 31, 2026

The user-approved free suppression option is **RNNoise**, not Krisp. `call-modules/microphone.js` embeds the official `@jitsi/rnnoise-wasm` **0.2.1** synchronous distribution (`dist/rnnoise-sync.js`, RNNoise **0.2**) and its WebAssembly neural model, plus this app's buffering/AudioWorklet adapter. Processing stays on the device before normal call transmission. No CDN request, license key, paid service or extra source file is required.

Upstream runtime/model bytes are retained; the ES module export is omitted when constructing the embedded worklet module. The adapter handles 48 kHz mono audio in 480-sample frames and releases the native model state on teardown. Upstream runtime SHA-256: `05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f`. The npm package archive was verified against its registry SHA-512 integrity.

Sources: https://github.com/jitsi/rnnoise-wasm and https://github.com/xiph/rnnoise/tree/372f7b4 . Package: https://www.npmjs.com/package/@jitsi/rnnoise-wasm/v/0.2.1 . The Jitsi package license (including its retained historical MIT notice) and the corresponding Xiph RNNoise copyright/license are reproduced below.

### @jitsi/rnnoise-wasm package LICENSE

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/


   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.



Note:

This project was originally contributed to the community under the MIT license and with the following notice:

The MIT License (MIT)

Copyright (c) 2013 ESTOS GmbH
Copyright (c) 2013 BlueJimp SARL

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### RNNoise COPYING

```text
Copyright (c) 2007-2017, 2024 Jean-Marc Valin
Copyright (c) 2023 Amazon
Copyright (c) 2017, Mozilla
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.Org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
