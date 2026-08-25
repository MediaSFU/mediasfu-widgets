'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('all public web components use the SSR-safe HTMLElement base', () => {
  const files = [
    'src/components/call-button/CallButton.ts',
    'src/components/ai-agent/AIAgent.ts',
    'src/components/meeting-join/MeetingJoin.ts',
    'src/components/calls-widget/CallsWidget.ts',
    'src/components/web-agent/WebAgent.ts',
    'src/components/agent-dashboard/AgentDashboard.ts',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /extends HTMLElementBase/);
    assert.match(source, /core\/HTMLElementBase/);
  }
});

test('production builds clean stale package output before Rollup', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const cleaner = fs.readFileSync(path.join(root, 'scripts', 'clean-dist.mjs'), 'utf8');
  assert.equal(packageJson.scripts.prebuild, 'node scripts/clean-dist.mjs');
  assert.match(cleaner, /resolve\(packageRoot, 'dist'\)/);
  assert.match(cleaner, /rm\(distDirectory, \{ recursive: true, force: true \}\)/);
});
