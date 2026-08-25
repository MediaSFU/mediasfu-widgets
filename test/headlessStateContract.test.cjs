/* Runs with node:test, matching the package's existing CJS contract tests. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const packageRoot = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const compiler = process.execPath;
const compilerEntry = path.join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-headless-normalizer-'));

try {
  execFileSync(compiler, [compilerEntry,
    '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--esModuleInterop', '--skipLibCheck', '--outDir', output,
    path.join(packageRoot, 'src', 'headless', 'types.ts'),
    path.join(packageRoot, 'src', 'headless', 'normalizeMediaSFUState.ts'),
  ], { stdio: 'pipe' });
} catch (error) {
  const detail = error && error.stderr ? error.stderr.toString() : String(error);
  throw new Error(`Could not compile the headless normalizer: ${detail}`);
}

const { normalizeMediaSFUState } = require(path.join(output, 'normalizeMediaSFUState.js'));
test.after(() => fs.rmSync(output, { recursive: true, force: true }));

test('headless normalizer produces only immutable, serializable semantic data', () => {
  const result = normalizeMediaSFUState({
    roomName: 'room-123', member: 'Ada', memberId: 'member-1', islevel: '2',
    socket: { connected: true, emit() {} }, localSocket: { connected: true },
    apiKey: 'must-not-leak', validated: true, getUpdatedAllParams() { return this; }, localStream: { private: true },
    audioAlreadyOn: true, videoAlreadyOn: false, screenAlreadyOn: false,
    audioInputs: [{ deviceId: 'mic-1', label: 'Studio mic', groupId: 'must-not-leak' }, { deviceId: 'mic-1', label: 'Duplicate' }],
    videoInputs: [{ deviceId: 'cam-1', label: '' }],
    participants: [{ id: 'member-1', name: 'Ada', islevel: '2', audioOn: true, videoOn: false }],
    messages: [{ id: 'message-1', sender: 'Ada', message: 'Hello', group: true }],
  }, 'participant');

  assert.equal(result.session.status, 'ready');
  assert.equal(result.session.role, 'host');
  assert.equal(result.participants[0].isSelf, true);
  assert.equal(result.messages[0].text, 'Hello');
  assert.deepEqual(result.devices, { microphones: [{ id: 'mic-1', label: 'Studio mic', kind: 'microphone' }], cameras: [{ id: 'cam-1', label: 'Camera 1', kind: 'camera' }] });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(result).includes('connected'), false);
  assert.equal(JSON.stringify(result).includes('groupId'), false);
});

test('headless normalizer fails closed before readiness and when host settings deny access', () => {
  const result = normalizeMediaSFUState({
    roomName: 'room-123', socket: { connected: false }, audioSetting: 'disallow',
    videoSetting: 'disallow', screenshareSetting: 'disallow', chatSetting: 'disallow',
  });

  assert.equal(result.permissions.canUseMicrophone, false);
  assert.equal(result.permissions.canUseCamera, false);
  assert.equal(result.permissions.canShareScreen, false);
  assert.equal(result.permissions.canSendMessage, false);
  assert.deepEqual(result.devices, { microphones: [], cameras: [] });
  assert.match(result.permissions.microphoneDisabledReason || '', /Join the room/);
});
test('headless normalizer rejects a local-only socket even after validation', () => {
  const result = normalizeMediaSFUState({
    roomName: 'room-123', member: 'Ada', validated: true,
    localSocket: { connected: true, emit() {} },
  });

  assert.equal(result.session.status, 'connecting');
  assert.match(result.permissions.microphoneDisabledReason || '', /Join the room/);
});

test('headless normalizer exposes reconnecting and revokes capabilities when a validated primary socket disconnects', () => {
  const result = normalizeMediaSFUState({
    roomName: 'room-123', member: 'Ada', validated: true,
    socket: { connected: false, emit() {} },
    audioSetting: 'allow', videoSetting: 'allow', screenshareSetting: 'allow', chatSetting: 'allow',
  });

  assert.equal(result.session.status, 'reconnecting');
  assert.equal(result.permissions.canUseMicrophone, false);
  assert.equal(result.permissions.canUseCamera, false);
  assert.equal(result.permissions.canShareScreen, false);
  assert.equal(result.permissions.canSendMessage, false);
  assert.match(result.permissions.microphoneDisabledReason || '', /Wait for reconnection/);
});

test('headless normalizer uses stable member IDs and never marks duplicate display names as the same participant', () => {
  const result = normalizeMediaSFUState({
    roomName: 'room-123', member: 'Ada', memberId: 'member-1', validated: true,
    socket: { connected: true, emit() {} },
    participants: [
      { id: 'member-1', name: 'Ada', islevel: '0' },
      { id: 'member-2', name: 'Ada', islevel: '0' },
    ],
  });

  assert.deepEqual(result.participants.map(participant => participant.isSelf), [true, false]);
});
