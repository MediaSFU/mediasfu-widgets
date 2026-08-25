const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports);
  return mod.exports;
}

test('scoped call route helpers encode IDs and use dedicated endpoints', () => {
  const routes = loadTsModule('src/services/studioOperatorRoutes.ts');
  assert.equal(routes.studioCallsCollectionPath(), '/v1/studio-operator/calls');
  assert.equal(
    routes.studioCallPath('call/one'),
    '/v1/studio-operator/calls/call%2Fone'
  );
  assert.equal(
    routes.studioCallControlPath('call one', 'startAgent'),
    '/v1/studio-operator/calls/call%20one/control/startAgent'
  );
});

test('operator grant remains exclusive even if broad credentials are supplied', async () => {
  const { WidgetHttpClient } = loadTsModule('src/services/widgetHttpClient.ts');
  const requests = [];
  global.window = { parent: { postMessage() {} } };
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    };
  };

  const client = new WidgetHttpClient('https://example.test', 'legacy-token', 'grant-token');
  client.setCredentials('broad-user', 'broad-key');
  await client.get('/v1/studio-operator/calls');

  assert.equal(client.hasOperatorGrant, true);
  assert.equal(client.hasCredentials, false);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer grant-token');
  assert.equal(requests[0].url, 'https://example.test/v1/studio-operator/calls');
});

test('legacy widget credentials remain unchanged without a grant', async () => {
  const { WidgetHttpClient } = loadTsModule('src/services/widgetHttpClient.ts');
  const requests = [];
  global.window = { parent: { postMessage() {} } };
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    };
  };

  const client = new WidgetHttpClient('https://example.test', 'legacy-token');
  client.setCredentials('legacy-user', 'legacy-key');
  await client.get('/v1/sipcall/list');

  assert.equal(client.hasOperatorGrant, false);
  assert.equal(client.hasCredentials, true);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer legacy-user:legacy-key');
  assert.equal(requests[0].url, 'https://example.test/v1/sipcall/list');
});
test('scoped call records normalize backend aliases and retain explicit live state', () => {
  const identity = loadTsModule('src/services/activeCallIdentity.ts');
  assert.deepEqual(identity.getActiveCallIdentity({ sip_call_id: 'sip-scoped-1', room_name: 'room-scoped-1', status: 'CONNECTED' }), { callId: 'sip-scoped-1', roomName: 'room-scoped-1' });
  assert.deepEqual(identity.getActiveCallIdentity({ call_id: 'sip-scoped-2', callEnded: false }), { callId: 'sip-scoped-2' });
  assert.equal(identity.getActiveCallIdentity({ sipCallId: 'sip-terminal', status: 'COMPLETED' }), null);
  assert.equal(identity.getActiveCallIdentity({ sipCallId: 'sip-unknown', status: 'UNKNOWN' }), null);
});

test('scoped call list extraction unwraps supported response envelopes', () => {
  const { extractCallRecords } = loadTsModule('src/services/activeCallIdentity.ts');
  const calls = [{ sipCallId: 'sip-scoped-3', status: 'ringing' }];
  assert.deepEqual(extractCallRecords({ data: { items: calls } }), calls);
  assert.deepEqual(extractCallRecords({ results: calls }), calls);
});