import { mkdir, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { args, required, skillRoot, writeJSON, privatePath, isMain } from './lib.mjs';

export async function initWorkspace(dir, options = {}) {
  dir = path.resolve(dir);
  try { await access(privatePath(dir, 'config')); throw new Error('工作区已存在，请直接启动或选择新目录'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(path.join(dir, 'private'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, 'public/thumbs'), { recursive: true });
  await cp(path.join(skillRoot, 'assets/web'), path.join(dir, 'public'), { recursive: true });
  await writeJSON(privatePath(dir, 'config'), { title: options.title || '整理网盘文件', bridge: options.bridge || 'auto', thread: options.thread || process.env.CODEX_THREAD_ID || null, codex: options.codex || process.env.CODEX_APP_RUNTIME_CLI_PATH || null, csrf: randomBytes(32).toString('hex') });
  return dir;
}
if (isMain(import.meta.url)) {
  const a = args();
  console.log(await initWorkspace(required(a, 'dir'), a));
}
