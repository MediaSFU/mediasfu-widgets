import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = ['widget.js', 'widget.esm.js', 'widget.css'];
const platforms = ['react', 'vue', 'shopify', 'wordpress'];

for (const artifact of artifacts) {
  const source = path.join(root, 'dist', artifact);
  await stat(source);

  for (const platform of platforms) {
    await copyFile(source, path.join(root, 'platforms', platform, artifact));
  }
}

console.log(`Synchronized ${artifacts.length} widget artifacts across ${platforms.length} platform distributions.`);
