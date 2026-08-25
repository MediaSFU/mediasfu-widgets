'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const frontendRoot = process.env.MEDIASFU_FRONTEND_ROOT
  ? path.resolve(process.env.MEDIASFU_FRONTEND_ROOT)
  : path.resolve(packageRoot, '..');
const frontendContractPath = 'src/components/Navigation/MainNavigation/Dashboard/widgets/widgetPreviewContract.js';
const hasFrontendSource = fs.existsSync(path.join(frontendRoot, frontendContractPath));
const readPackage = (relativePath) => fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
const readFrontend = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const loader = readPackage('src/core/widget-loader.ts');
const widgets = Object.freeze([
  {
    id: 'click-to-call',
    tag: 'mediasfu-call-button',
    root: 'mediasfu-call-button',
    states: ['idle', 'authenticating', 'ringing', 'connected', 'ended', 'error'],
    runtime: 'src/components/call-button/CallButton.ts',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/ClickToCallNative.js',
  },
  {
    id: 'calls',
    tag: 'mediasfu-calls',
    root: 'mediasfu-calls',
    states: ['loading', 'ready', 'error'],
    runtime: 'src/components/calls-widget/CallsWidget.ts',
    innerRuntime: 'widget-calls/src/components/Calls/CallsPagePreview.tsx',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/CallsDashboardNative.js',
  },
  {
    id: 'meeting-join',
    tag: 'mediasfu-meeting-join',
    root: 'mediasfu-meeting-join',
    states: ['form', 'preview', 'joining', 'error', 'ready'],
    runtime: 'src/components/meeting-join/MeetingJoin.ts',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/MeetingJoinNative.js',
  },
  {
    id: 'ai-agent',
    tag: 'mediasfu-ai-agent',
    root: 'mediasfu-ai-agent',
    states: ['loading', 'ready', 'error'],
    runtime: 'src/components/ai-agent/AIAgent.ts',
    innerRuntime: 'widget-agent/src/components/AgentUnified.tsx',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/AgentUnifiedNative.js',
  },
  {
    id: 'web-agent-embed',
    tag: 'mediasfu-web-agent',
    root: 'mediasfu-web-agent',
    states: ['loading', 'ready', 'error'],
    runtime: 'src/components/web-agent/WebAgent.ts',
    innerRuntime: 'widget-agent/src/components/AgentUnified.tsx',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/AgentUnifiedNative.js',
  },
  {
    id: 'web-agent-dashboard',
    tag: 'mediasfu-agent-dashboard',
    root: 'mediasfu-agent-dashboard',
    states: ['loading', 'ready', 'error'],
    runtime: 'src/components/agent-dashboard/AgentDashboard.ts',
    preview: 'src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/NativeComponentRenders/AgentsDashboardNative.js',
  },
]);

test('the loader exposes the exact six public widget identifiers', () => {
  assert.deepEqual(widgets.map(({ id }) => id), [
    'click-to-call',
    'calls',
    'meeting-join',
    'ai-agent',
    'web-agent-embed',
    'web-agent-dashboard',
  ]);
  for (const { id, tag } of widgets) {
    assert.match(loader, new RegExp(`['\"]${id}['\"]\\s*:\\s*['\"]${tag}['\"]`));
  }
});

test('every shipped runtime exposes its shell root and declared states', () => {
  for (const widget of widgets) {
    const runtime = readPackage(widget.runtime);
    assert.ok(runtime.includes(widget.root), `${widget.id} runtime root drifted`);
    assert.match(runtime, new RegExp(`customElements\\.define\\(['\"]${widget.tag}['\"]`));
    for (const state of widget.states) {
      assert.match(runtime, new RegExp(`['\"]${state}['\"]`), `${widget.id} lost runtime state ${state}`);
    }
    if (widget.innerRuntime) {
      const innerRuntime = readPackage(widget.innerRuntime);
      assert.ok(innerRuntime.length > 500, `${widget.id} inner runtime is unexpectedly absent`);
    }
  }
});

test('the frontend editor and package runtime retain cross-repository parity', {
  skip: hasFrontendSource ? false : 'Set MEDIASFU_FRONTEND_ROOT to run the optional frontend parity check.',
}, () => {
  const previewContract = readFrontend(frontendContractPath);
  const previewRenderer = readFrontend('src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/components/LivePreviewRender.js');
  const builder = readFrontend('src/components/Navigation/MainNavigation/Dashboard/WidgetBuilderEnhanced.js');
  const studio = readFrontend('src/components/Navigation/MainNavigation/Dashboard/WidgetStudio/WidgetStudio.js');

  assert.match(builder, /projectWidgetConfigToPreviewSchema/);
  assert.match(builder, /<LivePreviewRender/);
  assert.match(studio, /projectWidgetConfigToPreviewSchema/);
  assert.match(studio, /<LivePreviewRender/);
  for (const widget of widgets) {
    const preview = readFrontend(widget.preview);
    assert.match(previewContract, new RegExp(`['\"]${widget.id}['\"]`));
    assert.match(previewRenderer, new RegExp(`['\"]${widget.id}['\"]`));
    assert.ok(preview.includes(widget.root), `${widget.id} preview root drifted`);
  }
  assert.doesNotMatch(previewContract, /widget-key|api[-_ ]?key|session-token|operator-grant|redis:\/\//i);
  assert.doesNotMatch(previewRenderer, /authenticate\(|getSessionToken|operatorGrant|Authorization:/);
});
