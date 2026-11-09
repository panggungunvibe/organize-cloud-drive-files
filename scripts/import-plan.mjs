import path from 'node:path';
import { args, required, readJSON, writeJSON, privatePath, validatePlan, safeAsset, digest, now, withLock, isMain } from './lib.mjs';
import { unlink } from 'node:fs/promises';

export async function importPlan(dir, plan) {
  validatePlan(plan);
  for (const i of plan.items) if (i.thumbnail) await safeAsset(path.join(dir, 'public'), i.thumbnail);
  return withLock(dir, async () => {
    const old = await readJSON(privatePath(dir, 'plan'), null);
    if (old && digest(old) === digest(plan)) return { changed: false, planDigest: digest(plan) };
    const status = await readJSON(privatePath(dir, 'status'), null);
    if (await readJSON(privatePath(dir, 'approval'), null) || (status && status.status !== 'ready')) throw new Error('工作区已有确认或执行记录；不能覆盖来重新执行，请核对原请求并使用新工作区');
    await writeJSON(privatePath(dir, 'plan'), plan);
    await unlink(privatePath(dir, 'approval')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await writeJSON(privatePath(dir, 'status'), { status: 'ready', phase: '请确认整理方案', planDigest: digest(plan), updatedAt: now() });
    return { changed: true, planDigest: digest(plan) };
  });
}
if (isMain(import.meta.url)) {
  const a = args();
  console.log(JSON.stringify(await importPlan(path.resolve(required(a, 'workspace')), await readJSON(required(a, 'plan')))));
}
