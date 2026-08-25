const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const frontendRoot = process.env.MEDIASFU_FRONTEND_ROOT
  ? path.resolve(process.env.MEDIASFU_FRONTEND_ROOT)
  : path.resolve(root, '..');
const studioOperatorSurfacePath = path.join(
  frontendRoot,
  'src',
  'components',
  'Navigation',
  'MainNavigation',
  'AIAgentsStudio',
  'StudioOperatorSurfaces.js',
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function propertySetter(source) {
  const start = source.indexOf('public set studioOperatorGrant(value: string)');
  const end = source.indexOf('// ─── Rendering', start);
  assert.notEqual(start, -1, 'studioOperatorGrant setter should exist');
  assert.notEqual(end, -1, 'setter boundary should exist');
  return source.slice(start, end);
}

for (const relativePath of [
  'src/components/agent-dashboard/AgentDashboard.ts',
  'src/components/calls-widget/CallsWidget.ts',
]) {
  test(`${relativePath} keeps property grants out of DOM attributes and clears runtime memory`, () => {
    const source = read(relativePath);
    const setter = propertySetter(source);
    assert.match(setter, /this\.operatorGrantValue = nextValue/);
    assert.doesNotMatch(setter, /setAttribute\(['"](?:studio-)?operator-grant/);
    assert.doesNotMatch(setter, /removeAttribute\(['"](?:studio-)?operator-grant/);
    assert.match(source, /private cleanup\(\): void \{\s*this\.operatorGrantValue = '';/);
    assert.match(source, /return this\.operatorGrantValue\.trim\(\)/);
    assert.doesNotMatch(source, /getAttribute\(['"](?:studio-)?operator-grant/);
    assert.doesNotMatch(source, /['"](?:studio-)?operator-grant['"]/);
  });
}

test('Studio embeds assign the grant property without grant attributes', {
  skip: fs.existsSync(studioOperatorSurfacePath)
    ? false
    : 'Set MEDIASFU_FRONTEND_ROOT to run the optional Studio integration check.',
}, () => {
  const source = fs.readFileSync(studioOperatorSurfacePath, 'utf8');
  assert.match(source, /element\.studioOperatorGrant = operatorGrant/);
  assert.doesNotMatch(source, /setAttribute\(['"](?:studio-)?operator-grant/);
});

test('public widget environments expose production defaults only', () => {
  const source = read('src/core/environments.ts');
  assert.match(source, /export type Environment = 'production'/);
  assert.match(source, /callsUrl: 'https:\/\/mediasfu\.com\/widget-calls'/);
});


test('CallButton forwards authenticated Studio context and bounds explicit overrides', () => {
  const source = read('src/components/call-button/CallButton.ts');
  assert.match(source, /getSessionConfig\(this\.widgetKey\)/);
  assert.match(source, /parsed\?\.studioContext/);
  assert.match(source, /_resolvedStudioSessionId/);
  assert.match(source, /_resolvedResourceReferenceId/);
  assert.match(source, /studioSessionId: this\.studioSessionId/);
  assert.match(source, /resourceReferenceId: this\.resourceReferenceId/);
  assert.match(source, /slice\(0, 120\)/);
  assert.match(source, /slice\(0, 160\)/);
});

test('Agent Dashboard recreates its iframe on grant rotation', () => {
  const source = read('src/components/agent-dashboard/AgentDashboard.ts');
  const setter = propertySetter(source);
  assert.match(setter, /this\.iframe\?\.remove\(\)/);
  assert.match(setter, /void this\.validateConfig\(\)/);
});

test('Agent Dashboard preserves its live iframe during presentation updates', () => {
  const source = read('src/components/agent-dashboard/AgentDashboard.ts');
  const start = source.indexOf('attributeChangedCallback(');
  const end = source.indexOf('// â”€â”€â”€ Attribute Getters', start);
  const callback = source.slice(start, end);
  assert.ok(callback.includes("['width', 'height', 'theme', 'custom-css-class'].includes(name)"));
  assert.ok(callback.includes('this.updatePresentation()'));
  assert.ok(source.includes('private getLiveIframe(): HTMLIFrameElement | null'));
  assert.ok(source.includes('const iframe = this.getLiveIframe();'));
});

test('web-agent iframe URLs never escape through public events or referrers', () => {
  const source = read('src/components/web-agent/WebAgent.ts');
  assert.match(source, /dispatchWidgetEvent\(this, 'agent-loaded', \{ mode: this\.mode \}\)/);
  assert.doesNotMatch(source, /dispatchWidgetEvent\(this, 'agent-loaded', \{ url/);
  assert.match(source, /referrerpolicy="no-referrer"/);
});

test('operator-dashboard iframe URLs never escape through public events or referrers', () => {
  const source = read('src/components/agent-dashboard/AgentDashboard.ts');
  assert.match(source, /dispatchWidgetEvent\(this, 'dashboard-loaded', \{ widgetType: 'web-agent-dashboard' \}\)/);
  assert.doesNotMatch(source, /dispatchWidgetEvent\(this, 'dashboard-loaded', \{ url/);
  assert.match(source, /referrerpolicy="no-referrer"/);
});

test('web-agent and dashboard sessions use exact-origin parent handoff instead of iframe query tokens', () => {
  const webAgent = read('src/components/web-agent/WebAgent.ts');
  const dashboard = read('src/components/agent-dashboard/AgentDashboard.ts');
  for (const source of [webAgent, dashboard]) {
    assert.match(source, /params\.append\('parentSession', '1'\)/);
    assert.doesNotMatch(source, /params\.append\('(token|sessionToken)', this\.sessionToken\)/);
    assert.match(source, /mediasfu:widgetSessionGrantRequest/);
    assert.match(source, /mediasfu:widgetSessionGrant/);
  }
});
