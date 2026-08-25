const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'widget-room/src/App.tsx'), 'utf8');

test('room success requires SDK validation, socket, room, and member', () => {
  const start = app.indexOf('const validated = params.validated === true;');
  const end = app.indexOf("postToParent('roomConnected', { roomName, success: true });", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const connectionGate = app.slice(start, end);
  assert.match(connectionGate, /const authoritativeRoomConnected = Boolean/);
  assert.match(connectionGate, /validated &&[\s\S]*socket\?\.connected &&[\s\S]*roomName &&[\s\S]*member/);
  assert.match(connectionGate, /!connectionFailureReportedRef\.current/);
  assert.match(connectionGate, /roomConnectedRef\.current = true/);
});

test('HTTP and request failures report one terminal roomConnected failure', () => {
  assert.match(app, /connectionFailureReportedRef/);
  assert.match(app, /if \(roomConnectedRef\.current \|\| connectionFailureReportedRef\.current\)/);
  assert.match(app, /reportConnectionFailure\(data\?\.error \|\| data\?\.message/);
  assert.match(app, /reportConnectionFailure\('Failed to connect to MediaSFU/);
  assert.match(app, /reportConnectionFailure\('Connection timeout/);
  assert.equal((app.match(/postToParent\('roomConnected'/g) || []).length, 2);
});

test('failure gate prevents a later success transition', () => {
  const failure = app.indexOf('connectionFailureReportedRef.current = true;');
  const successGate = app.indexOf('const authoritativeRoomConnected = Boolean(');
  assert.ok(failure >= 0);
  assert.ok(successGate > failure);
  assert.match(app.slice(successGate, successGate + 420), /!connectionFailureReportedRef\.current/);
  assert.match(app, /socket\?\.connected && roomName && member && !connectionFailureReportedRef\.current && !widgetCallStartedRef\.current/);
  assert.doesNotMatch(app, /callConfig\.serverCallStarted && !widgetCallStartedRef\.current/);
});

test('the full audio unlock surface is shown as soon as the browser-host room is ready', () => {
  assert.match(app, /roomConnected && !audioUnlocked/);
  assert.match(app, />Tap to Enable Audio<\/h2>/);
  assert.match(app, /Tap anywhere to enable microphone and speaker/);
  assert.match(app, /onClick=\{unlockAudio\}/);
});
test('trusted compact unlock retries existing and future audio elements before starting the microphone', () => {
  const unlockStart = app.indexOf('const unlockAudio = useCallback');
  const unlockEnd = app.indexOf('// Validate sessionToken', unlockStart);
  const unlock = app.slice(unlockStart, unlockEnd);
  assert.match(unlock, /document\.querySelectorAll\('audio'\)/);
  assert.match(unlock, /new MutationObserver/);
  assert.match(unlock, /audioObserverRef\.current\.observe\(document\.body/);
  assert.match(unlock, /audio\.play\(\)/);
  assert.match(unlock, /postToParent\('audioUnlocked', \{ success: true \}\)/);
  assert.match(unlock, /Starting microphone after audio unlock/);
});
test('browser-host flow always creates through the rooms endpoint', () => {
  const optionsStart = app.indexOf('const noUIOptions = useMemo(() => {');
  const optionsEnd = app.indexOf('// Function to create/join room via MediaSFU API', optionsStart);
  assert.ok(optionsStart >= 0);
  assert.ok(optionsEnd > optionsStart);
  const options = app.slice(optionsStart, optionsEnd);

  assert.match(options, /action: 'create' as const/);
  assert.match(options, /userName: sanitizedUserName/);
  assert.doesNotMatch(options, /action: 'join'/);
  assert.doesNotMatch(options, /serverCallStarted/);

  const requestStart = app.indexOf('const handleMediaSFURequest = useCallback');
  const requestEnd = app.indexOf("if (error)", requestStart);
  assert.ok(requestStart >= 0);
  assert.ok(requestEnd > requestStart);
  const request = app.slice(requestStart, requestEnd);

  assert.match(request, new RegExp('v1/rooms'));
  assert.doesNotMatch(request, /Pre-provisioned widget call room ready/);
  assert.doesNotMatch(request, /payload\\?\\.action === 'join'/);
});

test('connected source parameters start the widget call without an audio unlock gate', () => {
  const start = app.indexOf('const handleSourceParametersUpdate');
  const end = app.indexOf('// Track audio streams for AudioGrid rendering', start);
  const handler = app.slice(start, end);
  assert.match(handler, /socket\?\.connected && roomName && member && !connectionFailureReportedRef\.current && !widgetCallStartedRef\.current/);
  assert.match(handler, /setTimeout\(\(\) => emitStartWidgetCall\(socket, roomName, member\), 500\)/);
  assert.match(handler, /emitStartWidgetCall,\s*\]\);/);
  assert.doesNotMatch(handler, /audioUnlocked/);
  assert.doesNotMatch(app, /startWidgetCallIfReady/);
});
