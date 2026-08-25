/* Focused contract for the opt-in branded semantic join adapter. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mediasfu-branded-join-adapter-'));
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json'), '--module', 'commonjs', '--jsx', 'react-jsx', '--noEmit', 'false', '--outDir', out, '--declarationDir', path.join(out, 'types')], { stdio: 'pipe' });

function Headless(props) { return { type: Headless, props }; }
function Legacy(props) { return { type: Legacy, props }; }
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return {};
  if (request === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props: { ...props, key } }), jsxs: (type, props, key) => ({ type, props: { ...props, key } }) };
  if (request === './HeadlessMeetingJoinWidget') return { HeadlessMeetingJoinWidget: Headless };
  if (request === './MeetingJoinWidget') return { MeetingJoinWidget: Legacy };
  return originalLoad.call(this, request, parent, isMain);
};
const { BrandedMeetingJoinAdapter, mapBrandedMeetingJoinToSemantic } = require(path.join(out, 'widgets', 'BrandedMeetingJoinAdapter.js'));
test.after(() => { Module._load = originalLoad; fs.rmSync(out, { recursive: true, force: true }); });

function childrenOf(node) { return (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).filter(Boolean); }

test('keeps the legacy renderer as the explicit default and does not pass semantic-only props into it', () => {
  const tree = BrandedMeetingJoinAdapter({ meetingID: 'room-1', userName: 'Ada', localLink: 'https://community.invalid', onSemanticStateChange() {} });
  assert.equal(tree.type, Legacy);
  assert.equal(tree.props.meetingID, 'room-1');
  assert.equal('localLink' in tree.props, false);
  assert.equal('onSemanticStateChange' in tree.props, false);
});

test('maps the narrow semantic contract, fails closed for blank IDs, and forwards localLink only when explicitly supplied', () => {
  const credentials = { apiUserName: 'broker-user', apiKey: 'private-key' };
  const cloud = mapBrandedMeetingJoinToSemantic({ meetingID: '   ', userName: ' Ada ', credentials });
  assert.equal(cloud.meetingID, undefined);
  assert.equal(cloud.userName, ' Ada ');
  assert.equal('localLink' in cloud, false);
  assert.equal(cloud.credentials, credentials);
  const community = mapBrandedMeetingJoinToSemantic({ meetingID: 'room-1', localLink: 'https://community.invalid' });
  assert.equal(community.localLink, 'https://community.invalid');
});

test('semantic mode mounts one headless controller, keeps credentials out of branding DOM props, and has an accessible label', () => {
  const tree = BrandedMeetingJoinAdapter({ renderer: 'semantic', meetingID: 'room-1', roomPrefix: 'team-', userName: 'Ada', title: 'Support meeting', primaryColor: '#123456', borderRadius: 'pill', credentials: { apiUserName: 'broker-user', apiKey: 'private-key' } });
  assert.equal(tree.type, 'section');
  assert.equal(tree.props['aria-label'], 'Support meeting');
  assert.equal(tree.props['data-media-sfu-renderer'], 'semantic');
  assert.equal(tree.props.style['--media-sfu-primary-color'], '#123456');
  assert.equal(tree.props.style['--media-sfu-border-radius'], '50px');
  assert.equal(['rounded', 'pill', 'square'].includes(tree.props.style['--media-sfu-border-radius']), false);
  assert.equal(JSON.stringify({ ...tree.props, children: undefined }).includes('private-key'), false);
  const children = childrenOf(tree);
  assert.equal(children[0].type, 'h2');
  assert.equal(children[0].props.children, 'Support meeting');
  assert.equal(children[1].type, Headless);
  assert.equal(children[1].props.meetingID, 'room-1');
  assert.equal(children[1].props.roomPrefix, 'team-');
  assert.equal('localLink' in children[1].props, false);
});

test('adapter source has no ConnectionBlock import and creates one semantic controller boundary', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'widgets', 'BrandedMeetingJoinAdapter.tsx'), 'utf8');
  assert.equal(source.includes('../blocks/' + 'ConnectionBlock'), false);
  assert.equal((source.match(/<HeadlessMeetingJoinWidget/g) || []).length, 1);
});
