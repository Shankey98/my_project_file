import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function removeTestDirectory(folder) {
  const resolved = path.resolve(folder), relative = path.relative(path.resolve(os.tmpdir()), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep) || !/^ktx-special-(test|push)-/.test(relative)) throw new Error('Refusing to remove a directory outside the named test workspace.');
  await rm(resolved, { recursive: true, force: true });
}
