const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core', 'environments.ts'), 'utf8');

test('public runtime exposes production defaults only', () => {
  assert.match(source, /export type Environment = 'production'/);
  assert.match(source, /apiUrl: 'https:\/\/mediasfu\.com'/);
  assert.match(source, /cdnUrl: 'https:\/\/cdn\.mediasfu\.com\/v1'/);
  assert.match(source, /export function detectEnvironment\(\): Environment \{\s*return 'production';/);
});
