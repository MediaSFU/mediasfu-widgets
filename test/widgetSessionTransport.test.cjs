'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

for (const relativePath of [
  'src/components/ai-agent/AIAgent.ts',
  'src/components/calls-widget/CallsWidget.ts',
]) {
  test(`${relativePath} grants sessions after load without URL or event leakage`, () => {
    const source = read(relativePath);
    assert.match(source, /params\.append\('parentSession', '1'\)/);
    assert.match(source, /params\.append\('parentOrigin', parentOrigin\)/);
    assert.doesNotMatch(source, /params\.append\('sessionToken', this\.sessionToken\)/);
    assert.match(source, /mediasfu:widgetSessionGrantRequest/);
    assert.match(source, /mediasfu:widgetSessionGrant/);
    assert.match(source, /event\.source !== (?:iframeWindow|this\.iframe\.contentWindow)/);
    assert.match(source, /event\.origin (?:!== iframeOrigin|=== expectedOrigin)/);
    assert.match(source, /referrerpolicy="no-referrer"/);
    assert.doesNotMatch(source, /dispatchWidgetEvent\(this, '(?:agent|calls)-loaded', \{ url/);
  });
}

for (const relativePath of [
  'widget-agent/src/App.tsx',
  'widget-calls/src/App.tsx',
]) {
  test(`${relativePath} accepts grants only from its exact parent window and origin`, () => {
    const source = read(relativePath);
    assert.match(source, /get\('parentSession'\) === '1'/);
    assert.match(source, /event\.source !== window\.parent \|\| event\.origin !== parentOrigin/);
    assert.match(source, /event\.data\?\.type !== ['"]mediasfu:widgetSessionGrant['"]/);
    assert.match(source, /postToParent\(['"]widgetSessionGrantRequest['"]\)/);
    assert.match(source, /effectiveSessionToken/);
    assert.doesNotMatch(source, /let targetOrigin = ["']\*["']/);
  });
}

test('the hosted room app imports only the public generic component', () => {
  const source = read('widget-room/src/App.tsx');
  assert.match(source, /ModernMediasfuGeneric/);
  assert.doesNotMatch(source, /ModernMediasfuGenericLimited/);
});

test('the agent dashboard fails closed when an iframe origin cannot be resolved', () => {
  const source = read('src/components/agent-dashboard/AgentDashboard.ts');
  assert.match(source, /function resolveIframeTargetOrigin\(iframeSrc: string\): string \| null/);
  assert.doesNotMatch(source, /return ['"]\*['"]/);
  assert.doesNotMatch(source, /let targetOrigin = ['"]\*['"]/);
});
