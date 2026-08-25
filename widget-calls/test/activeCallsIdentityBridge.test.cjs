const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const callsPage = fs.readFileSync(path.join(root, 'src/components/Calls/CallsPage.tsx'), 'utf8');
const activeCallsPublication = fs.readFileSync(path.join(root, 'src/services/activeCallsPublication.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const customElement = fs.readFileSync(path.join(root, '../src/components/calls-widget/CallsWidget.ts'), 'utf8');

test('active call identity bridge is scoped and sanitized', () => {
  assert.match(callsPage, /onActiveCallsChanged\?:/);
  assert.match(callsPage, /createActiveCallsPublisher/);
  assert.match(callsPage, /publishActiveCalls\(uniqueActiveCalls\)/);
  assert.match(callsPage, /publishActiveCalls\(allDisplayCalls\)/);
  assert.match(activeCallsPublication, /getActiveCallIdentity\(value\)/);
  assert.match(activeCallsPublication, /getActiveCallIdentityKey/);
  assert.match(activeCallsPublication, /lastKey/);
  const bridgeStart = callsPage.lastIndexOf('useEffect(() => {', callsPage.indexOf('if (!isApiConfigured)'));
  const bridge = callsPage.slice(bridgeStart, callsPage.indexOf('if (!isApiConfigured)', bridgeStart));
  assert.doesNotMatch(bridge, /customerName|phoneNumber|credentials/);
});

test('iframe app posts the scoped active-call message', () => {
  assert.match(app, /postToParent\(\"activeCallsChanged\", \{ calls \}\)/);
  assert.match(app, /onActiveCallsChanged=\{reportActiveCalls\}/);
});

test('custom element forwards only trusted iframe messages', () => {
  assert.match(customElement, /if \(!this\.isTrustedIframeMessage\(event\)\) return/);
  assert.match(customElement, /case 'mediasfu:activeCallsChanged'/);
  assert.match(customElement, /dispatchWidgetEvent\(this, 'active-calls-changed', payload\)/);
});
