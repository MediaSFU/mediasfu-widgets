'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'components', 'meeting-join', 'MeetingJoin.ts'), 'utf8');
const start = source.indexOf('private async joinMeeting(): Promise<void> {');
const end = source.indexOf('\n  private navigateToMeeting(', start);
assert.ok(start >= 0 && end > start, 'joinMeeting boundary must remain stable');
const method = source.slice(start, end);

test('meeting join rejects re-entry before every room-creation side effect', () => {
  const guard = method.indexOf('if (this.state === \'joining\') {');
  const stop = method.indexOf('return;', guard);
  const joining = method.indexOf('this.setState(\'joining\');');
  assert.ok(guard >= 0 && stop > guard && joining > stop);
  const sideEffects = [
    'window.open(\'about:blank\'',
    'await authenticate(',
    'dispatchWidgetEvent(this, \'meeting-join\'',
    'const roomRes = await fetch(`${apiUrl}/v1/rooms/`',
  ];
  for (const sideEffect of sideEffects) {
    assert.ok(method.indexOf(sideEffect) > joining, sideEffect + ' must follow the guard');
  }
});

test('create and join room requests carry retry-stable idempotency keys', () => {
  assert.match(method, /const payloadBody = JSON\.stringify\(payload\)/);
  assert.match(method, /const idempotencyKey = this\.getRoomRequestIdempotencyKey\(payloadBody\)/);
  assert.match(method, /'Idempotency-Key': idempotencyKey/);
  assert.match(method, /this\.clearRoomRequestIdempotencyKey\(payloadBody\)/);
  assert.match(source, /this\.roomRequestIdempotency\?\.fingerprint === fingerprint/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID/);
});
