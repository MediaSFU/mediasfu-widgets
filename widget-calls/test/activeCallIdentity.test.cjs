const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports);
  return mod.exports;
}

const identity = loadTsModule('src/services/activeCallIdentity.ts');

test('normalizes scoped call-list response variants without inventing records', () => {
  const records = identity.extractCallRecords({
    success: true,
    data: { calls: [{ callId: 'sip-1', roomId: 'room-1', status: 'CONNECTED' }] },
  });
  assert.deepEqual(records, [{ callId: 'sip-1', roomId: 'room-1', status: 'CONNECTED' }]);
  assert.deepEqual(identity.extractCallRecords({ success: true, data: [{ sipCallId: 'sip-0', roomName: 'room-0' }] }), [{ sipCallId: 'sip-0', roomName: 'room-0' }]);
  assert.equal(identity.normalizeCallRecord({ status: 'active' }), null);
  assert.deepEqual(identity.normalizeCallRecord(records[0]), {
    callId: 'sip-1', roomId: 'room-1', status: 'CONNECTED',
    sipCallId: 'sip-1', id: 'sip-1', roomName: 'room-1',
  });
});

test('emits only real active identities and rejects dummy or terminal calls', () => {
  assert.deepEqual(
    identity.getActiveCallIdentity({ callId: 'sip-2', roomName: 'room-2', status: 'active' }),
    { callId: 'sip-2', roomName: 'room-2' }
  );
  assert.equal(identity.getActiveCallIdentity({ callId: 'dummy_outgoing_room-3', status: 'active' }), null);
  assert.equal(identity.getActiveCallIdentity({ callId: 'sip-4', roomName: 'room-4', status: 'ended' }), null);
  assert.equal(identity.getActiveCallIdentity({ callId: 'sip-5', roomName: 'room-5', status: 'unknown' }), null);
  assert.equal(identity.getActiveCallIdentity({ callId: 'sip-6', roomName: 'room-6' }), null);
  assert.deepEqual(identity.getActiveCallIdentity({ callId: 'sip-7', roomName: 'room-7', callEnded: false }), { callId: 'sip-7', roomName: 'room-7' });
  assert.deepEqual(
    identity.getActiveCallIdentity({ callId: 'sip-8', roomName: 'room-8', isActive: true }),
    { callId: 'sip-8', roomName: 'room-8' }
  );
});


test('accepts only authoritative room aliases and rejects placeholders', () => {
  assert.equal(identity.getAuthoritativeCallRoomName({ roomName: 'Unknown' }), null);
  assert.equal(identity.getAuthoritativeCallRoomName({ room: '' }), null);
  assert.equal(
    identity.getAuthoritativeCallRoomName({ data: { room_name: 'sRoom123' } }),
    'sRoom123'
  );
  assert.deepEqual(
    identity.getActiveCallIdentity({ callId: 'sip-room-1', data: { roomId: 'sRoom123' }, status: 'active' }),
    { callId: 'sip-room-1', roomName: 'sRoom123' }
  );
});
