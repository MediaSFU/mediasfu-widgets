'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'widget-room/src/callBootstrap.ts');
const appPath = path.join(root, 'widget-room/src/App.tsx');
const source = fs.readFileSync(modulePath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');

function loadModule() {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: modulePath,
  }).outputText;
  const module = { exports: {} };
  Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    module.exports,
    require,
    module,
    modulePath,
    path.dirname(modulePath),
  );
  return module.exports;
}

const api = loadModule();
const token = `${'a'.repeat(24)}.${'b'.repeat(43)}`;
const payload = () => ({
  userName: 'caller1',
  apiUserName: 'owner',
  apiKey: 'temporary-disposable-key',
  islevel: '2',
  sec: 'room-security-proof',
  isWidgetCall: 'true',
  widgetKey: 'wk_test',
  audioOnly: 'true',
  sipCallId: 'call-test',
  callId: 'call-test',
  roomName: 'room-test',
  autoRecord: 'false',
  autoStartAgent: 'true',
});

test('captures an exact bootstrap and synchronously scrubs only the fragment', () => {
  const calls = [];
  const captured = api.captureCallBootstrap(
    { hash: `#bootstrap=${token}`, pathname: '/widget-room', search: '?isWidgetCall=true&theme=dark' },
    { state: { preserved: true }, replaceState: (...args) => calls.push(args) },
  );
  assert.equal(captured, token);
  assert.deepEqual(calls, [[{ preserved: true }, '', '/widget-room?isWidgetCall=true&theme=dark']]);

  const invalidCalls = [];
  assert.equal(api.captureCallBootstrap(
    { hash: '#bootstrap=invalid', pathname: '/widget-room', search: '?isWidgetCall=true' },
    { state: null, replaceState: (...args) => invalidCalls.push(args) },
  ), '');
  assert.equal(invalidCalls.length, 1, 'invalid proofs must also be scrubbed');
});

test('client payload validation is closed and matches the backend string contract', () => {
  assert.deepEqual(api.canonicalBootstrapPayload(payload()), payload());
  assert.equal(api.canonicalBootstrapPayload({ ...payload(), extraSecret: 'no' }), null);
  assert.equal(api.canonicalBootstrapPayload({ ...payload(), apiKey: '' }), null);
  assert.equal(api.canonicalBootstrapPayload({ ...payload(), isWidgetCall: 'false' }), null);
});

test('redemption uses only a same-origin-style POST contract and generic failures', async () => {
  const calls = [];
  const accepted = await api.redeemCallBootstrap(token, 'https://mediasfu.com', async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ success: true, payload: payload() }) };
  });
  assert.deepEqual(accepted, { valid: true, payload: payload() });
  assert.equal(calls[0][0], 'https://mediasfu.com/v1/widget/call-bootstrap/redeem');
  assert.deepEqual(calls[0][1], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootstrap: token }),
    cache: 'no-store',
    credentials: 'same-origin',
    referrerPolicy: 'no-referrer',
  });
  assert.deepEqual(await api.redeemCallBootstrap('invalid', 'https://mediasfu.com', async () => {
    throw new Error('must not fetch');
  }), { valid: false, error: 'Call access is invalid or expired.' });
});

test('App consumes the proof only from the scrubbed module value and preserves legacy support', () => {
  assert.match(appSource, /const initialCallBootstrap = captureCallBootstrap\(\)/);
  assert.match(appSource, /bootstrap: initialCallBootstrap/);
  assert.match(appSource, /redeemCallBootstrap\(callConfig\.bootstrap, window\.location\.origin\)/);
  assert.match(appSource, /bootstrap: ''/);
  assert.match(appSource, /else if \(callConfig\.sessionToken/);
  assert.match(appSource, /apiKey: params\.get\('apiKey'\) \|\| ''/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\./);
});
