const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const callsPath = path.join(__dirname, '..', 'src', 'components', 'Calls', 'CallsPage.tsx');
const cssPath = path.join(__dirname, '..', 'src', 'components', 'Calls', 'CallsPage.css');
const previewPath = path.join(__dirname, '..', 'src', 'components', 'Calls', 'CallsPagePreview.tsx');
const callsSource = fs.readFileSync(callsPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const previewSource = fs.readFileSync(previewPath, 'utf8');

test('call-duration control is vertically stacked and clearly labeled', () => {
  assert.match(callsSource, /<label htmlFor="roomDuration" className="duration-label">\s*Max call duration/);
  assert.match(callsSource, /title="Maximum duration for new voice rooms"/);
  assert.match(previewSource, /<span>Max call duration<\/span>/);
  assert.match(previewSource, /aria-label="Max call duration preview"/);
  assert.match(cssSource, /\.room-duration-setting\s*\{[\s\S]*flex-direction:\s*column;/);
  assert.match(cssSource, /\.duration-select\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
});
