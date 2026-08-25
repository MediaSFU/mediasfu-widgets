const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core', 'auth.ts'), 'utf8');

test('widget authentication sends the exact browser origin', () => {
  assert.match(source, /const domain = window\.location\.origin;/);
  assert.doesNotMatch(source, /const domain = window\.location\.hostname;/);
  assert.match(source, /body: JSON\.stringify\(\{[\s\S]*?domain,[\s\S]*?widgetType,/);
});
