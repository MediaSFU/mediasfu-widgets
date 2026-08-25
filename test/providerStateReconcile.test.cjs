const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const root = process.env.PHASE_C_STAGE_ROOT || path.resolve(__dirname, '..');
const dependenciesRoot = process.env.MEDIASFU_WIDGETS_DEPS_ROOT || root;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-provider-'));
execFileSync(process.execPath, [path.join(dependenciesRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json'), '--module', 'commonjs', '--jsx', 'react-jsx', '--noEmit', 'false', '--outDir', out, '--declarationDir', path.join(out, 'types')]);
const hooks = []; let cursor = 0;
const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const ReactMock = {
  createContext: () => ({ Provider: 'Provider' }),
  useRef: initial => { const index = cursor++; if (!hooks[index]) hooks[index] = { value: { current: initial } }; return hooks[index].value; },
  useState: initial => { const index = cursor++; if (!hooks[index]) { const slot = { value: typeof initial === 'function' ? initial() : initial }; slot.set = next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }; hooks[index] = slot; } return [hooks[index].value, hooks[index].set]; },
  useEffect: () => { cursor++; },
  useCallback: (factory, deps) => { const index = cursor++; const slot = hooks[index]; if (slot && sameDeps(slot.deps, deps)) return slot.value; hooks[index] = { deps: Array.isArray(deps) ? deps.slice() : deps, value: factory }; return factory; },
  useMemo: (factory, deps) => { const index = cursor++; const slot = hooks[index]; if (slot && sameDeps(slot.deps, deps)) return slot.value; const value = factory(); hooks[index] = { deps: Array.isArray(deps) ? deps.slice() : deps, value }; return value; },
};
const sdk = { exits: [], messages: [], media: [], rejectNext: false, ModernMediasfuGeneric: 'ModernMediasfuGeneric', confirmExit: async p => { sdk.exits.push(p); if (sdk.rejectNext) { sdk.rejectNext = false; throw new Error('retry'); } }, clickAudio: async p => sdk.media.push(['audio', p.parameters]), clickVideo: async p => sdk.media.push(['video', p.parameters]), clickScreenShare: async p => sdk.media.push(['screen', p.parameters]), switchUserAudio: async p => sdk.media.push(['mic-device', p.parameters]), switchUserVideo: async p => sdk.media.push(['cam-device', p.parameters]), sendMessage: async p => sdk.messages.push(p) };
const original = Module._load; Module._load = function(request, parent, isMain) { if (request === 'react') return ReactMock; if (request === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) }; if (request === 'mediasfu-reactjs') return sdk; return original.call(this, request, parent, isMain); };
function findCompiledProvider(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findCompiledProvider(candidate);
      if (found) return found;
    } else if (entry.name === 'MediaSFUProvider.js') {
      return candidate;
    }
  }
  return undefined;
}
const compiledProvider = findCompiledProvider(out);
if (!compiledProvider) throw new Error(`TypeScript completed without emitting MediaSFUProvider.js under ${out}`);
const { MediaSFUProvider } = require(compiledProvider);
function render(props) { cursor = 0; return MediaSFUProvider(props); }
function find(node, type) { if (!node || typeof node !== 'object') return null; if (node.type === type) return node; const kids = node.props && node.props.children; return Array.isArray(kids) ? kids.map(x => find(x, type)).find(Boolean) : find(kids, type); }
function raw(level = '0', extra = {}) { const primary = { connected: true, emit() {} }; return { roomName: 'room', member: 'Ada', islevel: level, validated: true, socket: primary, getUpdatedAllParams() { return this; }, audioSetting: 'allow', videoSetting: 'allow', screenshareSetting: 'allow', chatSetting: 'allow', ...extra }; }
function context(tree) { return tree.props.value; }
function mount(props) { const first = render(props); const generic = find(first, 'ModernMediasfuGeneric'); if (generic) generic.props.updateSourceParameters(raw(props.role === 'host' ? '2' : props.role === 'cohost' ? '1' : '0')); return { tree: render(props), generic }; }
test.after(() => { Module._load = original; fs.rmSync(out, { recursive: true, force: true }); });
test('validates operation roles and meeting IDs without mounting SDK', () => { hooks.length = 0; assert.equal(find(render({ operation: 'create', role: 'participant', userName: 'Ada' }), 'ModernMediasfuGeneric'), undefined); hooks.length = 0; assert.equal(find(render({ operation: 'join', role: 'host', userName: 'Ada', meetingId: 'm' }), 'ModernMediasfuGeneric'), undefined); hooks.length = 0; assert.equal(find(render({ operation: 'join', role: 'participant', userName: 'Ada' }), 'ModernMediasfuGeneric'), undefined); });
test('participant leave retries and host end uses SDK confirmExit by default', async () => { hooks.length = 0; sdk.exits.length = 0; sdk.rejectNext = true; let m = mount({ operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' }); let a = context(m.tree).actions; assert.equal((await a.leave()).ok, false); assert.equal((await a.leave()).effect, 'exit-requested'); assert.equal(sdk.exits.length, 2); hooks.length = 0; m = mount({ operation: 'create', role: 'host', userName: 'Host' }); a = context(m.tree).actions; assert.equal((await a.leave()).ok, false); const localEnd = await a.endRoom(); assert.equal(localEnd.effect, 'exit-requested'); assert.equal(sdk.exits.length, 3); const adapter = { endRoom: async () => ({ ok: true, alreadyApplied: true }) }; hooks.length = 0; m = mount({ operation: 'create', role: 'host', userName: 'Host', endRoomAdapter: adapter }); a = context(m.tree).actions; const ended = await a.endRoom(); assert.equal(ended.effect, 'server-confirmed'); assert.equal(ended.alreadyApplied, true); });
test('uses fresh parameters, rejects invalid device kind, and prefers local chat socket', async () => { hooks.length = 0; sdk.messages.length = 0; const m = mount({ operation: 'join', role: 'cohost', userName: 'Ada', meetingId: 'm' }); const generic = find(m.tree, 'ModernMediasfuGeneric'); const local = { connected: true, emit() {} }; const next = raw('1', { localSocket: local }); generic.props.updateSourceParameters(next); const a = context(render({ operation: 'join', role: 'cohost', userName: 'Ada', meetingId: 'm' })).actions; assert.equal((await a.selectDevice('speaker', 'x')).ok, false); assert.equal((await a.sendMessage('hi')).ok, true); assert.equal(sdk.messages[0].socket, local); });
test('identity remount and public context do not leak raw parameters or credentials', () => { hooks.length = 0; const p1 = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'one', credentials: { apiUserName: 'u', apiKey: 'secret' } }; const t1 = mount(p1).tree; const g1 = find(t1, 'ModernMediasfuGeneric'); const p2 = { ...p1, meetingId: 'two' }; const t2 = render(p2); const g2 = find(t2, 'ModernMediasfuGeneric'); g1.props.updateSourceParameters(raw()); assert.notEqual(g1.key, g2.key); assert.equal(JSON.stringify(context(t2)).includes('secret'), false); assert.equal(JSON.stringify(context(t2)).includes('socket'), false); });

test('capture reconciles ready action states and revokes a successful media action when permission changes', async () => {
  hooks.length = 0;
  const props = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' };
  const mounted = mount(props);
  const ready = context(mounted.tree);
  assert.equal(ready.actionStates.microphone.status, 'idle');
  assert.equal(ready.actionStates.leave.status, 'idle');
  assert.equal(ready.actionStates.endRoom.status, 'disabled');
  assert.equal((await ready.actions.toggleMicrophone()).ok, true);
  assert.equal(context(render(props)).actionStates.microphone.status, 'success');
  mounted.generic.props.updateSourceParameters(raw('0', { audioSetting: 'disallow' }));
  const denied = context(render(props));
  assert.equal(denied.actionStates.microphone.status, 'disabled');
  assert.match(denied.actionStates.microphone.disabledReason || '', /not enabled/);
});

test('a disconnected validated socket enters reconnecting, revokes actions, and recovers to ready', () => {
  hooks.length = 0;
  const props = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' };
  const mounted = mount(props);
  assert.equal(context(mounted.tree).session.status, 'ready');
  mounted.generic.props.updateSourceParameters(raw('0', { socket: { connected: false, emit() {} } }));
  const reconnecting = context(render(props));
  assert.equal(reconnecting.session.status, 'reconnecting');
  assert.equal(reconnecting.actionStates.microphone.status, 'disabled');
  assert.equal(reconnecting.actionStates.screen.status, 'disabled');
  assert.equal(reconnecting.actionStates.message.status, 'disabled');
  assert.equal(reconnecting.actionStates.leave.status, 'disabled');
  assert.match(reconnecting.actionStates.message.disabledReason || '', /reconnection/);
  mounted.generic.props.updateSourceParameters(raw('0'));
  const recovered = context(render(props));
  assert.equal(recovered.session.status, 'ready');
  assert.equal(recovered.actionStates.microphone.status, 'idle');
  assert.equal(recovered.actionStates.message.status, 'idle');
  assert.equal(recovered.actionStates.leave.status, 'idle');
});

test('capture cannot revert local leave or server-confirmed end outcomes', async () => {
  hooks.length = 0;
  const participant = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' };
  const left = mount(participant);
  assert.equal((await context(left.tree).actions.leave()).effect, 'exit-requested');
  left.generic.props.updateSourceParameters(raw('0'));
  assert.equal(context(render(participant)).session.status, 'leaving');

  hooks.length = 0;
  const host = { operation: 'join', role: 'participant', userName: 'Host', meetingId: 'm', endRoomAdapter: { endRoom: async () => ({ ok: true }) } };
  const ended = mount(host);
  ended.generic.props.updateSourceParameters(raw(2));
  const hostContext = context(render(host));
  assert.match((await hostContext.actions.leave()).error || '', /Hosts cannot leave/);
  assert.equal((await hostContext.actions.endRoom()).effect, 'server-confirmed');
  ended.generic.props.updateSourceParameters(raw(2));
  assert.equal(context(render(host)).session.status, 'left');
});

test('numeric host role enables only host end-room semantics', async () => {
  hooks.length = 0;
  const props = { operation: 'join', role: 'participant', userName: 'Host', meetingId: 'm', endRoomAdapter: { endRoom: async () => ({ ok: true, alreadyApplied: true }) } };
  const mounted = mount(props);
  mounted.generic.props.updateSourceParameters(raw(2));
  const value = context(render(props));
  assert.equal(value.session.role, 'host');
  assert.equal(value.actionStates.leave.status, 'disabled');
  assert.equal(value.actionStates.endRoom.status, 'idle');
  assert.equal((await value.actions.endRoom()).effect, 'server-confirmed');
});

test('actions and context retain references across no-op renders and equivalent captures', () => {
  hooks.length = 0;
  const props = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' };
  const mounted = mount(props);
  const first = context(mounted.tree);
  const second = context(render(props));
  assert.strictEqual(second, first);
  assert.strictEqual(second.actions, first.actions);
  assert.strictEqual(second.actions.toggleMicrophone, first.actions.toggleMicrophone);
  mounted.generic.props.updateSourceParameters(raw('0'));
  const third = context(render(props));
  assert.strictEqual(third, second);
  assert.strictEqual(third.actions, second.actions);
});
