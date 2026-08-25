import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const distDirectory = resolve(packageRoot, 'dist');

if (distDirectory !== resolve(packageRoot, 'dist')) {
  throw new Error('Refusing to clean an unexpected build directory');
}

await rm(distDirectory, { recursive: true, force: true });
