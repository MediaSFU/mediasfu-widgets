const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const root = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-provider-'));
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json'), '--module', 'commonjs', '--jsx', 'react-jsx', '--noEmit', 'false', '--outDir', out, '--declarationDir', path.join(out, 'types')]);
const hooks = []; let cursor = 0;
const ReactMock = { createContext: () => ({ Provider: 'Provider' }), useRef: v => { const i = cursor++; return hooks[i] || (hooks[i] = { current: v }); }, useState: v => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof v === 'function' ? v() : v; return [hooks[i], x => { hooks[i] = typeof x === 'function' ? x(hooks[i]) : x; }]; }, useEffect: () => { cursor++; }, useCallback: f => { cursor++; return f; }, useMemo: f => { cursor++; return f(); } };
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
test('fails closed for malformed runtime create and join inputs before mounting SDK', () => {
  const invalid = [
    { operation: 'join', role: 'participant', userName: '   ', meetingId: 'm' },
    { operation: 'create', role: 'host', userName: 'Host', duration: 0 },
    { operation: 'create', role: 'host', userName: 'Host', capacity: 1.5 },
    { operation: 'create', role: 'host', userName: 'Host', eventType: 'invalid' },
    { operation: 'resume', role: 'participant', userName: 'Ada', meetingId: 'm' },
    { operation: 'join', role: 'operator', userName: 'Ada', meetingId: 'm' },
  ];
  for (const props of invalid) {
    hooks.length = 0;
    const tree = render(props);
    assert.equal(find(tree, 'ModernMediasfuGeneric'), undefined);
    assert.equal(context(tree).session.status, 'error');
    assert.equal(context(tree).actionStates.microphone.status, 'disabled');
  }
});
test('uses a trimmed valid name for the SDK pre-join options', () => {
  hooks.length = 0;
  const tree = render({ operation: 'join', role: 'participant', userName: ' Ada ', meetingId: 'm' });
  assert.equal(find(tree, 'ModernMediasfuGeneric').props.noUIPreJoinOptions.userName, 'Ada');
});
test('participant leave retries and host end uses SDK confirmExit by default', async () => { hooks.length = 0; sdk.exits.length = 0; sdk.rejectNext = true; let m = mount({ operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'm' }); let a = context(m.tree).actions; assert.equal((await a.leave()).ok, false); assert.equal((await a.leave()).effect, 'exit-requested'); assert.equal(sdk.exits.length, 2); hooks.length = 0; m = mount({ operation: 'create', role: 'host', userName: 'Host' }); a = context(m.tree).actions; assert.equal((await a.leave()).ok, false); const localEnd = await a.endRoom(); assert.equal(localEnd.effect, 'exit-requested'); assert.equal(sdk.exits.length, 3); const adapter = { endRoom: async () => ({ ok: true, alreadyApplied: true }) }; hooks.length = 0; m = mount({ operation: 'create', role: 'host', userName: 'Host', endRoomAdapter: adapter }); a = context(m.tree).actions; const ended = await a.endRoom(); assert.equal(ended.effect, 'server-confirmed'); assert.equal(ended.alreadyApplied, true); });
test('uses fresh parameters, rejects invalid device kind, and prefers local chat socket', async () => { hooks.length = 0; sdk.messages.length = 0; const m = mount({ operation: 'join', role: 'cohost', userName: 'Ada', meetingId: 'm' }); const generic = find(m.tree, 'ModernMediasfuGeneric'); const local = { connected: true, emit() {} }; const next = raw('1', { localSocket: local }); generic.props.updateSourceParameters(next); const a = context(render({ operation: 'join', role: 'cohost', userName: 'Ada', meetingId: 'm' })).actions; assert.equal((await a.selectDevice('speaker', 'x')).ok, false); assert.equal((await a.sendMessage('hi')).ok, true); assert.equal(sdk.messages[0].socket, local); });
test('identity remount and public context do not leak raw parameters or credentials', () => { hooks.length = 0; const p1 = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'one', credentials: { apiUserName: 'u', apiKey: 'secret' } }; const t1 = mount(p1).tree; const g1 = find(t1, 'ModernMediasfuGeneric'); const p2 = { ...p1, meetingId: 'two' }; const t2 = render(p2); const g2 = find(t2, 'ModernMediasfuGeneric'); g1.props.updateSourceParameters(raw()); assert.notEqual(g1.key, g2.key); assert.equal(JSON.stringify(context(t2)).includes('secret'), false); assert.equal(JSON.stringify(context(t2)).includes('socket'), false); });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const staleSession = { ok: false, error: 'This action belongs to a stale session.' };

