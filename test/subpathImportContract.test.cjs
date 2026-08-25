const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const entries = {
  'call-button': 'MediaSFUCallButton',
  'meeting-join': 'MediaSFUMeetingJoin',
  'ai-agent': 'MediaSFUAIAgent',
  'web-agent': 'MediaSFUWebAgent',
  calls: 'MediaSFUCalls',
  'agent-dashboard': 'MediaSFUAgentDashboard',
  react: 'ConnectionBlock',
  headless: 'MediaSFUProvider',
};

const vanillaEntries = Object.keys(entries).filter(
  (entry) => entry !== 'react' && entry !== 'headless',
);

test('root CommonJS and ESM package entries import during SSR', async () => {
  const commonjs = require('@mediasfu/widgets');
  const esm = await import('@mediasfu/widgets');
  assert.ok(commonjs.MediaSFUProvider);
  assert.ok(commonjs.MediaSFUCallButton);
  assert.ok(esm.MediaSFUProvider);
  assert.ok(esm.MediaSFUCallButton);
});

for (const [entry, expectedExport] of Object.entries(entries)) {
  test(`${entry} CommonJS subpath imports during SSR`, () => {
    const imported = require(`@mediasfu/widgets/${entry}`);
    assert.ok(imported[expectedExport], `missing ${expectedExport}`);
  });

  test(`${entry} ESM subpath imports during SSR`, async () => {
    const imported = await import(`@mediasfu/widgets/${entry}`);
    assert.ok(imported[expectedExport], `missing ${expectedExport}`);
  });
}

test('vanilla subpaths contain no React or MediaSFU React SDK runtime', () => {
  for (const entry of vanillaEntries) {
    for (const extension of ['cjs', 'mjs']) {
      const source = readFileSync(
        path.join(__dirname, '..', 'dist', 'subpaths', `${entry}.${extension}`),
        'utf8',
      );
      assert.doesNotMatch(source, /mediasfu-reactjs|react\/jsx-runtime|require\(["']react["']\)/i);
    }
  }
});
