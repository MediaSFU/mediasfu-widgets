const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("call widgets keep using the standard MediaSFU consumer audio lifecycle", () => {
  const sourceRoot = path.join(__dirname, "..", "src");
  const roomDisplay = fs.readFileSync(
    path.join(sourceRoot, "components", "MediaSFU", "MediaSFURoomDisplay.tsx"),
    "utf8"
  );
  const allSource = fs
    .readdirSync(path.join(sourceRoot, "components", "MediaSFU"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) =>
      fs.readFileSync(path.join(sourceRoot, "components", "MediaSFU", name), "utf8")
    )
    .join("\n");

  assert.match(roomDisplay, /params\.audioOnlyStreams/);
  assert.match(roomDisplay, /<AudioGrid/);
  assert.match(roomDisplay, /componentsToRender=\{roomState\.roomAudio\}/);
  assert.doesNotMatch(allSource, /createBufferSource|decodeAudioData|pipelineAudioChunk/);
});
