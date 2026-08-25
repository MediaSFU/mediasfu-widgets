/* Verifies that the package entry point exposes the headless controller. */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = process.env.MEDIASFU_WIDGETS_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules', 'typescript'));
const entry = path.join(root, 'src', 'index.ts');
const configPath = path.join(root, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root, undefined, configPath);
const program = ts.createProgram({ rootNames: [entry], options: { ...config.options, noEmit: true } });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
}
const source = program.getSourceFile(entry);
const moduleSymbol = source && program.getTypeChecker().getSymbolAtLocation(source);
if (!moduleSymbol) throw new Error('Could not read the package entry point export symbol.');
const exported = new Set(program.getTypeChecker().getExportsOfModule(moduleSymbol).map(symbol => symbol.getName()));

test('package entry point exposes the headless controller without replacing widget exports', () => {
  const expectedHeadless = [
    'MediaSFUProvider', 'MediaSFUContext', 'normalizeMediaSFUState', 'useMediaSFU', 'useMediaSFUActions', 'useMediaSFUState',
    'HeadlessMeetingJoinWidget', 'resolveHeadlessMeetingID', 'HeadlessMeetingJoinWidgetProps',
    'BrandedMeetingJoinAdapter', 'mapBrandedMeetingJoinToSemantic', 'BrandedMeetingJoinAdapterProps',
    'BrandedSemanticMeetingJoinProps', 'MeetingJoinRenderer',
    'ActionResult', 'ActionState', 'ActionStatus', 'DeviceKind', 'EndRoomManagementAdapter', 'MediaSFUActions',
    'MediaSFUContextValue', 'MediaSFUCredentialsInput', 'MediaSFUProviderProps',
    'MediaSFURole', 'MediaSFUState', 'SemanticMediaControl', 'SemanticMediaState',
    'SemanticMessage', 'SemanticParticipant', 'SemanticPermissions', 'SemanticSession',
    'SessionStatus',
  ];
  assert.deepEqual(expectedHeadless.filter(name => !exported.has(name)), []);
  assert.equal(exported.has('ConnectionBlock'), true);
  assert.equal(exported.has('MeetingJoinWidget'), true);
  assert.equal(exported.has('MeetingJoinWidgetProps'), true);
});
