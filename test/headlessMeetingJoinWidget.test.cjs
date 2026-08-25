/* Focused contract for the additive participant-only semantic join widget. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const root = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-headless-join-widget-'));
const source = path.join(root, 'src', 'widgets', 'HeadlessMeetingJoinWidget.tsx');
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json'), '--module', 'commonjs', '--jsx', 'react-jsx', '--noEmit', 'false', '--outDir', out, '--declarationDir', path.join(out, 'types')], { stdio: 'pipe' });
const selectedDevices = [];
const semanticState = { session: { status: 'left', role: 'participant' }, media: { microphone: { active: false }, camera: { active: true }, screen: { active: false } }, devices: { microphones: [{ id: 'mic-1', label: 'Studio microphone', kind: 'microphone' }], cameras: [{ id: 'cam-1', label: 'Front camera', kind: 'camera' }] }, participants: [{ id: 'member-1', name: 'Ada', role: 'participant', isSelf: true, microphoneActive: false, cameraActive: true }, { id: 'member-2', name: 'Grace', role: 'host', isSelf: false, microphoneActive: true, cameraActive: false }], messages: [{ id: 'message-1', sender: 'Grace', text: 'Welcome', group: true }], actionStates: { microphone: { status: 'disabled', disabledReason: 'Permission is required.' }, camera: { status: 'error', error: 'Camera is unavailable.' }, screen: { status: 'disabled', disabledReason: 'Only hosts and co-hosts can share their screen in this room.' }, device: { status: 'idle' }, message: { status: 'disabled', disabledReason: 'Join the room before sending messages.' }, leave: { status: 'disabled', disabledReason: 'Joining is still in progress.' } }, actions: { toggleMicrophone: async () => ({ ok: true }), toggleCamera: async () => ({ ok: true }), toggleScreenShare: async () => ({ ok: true }), selectDevice: async (kind, id) => { selectedDevices.push([kind, id]); return { ok: true }; }, sendMessage: async () => ({ ok: true }), leave: async () => ({ ok: true, effect: 'exit-requested' }) } };
const ReactMock = { useId: () => 'headless-test' };
function Provider(props) { return { type: Provider, props }; }
const jsx = (type, props, key) => typeof type === 'function' && type !== Provider ? type(props) : { type, props: { ...props, key } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return ReactMock;
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (request === '../headless/MediaSFUProvider') return { MediaSFUProvider: Provider };
  if (request === '../headless/useMediaSFU') return { useMediaSFU: () => semanticState };
  return originalLoad.call(this, request, parent, isMain);
};
const { HeadlessMeetingJoinWidget, resolveHeadlessMeetingID } = require(path.join(out, 'widgets', 'HeadlessMeetingJoinWidget.js'));
test.after(() => { Module._load = originalLoad; fs.rmSync(out, { recursive: true, force: true }); });
function childrenOf(node) { return (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).flat(Infinity).filter(Boolean); }
test('maps the legacy room prefix safely and fails closed for blank meeting IDs', () => {
  assert.equal(resolveHeadlessMeetingID('  team-', ' room-1 '), 'team-room-1');
  assert.equal(resolveHeadlessMeetingID('team-', '   '), undefined);
});
test('is join-only, forwards credentials privately, and renders only semantic controls', () => {
  const credentials = { apiUserName: 'test-user', apiKey: 'test-api-key' };
  const tree = HeadlessMeetingJoinWidget({ roomPrefix: 'team-', meetingID: 'room-1', userName: 'Ada', credentials });
  assert.equal(tree.type, Provider); assert.equal(tree.props.operation, 'join'); assert.equal(tree.props.role, 'participant'); assert.equal(tree.props.meetingId, 'team-room-1'); assert.equal(tree.props.credentials, credentials);
  const controls = tree.props.children; assert.equal(controls.type, 'section');
  const buttons = childrenOf(controls).filter(node => node.type === 'button');
  assert.equal(buttons.length, 4); assert.equal(buttons[0].props['aria-pressed'], false); assert.equal(buttons[1].props.disabled, false); assert.equal(buttons[2].props['aria-pressed'], false); assert.equal(buttons[2].props.disabled, true); assert.equal(buttons[3].props.disabled, true);
  const feedback = childrenOf(controls).filter(node => node.type === 'p' && node.props.id);
  assert.deepEqual(feedback.map(node => [node.props.id, node.props.children, node.props.role]), [
    ['headless-test-microphone-feedback', 'Microphone: Permission is required.', undefined],
    ['headless-test-camera-feedback', 'Camera: Camera is unavailable.', 'alert'],
    ['headless-test-screen-feedback', 'Screen share: Only hosts and co-hosts can share their screen in this room.', undefined],
    ['headless-test-message-feedback', 'Message: Join the room before sending messages.', undefined],
    ['headless-test-leave-feedback', 'Leave meeting: Joining is still in progress.', undefined],
  ]);
  assert.equal(buttons[0].props['aria-describedby'], 'headless-test-microphone-feedback');
  assert.equal(buttons[1].props['aria-describedby'], undefined);
  assert.equal(buttons[2].props['aria-describedby'], 'headless-test-screen-feedback');
  assert.equal(buttons[3].props['aria-describedby'], 'headless-test-leave-feedback');
  const regions = childrenOf(controls).filter(node => node.type === 'section');
  assert.deepEqual(regions.map(node => node.props['aria-label']), ['Media devices', 'Participants', 'Meeting messages']);
  const deviceSelects = childrenOf(regions[0]).filter(node => node.type === 'select');
  assert.equal(deviceSelects.length, 2); assert.equal(deviceSelects[0].props.id, 'headless-test-microphone-select'); assert.equal(deviceSelects[1].props.id, 'headless-test-camera-select');
  const participantItems = childrenOf(regions[1]).flatMap(childrenOf).filter(node => node.type === 'li');
  assert.equal(participantItems.length, 2); assert.equal(participantItems[0].props['data-media-sfu-self'], 'true');
  const messageItems = childrenOf(regions[2]).flatMap(childrenOf).filter(node => node.type === 'li');
  assert.equal(messageItems.length, 1); assert.equal(JSON.stringify(messageItems[0]).includes('Welcome'), true);
  const messageForm = childrenOf(regions[2]).find(node => node.type === 'form');
  const messageControls = childrenOf(messageForm); const input = messageControls.find(node => node.type === 'input'); const send = messageControls.find(node => node.type === 'button');
  assert.equal(messageForm.props['aria-label'], 'Send meeting message'); assert.equal(input.props.id, 'headless-test-message-input'); assert.equal(input.props.disabled, true); assert.equal(input.props['aria-describedby'], 'headless-test-message-feedback'); assert.equal(send.props.disabled, true);
  assert.equal(childrenOf(controls)[0].props.children, 'Left the meeting.');
  assert.equal(JSON.stringify(controls).includes('socket'), false); assert.equal(JSON.stringify(controls).includes('apiKey'), false);
});
test('selects only projected microphone and camera IDs through the semantic action', async () => {
  selectedDevices.length = 0;
  const tree = HeadlessMeetingJoinWidget({ meetingID: 'room-1', userName: 'Ada' });
  const devices = childrenOf(tree.props.children).find(node => node.type === 'section' && node.props['aria-label'] === 'Media devices');
  const selects = childrenOf(devices).filter(node => node.type === 'select');
  selects[0].props.onChange({ currentTarget: { value: 'mic-1' } });
  selects[1].props.onChange({ currentTarget: { value: 'cam-1' } });
  await Promise.resolve();
  assert.deepEqual(selectedDevices, [['microphone', 'mic-1'], ['camera', 'cam-1']]);
});
test('submits a trimmed message only through the semantic action and resets after success', async () => {
  const priorStatus = semanticState.actionStates.message.status;
  const priorReason = semanticState.actionStates.message.disabledReason;
  const priorSend = semanticState.actions.sendMessage;
  const PriorFormData = global.FormData;
  let sent; let resets = 0;
  semanticState.actionStates.message.status = 'idle';
  semanticState.actionStates.message.disabledReason = undefined;
  semanticState.actions.sendMessage = async text => { sent = text; return { ok: true }; };
  global.FormData = class { get(name) { assert.equal(name, 'message'); return '  hello securely  '; } };
  try {
    const tree = HeadlessMeetingJoinWidget({ meetingID: 'room-1', userName: 'Ada' });
    const messages = childrenOf(tree.props.children).filter(node => node.type === 'section' && node.props['aria-label'] === 'Meeting messages')[0];
    const form = childrenOf(messages).find(node => node.type === 'form');
    form.props.onSubmit({ preventDefault() {}, currentTarget: { reset() { resets += 1; } } });
    await Promise.resolve();
    assert.equal(sent, 'hello securely'); assert.equal(resets, 1);
  } finally {
    semanticState.actionStates.message.status = priorStatus;
    semanticState.actionStates.message.disabledReason = priorReason;
    semanticState.actions.sendMessage = priorSend;
    global.FormData = PriorFormData;
  }
});
