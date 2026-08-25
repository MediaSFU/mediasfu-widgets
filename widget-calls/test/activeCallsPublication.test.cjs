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
  const localRequire = (request) => {
    if (request === './activeCallIdentity') {
      return loadTsModule('src/services/activeCallIdentity.ts');
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports);
  return mod.exports;
}

test('republishes when a backend-bound active call identity appears after an empty poll', () => {
  const { createActiveCallsPublisher } = loadTsModule('src/services/activeCallsPublication.ts');
  const events = [];
  const publish = createActiveCallsPublisher((calls) => events.push(calls));

  publish([]);
  publish([{ callId: 'sip-bound-1', roomName: 'room-bound-1', status: 'CONNECTED' }]);
  publish([{ callId: 'sip-bound-1', roomName: 'room-bound-1', status: 'CONNECTED' }]);

  assert.deepEqual(events, [
    [],
    [{ callId: 'sip-bound-1', roomName: 'room-bound-1' }],
  ]);
});

test('keeps scoped identities deduplicated and ignores terminal or dummy records', () => {
  const { getActiveCallIdentities } = loadTsModule('src/services/activeCallsPublication.ts');

  assert.deepEqual(
    getActiveCallIdentities([
      { callId: 'sip-bound-2', roomName: 'room-bound-2', status: 'active' },
      { sipCallId: 'sip-bound-2', roomName: 'room-bound-2', status: 'connected' },
      { callId: 'sip-ended', roomName: 'room-ended', status: 'completed' },
      { callId: 'dummy_outgoing_room-1', status: 'active' },
    ]),
    [{ callId: 'sip-bound-2', roomName: 'room-bound-2' }]
  );
});
