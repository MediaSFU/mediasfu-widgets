import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const budgets = [
  ['CDN UMD', 'dist/widget.js', 3_800_000, 1_100_000, 900_000],
  ['CDN ESM', 'dist/widget.esm.js', 3_800_000, 1_100_000, 900_000],
  ['npm root ESM', 'dist/widget.mjs', 3_800_000, 1_100_000, 900_000],
  ['Call button CJS', 'dist/subpaths/call-button.cjs', 55_000, 16_000, 14_000],
  ['Call button ESM', 'dist/subpaths/call-button.mjs', 55_000, 16_000, 14_000],
  ['Meeting join CJS', 'dist/subpaths/meeting-join.cjs', 65_000, 18_000, 16_000],
  ['Meeting join ESM', 'dist/subpaths/meeting-join.mjs', 65_000, 18_000, 16_000],
  ['AI agent CJS', 'dist/subpaths/ai-agent.cjs', 30_000, 10_000, 9_000],
  ['AI agent ESM', 'dist/subpaths/ai-agent.mjs', 30_000, 10_000, 9_000],
  ['Web agent CJS', 'dist/subpaths/web-agent.cjs', 32_000, 11_000, 10_000],
  ['Web agent ESM', 'dist/subpaths/web-agent.mjs', 32_000, 11_000, 10_000],
  ['Calls CJS', 'dist/subpaths/calls.cjs', 32_000, 11_000, 10_000],
  ['Calls ESM', 'dist/subpaths/calls.mjs', 32_000, 11_000, 10_000],
  ['Agent dashboard CJS', 'dist/subpaths/agent-dashboard.cjs', 35_000, 12_000, 11_000],
  ['Agent dashboard ESM', 'dist/subpaths/agent-dashboard.mjs', 35_000, 12_000, 11_000],
  ['React CJS', 'dist/subpaths/react.cjs', 110_000, 30_000, 27_000],
  ['React ESM', 'dist/subpaths/react.mjs', 110_000, 30_000, 27_000],
  ['Headless CJS', 'dist/subpaths/headless.cjs', 25_000, 8_000, 7_000],
  ['Headless ESM', 'dist/subpaths/headless.mjs', 25_000, 8_000, 7_000],
];

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const failures = [];

console.log('MediaSFU widget bundle budgets');
console.log('Entry\tRaw\tGzip\tBrotli');

for (const [label, file, rawBudget, gzipBudget, brotliBudget] of budgets) {
  let source;
  try {
    source = await readFile(new URL(`../${file}`, import.meta.url));
  } catch (error) {
    failures.push(`${label}: missing ${file} (${error.code ?? error.message})`);
    continue;
  }

  const raw = source.byteLength;
  const gzip = gzipSync(source, { level: 9 }).byteLength;
  const brotli = brotliCompressSync(source, {
    // Quality 9 is deterministic and fast enough to run after every local build.
    params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
  }).byteLength;

  console.log(`${label}\t${format(raw)}\t${format(gzip)}\t${format(brotli)}`);

  for (const [kind, actual, budget] of [
    ['raw', raw, rawBudget],
    ['gzip', gzip, gzipBudget],
    ['Brotli', brotli, brotliBudget],
  ]) {
    if (actual > budget) {
      failures.push(`${label} ${kind}: ${actual} bytes exceeds ${budget} bytes`);
    }
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nAll bundle budgets passed.');
}
