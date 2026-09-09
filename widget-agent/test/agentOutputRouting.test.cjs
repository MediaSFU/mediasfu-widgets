const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  Function("exports", "module", compiled)(module.exports, module);
  return module.exports;
}

const routing = loadTypeScriptModule(
  path.join(__dirname, "..", "src", "agentOutputRouting.ts")
);

test("WebRTC and agent recording are defaulted without losing explicit false", () => {
  assert.deepEqual(routing.withAgentOutputDefaults({}), {
    preferWebRTCOutput: true,
    recordAgentOutput: true,
  });
  assert.deepEqual(
    routing.withAgentOutputDefaults({
      preferWebRTCOutput: false,
      recordAgentOutput: false,
    }),
    { preferWebRTCOutput: false, recordAgentOutput: false }
  );
});

test("socket audio starts only for explicit fallback or explicit legacy mode", () => {
  assert.equal(routing.shouldPlaySocketAgentOutput("awaiting-webrtc"), false);
  assert.equal(routing.shouldPlaySocketAgentOutput("webrtc"), false);
  assert.equal(routing.shouldPlaySocketAgentOutput("socket-fallback"), true);
  assert.equal(routing.shouldPlaySocketAgentOutput("legacy-socket"), true);

  assert.equal(
    routing.nextAgentOutputMode("awaiting-webrtc", {
      mode: "socket",
      state: "fallback",
    }),
    "socket-fallback"
  );
  assert.equal(
    routing.nextAgentOutputMode("socket-fallback", {
      mode: "webrtc",
      state: "active",
    }),
    "webrtc"
  );
  assert.equal(
    routing.nextAgentOutputMode("awaiting-webrtc", {
      mode: "webrtc",
      state: "connecting",
    }),
    "awaiting-webrtc"
  );
});

test("two same-name agents cannot share local output ownership", () => {
  const first = routing.createAgentOutputNamespace("room", "agent", "one");
  const second = routing.createAgentOutputNamespace("room", "agent", "two");
  assert.notEqual(first, second);
});

test("active agent surface uses MediaSFU AudioGrid and negotiated PCM fallback", () => {
  const unified = fs.readFileSync(
    path.join(__dirname, "..", "src", "components", "AgentUnified.tsx"),
    "utf8"
  );
  const handler = fs.readFileSync(
    path.join(__dirname, "..", "src", "components", "MediaSFUHandler.tsx"),
    "utf8"
  );
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");

  assert.match(unified, /webAgentOutputModeV1/);
  assert.match(unified, /shouldPlaySocketAgentOutput\(agentOutputMode\.current\)/);
  assert.match(unified, /nextMode === "webrtc"[\s\S]*resetAudioPlayback/);
  assert.match(unified, /staleAudioContext\.close\(\)/);
  assert.match(unified, /boundSocket\.off\("startBuffers", handleStartBuffers\)/);
  assert.match(
    unified,
    /socketListenerCleanup\.current\?\.\(\);[\s\S]*resetAudioPlayback[\s\S]*socket\.current = nextSocket/
  );
  assert.match(handler, /AudioGrid/);
  assert.match(handler, /audioOnlyStreams/);
  assert.doesNotMatch(app, /import\s+Agents(?:Voice|Multimodal)/);
});
