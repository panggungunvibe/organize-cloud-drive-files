import { readdir, cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { args, isMain, required } from './lib.mjs';
import { initWorkspace } from './init-workspace.mjs';
import { importPlan } from './import-plan.mjs';

const photos = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const videos = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
export async function createLocalPreview(dir, mediaDir) {
  dir = path.resolve(dir); mediaDir = path.resolve(mediaDir);
  if (dir === mediaDir || dir.startsWith(mediaDir + path.sep)) throw new Error('请将预览工作区放在相册目录外');
  const files = [];
  async function walk(root, folders = []) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(file, [...folders, entry.name]);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (photos.has(ext) || videos.has(ext)) files.push({ file, folders, ext, name: entry.name });
      }
    }
  }
  await walk(mediaDir);
  if (!files.length) throw new Error('这个目录中未找到可预览的照片或视频');
  await initWorkspace(dir, { title: path.basename(mediaDir), bridge: 'manual' });
  const items = [];
  for (const [index, f] of files.entries()) {
    const id = 'local-' + String(index + 1).padStart(5, '0'), media = photos.has(f.ext) ? 'photo' : 'video';
    const thumbnail = media === 'photo' ? 'thumbs/' + id + f.ext : undefined;
    if (thumbnail) await cp(f.file, path.join(dir, 'public', thumbnail));
    items.push({ id, fid: id, parentFid: 'local-preview', filename: f.name, media, size: (await stat(f.file)).size, destination: [...(f.folders.length ? f.folders : ['未分类']), media === 'photo' ? '照片' : '视频'], ...(thumbnail ? { thumbnail } : {}) });
  }
  await importPlan(dir, {
    version: 1, title: path.basename(mediaDir), mode: 'demo', method: 'move_in_place',
    source: { fid: 'local-preview', path: mediaDir }, target: { fid: 'local-preview', path: mediaDir },
    rules: ['使用你提供的真实照片与原有子目录预览界面', '照片与视频分开；没有封面的视频显示文件卡片', '本地预览不分析或改动网盘，正式归类由 Agent 读取网盘素材后生成'],
    validation: { ready: true, executionSupported: true }, items
  });
  return dir;
}
if (isMain(import.meta.url)) {
  const a = args();
  if (!a['media-dir']) {
    console.log('请提供自己的真实相册目录：npm run demo -- --media-dir <相册目录>\n仅在本地预览；已有子目录作为预览分组，不代表 AI 已完成分类。');
  } else {
    const dir = await createLocalPreview(a.dir || '.demo', required(a, 'media-dir'));
    const { createOrganizer } = await import('./serve.mjs');
    const server = await createOrganizer(dir);
    server.listen(a.port ? Number(a.port) : 0, '127.0.0.1', () => console.log('真实照片本地预览：http://127.0.0.1:' + server.address().port + '/'));
  }
}
