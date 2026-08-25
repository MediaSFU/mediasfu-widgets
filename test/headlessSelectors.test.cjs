/* Verifies the public semantic selector hooks never expose raw SDK state. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-headless-selectors-'));
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json'), '--module', 'commonjs', '--jsx', 'react-jsx', '--noEmit', 'false', '--outDir', out, '--declarationDir', path.join(out, 'types')], { stdio: 'pipe' });

const actions = Object.freeze({ leave: async () => ({ ok: true, effect: 'exit-requested' }) });
const value = Object.freeze({
  session: Object.freeze({ status: 'ready', role: 'participant', roomId: 'room-1' }),
  media: Object.freeze({ microphone: Object.freeze({ active: false, available: true }), camera: Object.freeze({ active: false, available: true }), screen: Object.freeze({ active: false, available: true }) }),
  participants: Object.freeze([]), messages: Object.freeze([]),
  permissions: Object.freeze({ canUseMicrophone: true, canUseCamera: true, canShareScreen: true, canSendMessage: true }),
  actionStates: Object.freeze({ leave: Object.freeze({ status: 'idle' }), endRoom: Object.freeze({ status: 'disabled' }), microphone: Object.freeze({ status: 'idle' }), camera: Object.freeze({ status: 'idle' }), screen: Object.freeze({ status: 'idle' }), device: Object.freeze({ status: 'idle' }), message: Object.freeze({ status: 'idle' }) }),
  actions,
});
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return { useContext: () => value, useMemo: factory => factory() };
  if (request === './MediaSFUProvider') return { MediaSFUContext: {} };
  return originalLoad.call(this, request, parent, isMain);
};
function findCompiledSelectors(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findCompiledSelectors(candidate);
      if (found) return found;
    } else if (entry.name === 'useMediaSFU.js') {
      return candidate;
    }
  }
  return undefined;
}
const compiledSelectors = findCompiledSelectors(out);
if (!compiledSelectors) throw new Error(`TypeScript completed without emitting useMediaSFU.js under ${out}`);
const selectors = require(compiledSelectors);
test.after(() => { Module._load = originalLoad; fs.rmSync(out, { recursive: true, force: true }); });

test('semantic state and actions selectors are separate and confidential', () => {
  const state = selectors.useMediaSFUState();
  assert.equal(Object.isFrozen(state), true);
  assert.equal(state.session.roomId, 'room-1');
  assert.equal('actions' in state, false);
  assert.equal(JSON.stringify(state).includes('socket'), false);
  assert.strictEqual(selectors.useMediaSFUActions(), actions);
});
