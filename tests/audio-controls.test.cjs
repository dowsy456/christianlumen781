'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  class Track {
    constructor(id = 'microphone') { this.kind = 'audio'; this.id = id; this.readyState = 'live'; this.enabled = true; }
    getSettings() { return { deviceId: this.id, noiseSuppression: this.constraints?.noiseSuppression === true }; }
    async applyConstraints(value) { this.constraints = value; }
    stop() { this.readyState = 'ended'; }
  }
  class Stream {
    constructor(tracks = []) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
  }
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.connections = []; } });
  class AudioContext {
    constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = node(); }
    createGain() { return { ...node(), gain: param() }; }
    createMediaStreamSource(stream) { return { ...node(), stream }; }
    createMediaStreamDestination() { return { ...node(), stream: new Stream([new Track('processed')]) }; }
    createScriptProcessor() { return { ...node(), onaudioprocess: null }; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createWaveShaper() { return node(); }
    createOscillator() { return { ...node(), start() {}, stop() {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async setSinkId(id) { this.sinkId = id; }
  }
  const element = () => ({ dataset: {}, style: {}, volume: 1, muted: false, setAttribute() {}, appendChild() {}, remove() {}, pause() {}, async play() {}, async setSinkId(id) { this.sinkId = id; } });
  const App = {
    register(_name, initialize) { initialize(); }, currentUser: { code: 'self' }, currentCallRoomId: 'room', callSessionId: 'session', callLifecycleToken: 1,
    callUserVolumes: new Map(), callUserMuted: new Set(), callScreenVolumes: new Map(), callScreenMuted: new Set(), callWatchedShareCodes: new Set(['peer']),
    callRemoteAudioEls: new Map(), callRemoteWebAudioSources: new Map(), callRemoteNativeVolumeFades: new Map(), callRemoteScreenAudioStreams: new Map(),
    callAudioPreferenceCache: new Map(), callAudioPreferenceWrites: Promise.resolve(), callPeerMap: new Map(), callMembersCache: [],
    callPreferredAudioOutputId: '', callAudioPlaybackToken: 0, callAudioResumeGeneration: 0, callMenuOpen: true,
    CALL_AUDIO_CONSTRAINTS: { audio: { echoCancellation: true } }, $: () => null, showToast() {}, callSyncMenuStatusDisplay() {}, callPatchSpeakingIndicators() {},
    callGetMemberByCode: code => ({ code, sharing: true }), callPeerIsCurrent: () => true, callRequestPeerMediaRefresh() {},
    db: { ref: () => ({ update: async () => {}, once: async () => ({ val: () => null }) }) }, firebase: { database: { ServerValue: { TIMESTAMP: 1 } } }
  };
  const context = vm.createContext({ ChatApp: App, AudioContext, MediaStream: Stream, Float32Array, navigator: { mediaDevices: { getSupportedConstraints: () => ({ noiseSuppression: true }) } },
    document: { createElement: element, body: { appendChild() {} } }, console, Map, Set, Promise, Math, Date,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  context.window = context;
  for (const file of ['playback', 'microphone']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../call-modules', file + '.js'), 'utf8'), context);
  App.callStartSpeakingMonitor = App.callStopSpeakingMonitor = () => {};
  App.callResumeRemoteAudio = async () => true;
  return { App, context, Track, Stream, AudioContext, element };
}

test('input gain is applied to the published stream, zero is silent and physical tracks are cleaned up', () => {
  const { App, Stream, Track } = harness();
  const raw = new Track('selected-mic');
  App.callSetInputVolumePercent(40);
  App.callAttachLocalStream(new Stream([raw]));
  assert.notEqual(App.callLocalStream, App.callRawMicrophoneStream);
  assert.equal(App.callMicSource.stream, App.callRawMicrophoneStream);
  assert.equal(App.callMicGain.gain.value, 0.4);
  assert.equal(App.callMicGain.connections[0], App.callMicDestination);
  assert.equal(App.callMicSource.connections[0], App.callMicGate);
  assert.equal(App.callMicGate.connections[0], App.callMicGain);
  const outbound = App.callGetLiveAudioTrack();
  App.callSetInputVolumePercent(0);
  assert.equal(App.callMuted, true);
  assert.equal(outbound.enabled, false);
  assert.equal(raw.enabled, false);
  assert.equal(App.callMicGain.gain.value, 0);
  App.callSetInputVolumePercent(70);
  assert.equal(App.callMuted, false);
  assert.equal(outbound.enabled, true);
  assert.equal(raw.enabled, true);
  App.callSetInputVolumePercent(400);
  assert.equal(App.callGetInputVolumePercent(), 100);
  App.callDisposeMicrophoneGraph({ closeContext: true });
  assert.equal(raw.readyState, 'ended');
  assert.equal(outbound.readyState, 'ended');
  assert.equal(App.callMicCtx, null);
});

test('manual sensitivity gates actual outgoing samples and preserves above-threshold voice', () => {
  const { App, Stream, Track } = harness();
  App.callAttachLocalStream(new Stream([new Track()]));
  const process = amplitude => {
    const input = new Float32Array(1024).fill(amplitude), output = new Float32Array(1024);
    App.callMicGate.onaudioprocess({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => output } });
    return Math.max(...output);
  };
  App.callSetInputSensitivityDb(-30);
  for (let i = 0; i < 30; i++) assert.equal(process(0.001), 0, 'quiet signal is removed');
  for (let i = 0; i < 10; i++) process(0.1);
  assert.ok(process(0.1) > 0.099, 'voice passes without reducing its level');
  for (let i = 0; i < 45; i++) process(0.001);
  assert.equal(process(0.001), 0, 'release completes and background is silent');
  App.callSetInputSensitivityDb(-100);
  for (let i = 0; i < 10; i++) process(0.001);
  assert.ok(process(0.001) > 0.00099, 'lowering the threshold restores the same quiet source');
});

test('microphone settings default to None and -70 dB and persist by account across calls', async () => {
  const { App, context, Stream, Track } = harness();
  const records = {};
  App.db = { ref: path => ({ update: async value => { records[path] = { ...records[path], ...value }; }, once: async () => ({ val: () => records[path] || null }) }) };
  await App.callLoadMicrophonePreferences();
  assert.equal(App.callGetInputSensitivityDb(), -70);
  assert.equal(App.callGetNoiseSuppression(), 'none');
  const raw = new Track();
  App.callAttachLocalStream(new Stream([raw]));
  App.callSetInputSensitivityDb(-42);
  assert.equal(await App.callSetNoiseSuppression('standard'), true);
  assert.equal(raw.constraints.noiseSuppression, true);
  assert.equal(raw.constraints.autoGainControl, false);
  await App.callFlushMicrophonePreferences();
  assert.equal(records['users/self/prefs/microphone'].inputSensitivityDb, -42);
  assert.equal(records['users/self/prefs/microphone'].noiseSuppression, 'standard');
  App.currentUser = { code: 'other' };
  await App.callLoadMicrophonePreferences();
  assert.equal(App.callGetInputSensitivityDb(), -70);
  assert.equal(App.callGetNoiseSuppression(), 'none');
  App.currentUser = { code: 'self' };
  await App.callLoadMicrophonePreferences();
  assert.equal(App.callGetInputSensitivityDb(), -42);
  assert.equal(App.callGetNoiseSuppression(), 'standard');
  assert.equal(await App.callSetNoiseSuppression('none'), true);
  assert.equal(raw.constraints.noiseSuppression, false);
  assert.equal(await App.callSetNoiseSuppression('krisp'), false, 'missing proprietary engine cannot be claimed as active');
  context.navigator.mediaDevices.getSupportedConstraints = () => ({ noiseSuppression: false });
  assert.equal(await App.callSetNoiseSuppression('standard'), false, 'unsupported processing is not claimed as active');
  context.navigator.mediaDevices.getSupportedConstraints = () => ({});
  assert.equal(await App.callSetNoiseSuppression('standard'), false, 'an omitted capability is unsupported');
  context.navigator.mediaDevices.getSupportedConstraints = undefined;
  assert.equal(App.callSupportsStandardSuppression(), false, 'no constraint API is unsupported');
});

test('a microphone that ignores Standard cannot be displayed as using it', async () => {
  const { App, context, Stream, Track } = harness();
  App.db = { ref: () => ({ once: async () => ({ val: () => ({ noiseSuppression: 'standard', inputSensitivityDb: -52 }) }) }) };
  const track = new Track();
  track.getSettings = () => ({ deviceId: 'unsupported' });
  context.navigator.mediaDevices.getUserMedia = async () => new Stream([track]);
  const stream = await App.callRequestMicPermission();
  assert.equal(stream.getAudioTracks()[0], track);
  assert.equal(App.callGetNoiseSuppression(), 'none');
  assert.equal(App.callGetInputSensitivityDb(), -52);
  assert.equal(track.constraints.noiseSuppression, false);
});

test('an offline preference request cannot indefinitely block microphone capture', async () => {
  const { App, context, Stream, Track } = harness();
  let finishTimeout;
  context.setTimeout = (callback, ms) => { if (ms === 2500) finishTimeout = callback; return 1; };
  context.console = { ...console, warn() {} };
  App.db = { ref: () => ({ once: () => new Promise(() => {}) }) };
  App.callMicrophonePreferenceCache.set('self', { inputSensitivityDb: -48, noiseSuppression: 'none' });
  context.navigator.mediaDevices.getUserMedia = async () => new Stream([new Track()]);
  const capture = App.callRequestMicPermission();
  finishTimeout();
  const stream = await capture;
  assert.equal(stream.getAudioTracks()[0].readyState, 'live');
  assert.equal(App.callGetInputSensitivityDb(), -48);
});

test('fixed native processing is changed by reacquiring the same mic without losing mute or gain', async () => {
  const { App, context, Stream, Track } = harness();
  const captures = [];
  const fixedTrack = enabled => {
    const track = new Track('physical-usb');
    track.getSettings = () => ({ deviceId: 'physical-usb', noiseSuppression: enabled });
    return track;
  };
  const original = fixedTrack(false);
  App.callAttachLocalStream(new Stream([original]));
  App.callMuted = true; App.callInputVolume = 65; App.callPreferredAudioInputId = '';
  context.navigator.mediaDevices.getUserMedia = async constraints => { captures.push(constraints); return new Stream([fixedTrack(constraints.audio.noiseSuppression === true)]); };
  const published = [];
  App.callPeerMap.set('peer', {}); App.callSetPeerAudioTrack = async (_pc, track) => published.push(track);
  assert.equal(await App.callSetNoiseSuppression('standard'), true);
  assert.equal(original.readyState, 'ended');
  assert.equal(captures.at(-1).audio.deviceId.exact, 'physical-usb');
  assert.equal(App.callRawMicrophoneStream.getAudioTracks()[0].getSettings().noiseSuppression, true);
  assert.equal(App.callGetNoiseSuppression(), 'standard');
  assert.equal(App.callPreferredAudioInputId, '');
  assert.equal(App.callMuted, true); assert.equal(App.callGetInputVolumePercent(), 65);
  assert.equal(published.at(-1), App.callGetLiveAudioTrack()); assert.equal(published.at(-1).enabled, false);
  assert.equal(await App.callSetNoiseSuppression('none'), true);
  assert.equal(App.callRawMicrophoneStream.getAudioTracks()[0].getSettings().noiseSuppression, false);
});

test('RNNoise sits before the manual gate and is disposed when changing back to None', async () => {
  const { App, context, Stream, Track } = harness();
  context.AudioWorkletNode = function () {};
  const nodes = [];
  App.callCreateRNNoiseNode = async ctx => {
    assert.equal(ctx.sampleRate, 48000);
    const node = { connections: [], port: { addEventListener() {} }, addEventListener() {}, connect(other) { this.connections.push(other); }, destroy() { this.destroyed = true; } };
    nodes.push(node); return node;
  };
  App.callAttachLocalStream(new Stream([new Track('mic')]));
  context.navigator.mediaDevices.getUserMedia = async () => new Stream([new Track('mic')]);
  assert.equal(await App.callSetNoiseSuppression('rnnoise'), true);
  assert.equal(App.callMicSource.connections[0], nodes[0]);
  assert.equal(nodes[0].connections[0], App.callMicGate);
  assert.equal(App.callMicGate.connections[0], App.callMicGain);
  assert.equal(App.callGetNoiseSuppression(), 'rnnoise');
  assert.equal(await App.callSetNoiseSuppression('none'), true);
  assert.equal(nodes[0].destroyed, true); assert.equal(App.callMicNoiseNode, null);
});

test('password rejoin preserves mute and deafen before publishing tracks or restoring saved volume', () => {
  for (const state of [{muted:true,deafened:false},{muted:false,deafened:true},{muted:true,deafened:true},{muted:false,deafened:false}]) {
    const {App,Stream,Track}=harness();
    App.callInputVolume=100;
    const raw=new Track('rejoin');
    let firstPublished;
    App.callStartSpeakingMonitor=()=>{firstPublished={muted:App.callMuted,deafened:App.callDeafened,enabled:App.callGetLiveAudioTrack().enabled};};
    App.callAttachLocalStream(new Stream([raw]),{preserveAudioState:state});
    assert.deepEqual(firstPublished,{...state,enabled:!(state.muted||state.deafened)});
    assert.equal(raw.enabled,!(state.muted||state.deafened));
    // Loading a new call's nonzero volume must not run the ordinary zero-to-on
    // convenience unmute, even when the previous call had zero input volume.
    App.callInputVolume=0;
    App.callLoadAudioPreferences('room',{instanceId:'rekey',audioPreferences:{self:{inputVolume:100,outputVolume:100}}},{preserveAudioState:state});
    assert.equal(App.callMuted,state.muted);
    assert.equal(App.callDeafened,state.deafened);
    assert.equal(App.callGetLiveAudioTrack().enabled,!(state.muted||state.deafened));
    assert.equal(raw.enabled,!(state.muted||state.deafened));
  }
});

test('zero input updates local and published mute state, survives deafen and saved-call restoration', () => {
  const { App, Stream, Track } = harness();
  const updates = [];
  App.myCallMemberRef = { update: async patch => { updates.push(patch); } };
  App.callMembersCache.push({ code: 'self', muted: false, speaking: true });
  App.callAttachLocalStream(new Stream([new Track()]));
  App.callSetInputVolumePercent(0);
  assert.equal(App.callMuted, true);
  assert.equal(App.callMembersCache[0].muted, true);
  assert.equal(App.callMembersCache[0].speaking, false);
  assert.ok(updates.some(patch => patch.muted === true && patch.speaking === false));
  App.callToggleDeafen();
  assert.equal(App.callMuted, true, 'deafening cannot clear zero-volume mute');
  App.callToggleDeafen();
  assert.equal(App.callMuted, true, 'undeafening cannot clear zero-volume mute');
  App.callToggleMute();
  assert.equal(App.callGetInputVolumePercent(), 100, 'explicit Unmute restores audible input');
  assert.equal(App.callMuted, false);
  App.callMuted = true;
  App.callSetInputVolumePercent(60);
  assert.equal(App.callMuted, true, 'nonzero adjustments preserve manual mute');
  App.callMuted = false;
  App.callLoadAudioPreferences('room', { instanceId: 'saved', audioPreferences: { self: { inputVolume: 0 } } });
  assert.equal(App.callMuted, true);
  assert.equal(App.callGetLiveAudioTrack().enabled, false);
  App.callAttachLocalStream(new Stream([new Track()]));
  assert.equal(App.callMuted, true, 'fresh capture cannot clear zero-volume mute');
  App.callSetInputVolumePercent(40);
  assert.equal(App.callMuted, false);
  assert.equal(App.callGetLiveAudioTrack().enabled, true);
});

test('zero screen volume marks only that share muted and explicit Unmute restores volume', () => {
  const { App } = harness();
  App.callSetScreenVolume('peer', 0);
  assert.equal(App.callIsScreenMuted('peer'), true);
  assert.equal(App.callGetPlaybackGain('screen/peer'), 0);
  assert.equal(App.callIsScreenMuted('other'), false);
  assert.equal(App.callGetUserVolumePercent('peer'), 100);
  App.callSetScreenVolume('peer', 60);
  assert.equal(App.callIsScreenMuted('peer'), false);
  App.callSetScreenMuted('peer', true);
  App.callSetScreenVolume('peer', 70);
  assert.equal(App.callIsScreenMuted('peer'), true, 'volume changes retain an explicit mute');
  App.callSetScreenVolume('peer', 0);
  App.callSetScreenMuted('peer', false);
  assert.equal(App.callGetScreenVolume('peer'), 100);
  assert.equal(App.callIsScreenMuted('peer'), false);
  App.callLoadAudioPreferences('room', { instanceId: 'saved', audioPreferences: { self: { screens: { peer: 0 } } } });
  assert.equal(App.callIsScreenMuted('peer'), true, 'saved zero volume is still visibly muted');
});

test('mute displays zero while preserving input and screen levels for unmute', () => {
  const { App } = harness();
  App.callInputVolume = 65;
  App.callMuted = true;
  assert.equal(App.callGetEffectiveInputVolumePercent(), 0);
  assert.equal(App.callGetInputVolumePercent(), 65);
  App.callMuted = false;
  assert.equal(App.callGetEffectiveInputVolumePercent(), 65);
  App.callSetScreenVolume('peer', 180);
  App.callSetScreenMuted('peer', true);
  assert.equal(App.callGetEffectiveScreenVolume('peer'), 0);
  assert.equal(App.callGetScreenVolume('peer'), 180);
  App.callSetScreenMuted('peer', false);
  assert.equal(App.callGetEffectiveScreenVolume('peer'), 180);
});

test('deafen immediately silences native and Web Audio screens and late playback refreshes, then restores levels', () => {
  const { App, AudioContext, element } = harness();
  App.callPlaybackCtx = new AudioContext();
  const native = element(); native.dataset.peerCode = 'peer';
  App.callRemoteAudioEls.set('peer', native);
  const screen = element(); screen.dataset.peerCode = 'screen/peer';
  App.callRemoteAudioEls.set('screen/peer', screen);
  const gain = App.callPlaybackCtx.createGain();
  App.callRemoteWebAudioSources.set('screen/peer', { gain, audio: screen });
  App.callRemoteScreenAudioStreams.set('peer', {});
  App.callSetScreenVolume('peer', 175);
  assert.equal(gain.gain.value, 1.75);
  App.callDeafened = true;
  App.callApplyLocalMuteState();
  assert.equal(native.muted, true);
  assert.equal(screen.muted, true);
  assert.equal(gain.gain.value, 0);
  assert.equal(App.callScreenShouldPlay('peer'), false);
  assert.equal(App.callGetPlaybackGain('screen/peer'), 0);
  App.callApplyRemoteUserVolume('screen/peer', { smooth: false });
  assert.equal(gain.gain.value, 0, 'late track setup cannot bypass deafen');
  App.callDeafened = false;
  App.callApplyLocalMuteState();
  assert.equal(native.muted, false);
  assert.equal(gain.gain.value, 1.75);
});

test('selected microphone is retained through constraint fallback, refresh and actual sender replacement', async () => {
  const { App, context, Stream, Track } = harness();
  App.callPreferredAudioInputId = 'usb-mic';
  const captures = [];
  context.navigator.mediaDevices.getUserMedia = async constraints => {
    captures.push(constraints);
    if (captures.length === 1) throw Object.assign(new Error('Unsupported optional processing'), { name: 'OverconstrainedError' });
    return new Stream([new Track(constraints.audio.deviceId.exact)]);
  };
  const sent = [];
  App.callPeerMap.set('peer', {});
  App.callSetPeerAudioTrack = async (_pc, track) => sent.push(track);
  assert.equal(await App.callRefreshMic(), true);
  assert.equal(captures.length, 2);
  assert.ok(captures.every(request => request.audio.deviceId.exact === 'usb-mic'));
  assert.equal(sent[0], App.callMicDestination.stream.getAudioTracks()[0]);
  assert.notEqual(sent[0], App.callRawMicrophoneStream.getAudioTracks()[0]);
  assert.equal(App.callPreferredAudioInputId, 'usb-mic');
  assert.equal(await App.callSetInputDevice('headset'), true);
  assert.equal(captures.at(-1).audio.deviceId.exact, 'headset');
  assert.equal(await App.callRefreshMic(), true);
  assert.equal(captures.at(-1).audio.deviceId.exact, 'headset');
  assert.equal(App.callPreferredAudioInputId, 'headset');
});

test('stale microphone permission result cannot attach to a replacement call or clear its pending refresh', async () => {
  const { App, Stream, Track } = harness();
  let finish;
  App.callRequestMicPermission = () => new Promise(resolve => { finish = resolve; });
  const result = App.callRefreshMic();
  App.callLifecycleToken += 1;
  App.callSessionId = 'replacement';
  App.callMicRefreshGeneration += 1;
  App.callMicRefreshPending = true;
  const stale = new Track();
  finish(new Stream([stale]));
  await result;
  assert.equal(stale.readyState, 'ended');
  assert.equal(App.callLocalStream, undefined);
  assert.equal(App.callMicRefreshPending, true);
});

test('selecting System default remains the default across microphone refresh and reattachment', async () => {
  const { App, context, Stream, Track } = harness();
  const captures = [];
  context.navigator.mediaDevices.getUserMedia = async constraints => {
    captures.push(constraints);
    return new Stream([new Track('current-physical-device')]);
  };
  App.callPreferredAudioInputId = 'old-headset';
  assert.equal(await App.callSetInputDevice(''), true);
  assert.equal(App.callPreferredAudioInputId, '');
  assert.equal(await App.callRefreshMic(), true);
  assert.ok(captures.every(request => !request.audio.deviceId));
  App.callAttachLocalStream(new Stream([new Track('new-os-default')]));
  assert.equal(App.callPreferredAudioInputId, '');
});

test('output master stacks with voice and screen gains through one bounded shared mix', () => {
  const { App, Stream, Track, element } = harness();
  App.callUserVolumes.set('peer', 400);
  App.callScreenVolumes.set('peer', 300);
  App.callSetOutputVolumePercent(200);
  assert.equal(App.callGetPlaybackGain('peer'), 8);
  assert.equal(App.callGetPlaybackGain('screen/peer'), 6);
  App.callPrimePlaybackContextFromGesture();
  for (const key of ['peer', 'screen/peer']) {
    const audio = element();
    audio.dataset.peerCode = key;
    audio.srcObject = new Stream([new Track()]);
    App.callRemoteAudioEls.set(key, audio);
    App.callApplyRemoteUserVolume(key, { smooth: false });
    assert.equal(audio.muted, true);
    assert.equal(App.callRemoteWebAudioSources.get(key).gain.connections[0], App.callPlaybackMix.input);
  }
  const curve = App.callPlaybackMix.ceiling.curve;
  assert.ok(Math.max(...curve) < 0.92);
  assert.ok(Math.min(...curve) > -0.92);
  App.callSetOutputVolumePercent(0);
  for (const entry of App.callRemoteWebAudioSources.values()) assert.equal(entry.gain.gain.value, 0);
  App.callSetOutputVolumePercent(500);
  assert.equal(App.callGetOutputVolumePercent(), 200);
  App.callDeafened = true;
  App.callApplyLocalMuteState();
  for (const entry of App.callRemoteWebAudioSources.values()) assert.equal(entry.gain.gain.value, 0);
});

test('output selection reaches both AudioContext and native elements, with a protected mix bridge fallback', async () => {
  const { App, element } = harness();
  const audio = element();
  App.callRemoteAudioEls.set('peer', audio);
  assert.equal(await App.callSetOutputDevice('headphones'), true);
  assert.equal(App.callPlaybackCtx.sinkId, 'headphones');
  assert.equal(audio.sinkId, 'headphones');
  assert.equal(App.callPreferredAudioOutputId, 'headphones');
  App.callPlaybackCtx.setSinkId = undefined;
  assert.equal(await App.callSetOutputDevice('speakers'), true);
  assert.equal(App.callPlaybackMix.audio.sinkId, 'speakers');
  assert.equal(App.callPlaybackMix.ceiling.connections[0], App.callPlaybackMix.destination);
  assert.equal(await App.callSetOutputDevice('default'), true);
  assert.equal(App.callPlaybackMix.audio, null);
  assert.equal(App.callPlaybackMix.ceiling.connections[0], App.callPlaybackCtx.destination);
});

test('an output device switch pending during leave cannot reroute the next call', async () => {
  const { App, element } = harness();
  let finishRoute;
  const oldAudio = element();
  App.callRemoteAudioEls.set('old-peer', oldAudio);
  App.callApplyOutputRoute = () => new Promise(resolve => { finishRoute = resolve; });
  const selection = App.callSetOutputDevice('old-call-headphones');
  await Promise.resolve();
  App.callAudioPlaybackToken += 1;
  App.callRemoteAudioEls.clear();
  const newAudio = element();
  App.callRemoteAudioEls.set('new-peer', newAudio);
  finishRoute();
  assert.equal(await selection, false);
  assert.equal(newAudio.sinkId, undefined);
  assert.equal(oldAudio.sinkId, undefined);
  assert.equal(App.callPreferredAudioOutputId, '');
});

test('early membership events cannot publish media before saved call volumes are loaded', async () => {
  const { App, context } = harness();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../call-modules/peers.js'), 'utf8'), context);
  App.sanitizeCallRoom = String;
  App.callMembersCache = [{ code: 'peer', sessionId: 'peer-session' }];
  App.callPeerHardRestartPending = new Set();
  context.ChatCallPolicy = { keepMember: () => true };
  App.callScheduleMediaBudget = () => {};
  App.callUpdateConnectionQuality = async () => {};
  const captures = [];
  App.callCreatePeer = () => { captures.push([App.callGetInputVolumePercent(), App.callGetOutputVolumePercent()]); return null; };
  App.callAudioPreferencesReady = false;
  await App.callEnsurePeers('room');
  assert.deepEqual(captures, [], 'the early membership callback cannot create a peer');
  App.callLoadAudioPreferences('room', { instanceId: 'existing', audioPreferences: { self: { inputVolume: 0, outputVolume: 0 } } });
  await App.callEnsurePeers('room');
  assert.deepEqual(captures, [[0, 0]], 'the first peer observes the saved zero volume settings');
});

test('real Web Audio rendering keeps multiple maximum-boost sources below full scale', async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => { window.ChatApp = { register() {} }; });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../call-modules/playback.js'), 'utf8') });
    const result = await page.evaluate(async () => {
      const ctx = new OfflineAudioContext(1, 48000, 48000);
      ChatApp.callPlaybackCtx = ctx;
      const mix = ChatApp.callEnsurePlaybackMix();
      for (let index = 0; index < 6; index++) {
        const source = ctx.createOscillator();
        source.frequency.value = 440;
        const gain = ctx.createGain();
        gain.gain.value = 8;
        source.connect(gain).connect(mix.input);
        source.start();
      }
      const buffer = await ctx.startRendering();
      let peak = 0;
      let finite = true;
      for (const sample of buffer.getChannelData(0)) { peak = Math.max(peak, Math.abs(sample)); finite &&= Number.isFinite(sample); }
      return { peak, finite };
    });
    assert.equal(result.finite, true);
    assert.ok(result.peak > 0.1, 'the output remains audible');
    assert.ok(result.peak < 0.92, `summed output peak ${result.peak} stays below full scale`);
  } finally { await browser.close(); }
});

test('participant mute preserves the selected level and zero-volume Unmute restores audibility', () => {
  const { App } = harness();
  App.callSetUserVolumePercent('peer', 275);
  App.callSetUserMuted('peer', true);
  assert.equal(App.callGetUserVolumePercent('peer'), 275);
  assert.equal(App.callGetUserVolumeGain('peer'), 0);
  assert.equal(App.callIsUserMuted('peer'), true);
  App.callSetUserMuted('peer', false);
  assert.equal(App.callGetUserVolumeGain('peer'), 2.75);
  App.callSetUserVolumePercent('peer', 0);
  assert.equal(App.callIsUserMuted('peer'), true);
  App.callSetUserMuted('peer', false);
  assert.equal(App.callGetUserVolumeGain('peer'), 1);
});
