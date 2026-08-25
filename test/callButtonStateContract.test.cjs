const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const callButton = fs.readFileSync(path.join(root, 'src/components/call-button/CallButton.ts'), 'utf8');

test('allocation remains connecting and does not announce success', () => {
  const allocation = callButton.indexOf('this.currentCallId = callId;');
  const roomConnected = callButton.indexOf("case 'roomConnected'");
  assert.ok(roomConnected > allocation);
  const pending = callButton.slice(allocation, roomConnected);
  assert.doesNotMatch(pending, /this\.callStartTime = new Date/);
  assert.doesNotMatch(pending, /call-connected|call-start|startDurationTimer/);
});

test('allocation opens the server room URL without compact mode injection', () => {
  assert.match(callButton, /this\.openRoomWindow\(result\.roomUrl\)/);
  assert.doesNotMatch(callButton, /appendCompactCallMode/);
  assert.doesNotMatch(callButton, /widgetMode', 'compact-call'/);
});

test('roomConnected with a valid room immediately connects and starts timing', () => {
  const start = callButton.indexOf("case 'roomConnected'");
  const end = callButton.indexOf("case 'widgetCallStarted'", start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /payload\?\.success !== true/);
  assert.match(handler, /typeof payload\?\.roomName === 'string'/);
  assert.match(handler, /this\.failCall/);
  assert.match(handler, /this\.roomName = roomName/);
  assert.match(handler, /this\.markCallConnected\(payload\)/);
  assert.match(handler, /showIframeForAudioUnlock/);
  assert.match(handler, /dispatchWidgetEvent\(this, 'audio-unlock-required'/);
  assert.match(handler, /reason: 'browser-audio-policy'/);
  assert.doesNotMatch(handler, /markCallConnected\(payload,\s*true\)/);
  assert.doesNotMatch(handler, /call-setup-complete/);
});

test('roomConnected rejects a success without a usable room name', () => {
  const start = callButton.indexOf("case 'roomConnected'");
  const end = callButton.indexOf("case 'widgetCallStarted'", start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /!roomName/);
  assert.match(handler, /this\.failCall/);
});

test('widgetCallStarted is an idempotent success transition and diagnostics stay passive', () => {
  const start = callButton.indexOf("case 'widgetCallStarted'");
  const end = callButton.indexOf("case 'mediaDiagnostics'", start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /payload\?\.success !== true/);
  assert.match(handler, /this\.markCallConnected\(payload, true\)/);
  assert.doesNotMatch(handler, /showIframeForAudioUnlock/);
});

test('remoteAudioReady remains diagnostic-only', () => {
  const start = callButton.indexOf("case 'remoteAudioReady'");
  const end = callButton.indexOf("case 'microphoneError'", start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /remote-audio-ready/);
  assert.doesNotMatch(handler, /markCallConnected|call-connected|call-start|startDurationTimer/);
});

test('audio unlock is an optional compact fallback and never a connection signal', () => {
  const start = callButton.indexOf("case 'audioUnlockRequired'");
  const end = callButton.indexOf("case 'remoteAudioReady'", start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /showIframeForAudioUnlock/);
  assert.doesNotMatch(handler, /markCallConnected|call-connected|call-start|startDurationTimer/);
  assert.match(callButton, /width: 320px;/);
  assert.match(callButton, /height: 280px;/);
});

test('a trusted iframe unlock is forwarded as observed widget evidence', () => {
  const start = callButton.indexOf("case 'audioUnlocked'");
  const end = callButton.indexOf('private showIframeForAudioUnlock', start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /this\.hideIframe\(\)/);
  assert.match(handler, /this\.setMicActive\(\)/);
  assert.match(handler, /dispatchWidgetEvent\(this, 'audio-unlocked'/);
  assert.match(handler, /roomName: this\.roomName \|\| undefined/);
  assert.doesNotMatch(handler, /markCallConnected|call-connected|startDurationTimer/);
});

test('success transition is idempotent and keeps the room iframe compact', () => {
  const helperStart = callButton.indexOf('private markCallConnected');
  const helperEnd = callButton.indexOf('private setState', helperStart);
  const helper = callButton.slice(helperStart, helperEnd);
  assert.match(helper, /setupComplete = false/);
  assert.match(helper, /this\.state !== 'connected'/);
  assert.match(helper, /if \(!this\.durationInterval\) this\.startDurationTimer\(\)/);
  assert.match(helper, /setupComplete && !this\.callSetupComplete/);
  assert.match(helper, /this\.callSetupComplete = true/);
  assert.match(helper, /dispatchWidgetEvent\(this, 'call-setup-complete'/);
  assert.equal((callButton.match(/'call-setup-complete'/g) || []).length, 1);
  assert.match(callButton, /return this\.getAttribute\('headless-mode'\) !== 'false'/);
  assert.match(callButton, /width: 1px;/);
  assert.doesNotMatch(callButton, /consumeSockets|liveAudioTracks/);
});

test('room iframe survives shadow renders and cleanup owns removal', () => {
  const openStart = callButton.indexOf('private openRoomIframe');
  const openEnd = callButton.indexOf('private handleIframeMessage', openStart);
  const openRoom = callButton.slice(openStart, openEnd);
  assert.match(openRoom, /const iframeParent = document\.body \|\| document\.documentElement/);
  assert.match(openRoom, /iframeParent\.appendChild\(iframe\)/);
  assert.match(openRoom, /iframe\.referrerPolicy = 'origin'/);
  assert.doesNotMatch(openRoom, /this\.appendChild\(iframe\)/);
  assert.doesNotMatch(openRoom, /this\.shadow\.appendChild\(iframe\)/);
  const stateStart = callButton.indexOf('private setState');
  const cleanupStart = callButton.indexOf('private cleanup');
  const lifecycle = callButton.slice(stateStart, cleanupStart);
  assert.match(lifecycle, /this\.render\(\)/);
  assert.match(callButton.slice(cleanupStart), /this\.roomIframe\.remove\(\)/);
  assert.match(callButton.slice(cleanupStart), /this\.roomIframe = null/);
});
test('room messages require the exact iframe or popup window and resolved origin', () => {
  const start = callButton.indexOf('private handleIframeMessage');
  const end = callButton.indexOf('private showIframeForAudioUnlock', start);
  const handler = callButton.slice(start, end);
  assert.match(handler, /event\.source !== expectedSource/);
  assert.match(handler, /event\.origin !== this\.roomOrigin/);
  assert.doesNotMatch(handler, /event\.origin\.match/);
  assert.doesNotMatch(handler, /startsWith\('http:\/\/localhost'\)/);
  assert.match(callButton, /this\.roomOrigin = resolveRoomTargetOrigin\(roomUrl\) \|\| ''/);
  assert.doesNotMatch(callButton, /this\.roomOrigin \|\| '\*'/);
});
test('failure path stops timer, resets state, and reports both failures', () => {
  assert.match(callButton, /private failCall\(message: string\)/);
  assert.match(callButton, /this\.stopDurationTimer\(\)/);
  assert.match(callButton, /this\.resetCallState\(\)/);
  assert.match(callButton, /this\.callSetupComplete = false/);
  assert.match(callButton, /dispatchWidgetEvent\(this, 'widget-error'/);
  assert.match(callButton, /dispatchWidgetEvent\(this, 'call-failed'/);
});
