const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'Calls', 'CallsPage.tsx'),
  'utf8',
);

test('duration runs only for answered call states', () => {
  assert.match(source, /const LIVE_DURATION_STATUSES = new Set\(\["ANSWERED", "CONNECTED", "ACTIVE", "ON-HOLD", "ON_HOLD"\]\)/);
  assert.match(source, /LIVE_DURATION_STATUSES\.has\(String\(call\.status \|\| ""\)\.trim\(\)\.toUpperCase\(\)\)/);
  assert.doesNotMatch(source, /!\["TERMINATED", "FAILED", "COMPLETED"\]\.includes\(call\.status\)/);
});

test('Studio operator rooms never autojoin or auto-unmute', () => {
  assert.equal((source.match(/autoJoin=\{!isStudioOperator\}/g) || []).length, 2);
  assert.match(source, /autoUnmute=\{!isStudioOperator && shouldAutoUnmute\}/);
  assert.doesNotMatch(source, /autoJoin=\{true\}/);
});