test('keeps B leave pending when stale A settles after identity, credential, and adapter rotation', async () => {
  hooks.length = 0;
  sdk.exits.length = 0;
  const originalConfirmExit = sdk.confirmExit;
  const aExit = deferred();
  const bExit = deferred();
  sdk.confirmExit = p => { sdk.exits.push(p); return sdk.exits.length === 1 ? aExit.promise : bExit.promise; };
  try {
    const adapterA = { endRoom: async () => ({ ok: true }) };
    const adapterB = { endRoom: async () => ({ ok: true }) };
    const propsA = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'room-a', credentials: { apiUserName: 'same-user', apiKey: 'secret-a' }, endRoomAdapter: adapterA };
    const actionsA = context(mount(propsA).tree).actions;
    const requestA = actionsA.leave();
    assert.equal(sdk.exits.length, 1);

    const propsB = { ...propsA, meetingId: 'room-b', credentials: { apiUserName: 'same-user', apiKey: 'secret-b' }, endRoomAdapter: adapterB };
    const actionsB = context(mount(propsB).tree).actions;
    const requestB = actionsB.leave();
    assert.equal(sdk.exits.length, 2);

    aExit.resolve();
    assert.deepEqual(await requestA, staleSession);
    const duplicateB = actionsB.leave();
    assert.equal(sdk.exits.length, 2, 'stale A cleanup must not clear B exitRef');
    const current = context(render(propsB));
    assert.equal(current.session.status, 'ready');
    assert.equal(current.actionStates.leave.status, 'pending');

    bExit.resolve();
    assert.equal((await requestB).effect, 'exit-requested');
    assert.equal((await duplicateB).effect, 'exit-requested');
  } finally {
    sdk.confirmExit = originalConfirmExit;
  }
});

test('keeps B endRoom pending when stale A adapter completion settles', async () => {
  hooks.length = 0;
  const aExit = deferred();
  const bExit = deferred();
  let aCalls = 0;
  let bCalls = 0;
  const adapterA = { endRoom: () => { aCalls += 1; return aExit.promise; } };
  const adapterB = { endRoom: () => { bCalls += 1; return bExit.promise; } };
  const propsA = { operation: 'create', role: 'host', userName: 'Host', credentials: { apiUserName: 'same-user', apiKey: 'secret-a' }, endRoomAdapter: adapterA };
  const actionsA = context(mount(propsA).tree).actions;
  const requestA = actionsA.endRoom();
  assert.equal(aCalls, 1);

  const propsB = { ...propsA, credentials: { apiUserName: 'same-user', apiKey: 'secret-b' }, endRoomAdapter: adapterB };
  const actionsB = context(mount(propsB).tree).actions;
  const requestB = actionsB.endRoom();
  assert.equal(bCalls, 1);

  aExit.resolve({ ok: true, alreadyApplied: false });
  assert.deepEqual(await requestA, staleSession);
  const duplicateB = actionsB.endRoom();
  assert.equal(bCalls, 1, 'stale A finally must not clear B exitRef');
  const current = context(render(propsB));
  assert.equal(current.session.status, 'ready');
  assert.equal(current.actionStates.endRoom.status, 'pending');

  bExit.resolve({ ok: true, alreadyApplied: true });
  assert.equal((await requestB).effect, 'server-confirmed');
  assert.equal((await duplicateB).effect, 'server-confirmed');
});

test('does not invoke a revoked or replaced adapter through a stale action closure', async () => {
  hooks.length = 0;
  let oldCalls = 0;
  let replacementCalls = 0;
  const oldAdapter = { endRoom: async () => { oldCalls += 1; return { ok: true }; } };
  const replacementAdapter = { endRoom: async () => { replacementCalls += 1; return { ok: true }; } };
  const base = { operation: 'create', role: 'host', userName: 'Host' };
  const oldActions = context(mount({ ...base, endRoomAdapter: oldAdapter }).tree).actions;
  const revoked = { ...base, endRoomAdapter: undefined };
  const revokedActions = context(render(revoked)).actions;
  assert.deepEqual(await oldActions.endRoom(), staleSession);
  assert.equal(oldCalls, 0);
  assert.equal((await revokedActions.endRoom()).ok, false);
  assert.equal(oldCalls, 0);

  const replacementActions = context(mount({ ...base, endRoomAdapter: replacementAdapter }).tree).actions;
  assert.equal((await replacementActions.endRoom()).effect, 'server-confirmed');
  assert.equal(oldCalls, 0);
  assert.equal(replacementCalls, 1);
});

test('rotates the SDK key for a new API key without exposing the secret publicly', () => {
  hooks.length = 0;
  const first = { operation: 'join', role: 'participant', userName: 'Ada', meetingId: 'room', credentials: { apiUserName: 'same-user', apiKey: 'private-key-a' } };
  const treeA = mount(first).tree;
  const genericA = find(treeA, 'ModernMediasfuGeneric');
  const second = { ...first, credentials: { apiUserName: 'same-user', apiKey: 'private-key-b' } };
  const treeB = render(second);
  const genericB = find(treeB, 'ModernMediasfuGeneric');
  assert.notEqual(genericA.key, genericB.key);
  assert.equal(String(genericA.key).includes('private-key-a'), false);
  assert.equal(String(genericB.key).includes('private-key-b'), false);
  assert.equal(JSON.stringify(context(treeA)).includes('private-key-a'), false);
  assert.equal(JSON.stringify(context(treeB)).includes('private-key-b'), false);
});
