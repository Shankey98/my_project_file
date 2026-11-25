import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function openStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('저장 파일을 읽을 수 없습니다. 원본 파일을 보존하고 종료합니다.', { cause: error });
    state = { version: 1, trips: [], events: [], subscriptions: [], contact: '' };
  }
  if (state.version !== 1 || !Array.isArray(state.trips) || !Array.isArray(state.events) || !Array.isArray(state.subscriptions)) throw new Error('지원하지 않는 저장 파일입니다.');
  let queue = Promise.resolve();
  const read = () => structuredClone(state);
  const update = (mutator) => {
    const job = queue.then(async () => {
      const next = structuredClone(state);
      const result = await mutator(next);
      next.events = next.events.slice(-150);
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      state = next;
      return result;
    });
    queue = job.catch(() => {});
    return job;
  };
  return { read, update };
}
