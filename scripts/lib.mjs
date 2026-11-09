import { readFile, writeFile, rename, mkdir, access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const run = promisify(execFile);
export const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const isMain = url => Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
export const now = () => new Date().toISOString();
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (!k || k in out) throw new Error(`重复或无效参数: ${a}`);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
export function required(a, key) {
  if (typeof a[key] !== 'string' || !a[key]) throw new Error(`缺少 --${key}`);
  return a[key];
}
export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && arguments.length > 1) return fallback; throw e; }
}
export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
export const privatePath = (dir, name) => path.join(dir, 'private', name + '.json');
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const nonempty = (v, field) => { if (typeof v !== 'string' || !v.trim() || /[\x00-\x1f]/.test(v)) throw new Error(`无效 ${field}`); };
function segment(v) {
  nonempty(v, '目录或文件名');
  if (v === '.' || v === '..' || /[/\\]/.test(v)) throw new Error('目录或文件名不允许路径分隔符');
}
const fidKey = v => v.split('|').at(-1);
export function validatePlan(plan) {
  if (plan?.version !== 1 || !['live', 'demo'].includes(plan.mode)) throw new Error('需要 version 1 和 live/demo 模式');
  nonempty(plan.title, 'title');
  if (!['move_in_place', 'move', 'copy'].includes(plan.method)) throw new Error('无效 method');
  for (const key of ['source', 'target']) { nonempty(plan[key]?.fid, `${key}.fid`); nonempty(plan[key]?.path, `${key}.path`); }
  if (plan.method === 'move_in_place' && (fidKey(plan.source.fid) !== fidKey(plan.target.fid) || plan.source.path !== plan.target.path)) throw new Error('原目录归档要求源目标相同');
  if (!Array.isArray(plan.rules) || !plan.rules.every(v => typeof v === 'string')) throw new Error('rules 必须为字符串数组');
  if (!Array.isArray(plan.items) || !plan.items.length) throw new Error('方案没有素材');
  const ids = new Set(), fids = new Set(), targets = new Set();
  for (const item of plan.items) {
    nonempty(item.id, 'item.id'); nonempty(item.fid, 'item.fid'); nonempty(item.parentFid, 'item.parentFid'); segment(item.filename);
    if (ids.has(item.id) || fids.has(fidKey(item.fid))) throw new Error('素材身份重复');
    ids.add(item.id); fids.add(fidKey(item.fid));
    if (!['photo', 'video', 'other'].includes(item.media)) throw new Error('无效 media');
    if (item.size !== null && (!Number.isSafeInteger(item.size) || item.size < 0)) throw new Error('size 必须为非负整数字节或 null');
    if (!Array.isArray(item.destination) || !item.destination.length) throw new Error('缺少目标目录');
    item.destination.forEach(segment);
    if (item.newName !== undefined) segment(item.newName);
    const target = JSON.stringify([...item.destination, item.newName || item.filename]);
    if (targets.has(target)) throw new Error('同目标目录存在重名文件，请先解决冲突');
    targets.add(target);
    if (item.thumbnail !== undefined && (!/^thumbs\/[a-zA-Z0-9._/-]+\.(jpe?g|png|webp|gif|avif|svg)$/i.test(item.thumbnail) || item.thumbnail.split('/').some(s => !s || s === '.' || s === '..'))) throw new Error('封面必须位于 public/thumbs 内');
  }
  const v = plan.validation;
  if (!v || typeof v.ready !== 'boolean' || typeof v.executionSupported !== 'boolean') throw new Error('需要显式校验状态');
  if (v.ready && plan.mode === 'live') {
    for (const key of ['providerDigest', 'proposalPath', 'taskDir']) nonempty(v[key], key);
    if (!path.isAbsolute(v.proposalPath) || !path.isAbsolute(v.taskDir)) throw new Error('proposalPath/taskDir 必须为绝对路径');
  }
  return plan;
}
export async function safeAsset(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(s => s === '..' || s === '.')) throw new Error('无效资源路径');
  const base = await realpath(root), target = await realpath(path.join(root, relative));
  if (!target.startsWith(base + path.sep) || !(await stat(target)).isFile()) throw new Error('资源超出公共目录');
  return target;
}
export async function loadPlan(dir) {
  const p = validatePlan(await readJSON(privatePath(dir, 'plan')));
  return { plan: p, planDigest: digest(p) };
}
export function viewPlan(plan, covers = {}) {
  const groups = new Map();
  const stats = { total: plan.items.length, photo: 0, video: 0, other: 0, bytes: 0, unknownSize: 0 };
  const items = plan.items.map(i => {
    stats[i.media]++; if (i.size === null) stats.unknownSize++; else stats.bytes += i.size;
    const key = JSON.stringify(i.destination);
    if (!groups.has(key)) groups.set(key, { key, path: i.destination, count: 0 });
    groups.get(key).count++;
    return { id: i.id, filename: i.filename, newName: i.newName, media: i.media, destination: i.destination, group: key, thumbnail: i.thumbnail, coverKey: covers[i.id] };
  });
  return { title: plan.title, mode: plan.mode, method: plan.method, source: { path: plan.source.path }, target: { path: plan.target.path }, rules: plan.rules, ready: plan.validation.ready && plan.validation.executionSupported, stats, items, groups: [...groups.values()] };
}
export async function findQuark(explicit) {
  const roots = explicit ? [explicit] : [...new Set([process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, 'skills', 'quarkclouddrive'), path.join(os.homedir(), '.codex/skills/quarkclouddrive'), path.join(os.homedir(), '.agents/skills/quarkclouddrive')].filter(Boolean))];
  for (const root of roots) { try { await access(path.join(root, 'SKILL.md')); return path.resolve(root); } catch {} }
  return null;
}
export async function detectBridge(config) {
  if (config.bridge === 'manual') return { available: false, reason: '使用手动发送模式' };
  const thread = config.thread || process.env.CODEX_THREAD_ID;
  const cli = config.codex || process.env.CODEX_APP_RUNTIME_CLI_PATH || 'codex';
  if (!thread) return { available: false, reason: '当前环境未提供可绑定的 Codex 会话' };
  try {
    const { stdout, stderr } = await run(cli, ['queue', '--help'], { timeout: 5000, maxBuffer: 512000 });
    if (!/--thread/.test(stdout + stderr) || !/--message/.test(stdout + stderr)) throw new Error('CLI 不支持当前会话队列');
    return { available: true, cli, thread };
  } catch { return { available: false, reason: '当前 Codex 版本未提供可用的会话队列' }; }
}
export function agentMessage(dir, approval, plan) {
  return [
    '我已在整理网站中点击「正式确认以上归类，开始整理网盘」。',
    `请使用已安装并授权的夸克网盘 Skill，按已确认逐文件方案真实整理 ${plan.source.path}。`,
    `方式：${plan.method}；目标：${plan.target.path}；素材：${plan.items.length} 项。`,
    `请求编号：${approval.requestId}；方案指纹：${approval.planDigest}；官方校验摘要：${approval.providerDigest}。`,
    `先读取 ${path.join(skillRoot, 'SKILL.md')}，并核对 ${privatePath(dir, 'approval')} 与 ${privatePath(dir, 'plan')}。`,
    `只执行该冻结映射；先核对 ${plan.validation.proposalPath} 的逐文件范围及官方 digest，变化须重新确认。不得删除或扩大范围。`,
    `执行前调用状态脚本 ${path.join(skillRoot, 'scripts/status.mjs')}，子命令 running，参数 --workspace 为 ${JSON.stringify(dir)}，--request-id 为 ${approval.requestId}。`,
    '调用 CLI 请使用结构化参数，勿把以上路径字符串作为 shell 代码拼接。',
    `官方执行结果落盘后使用同一状态脚本的 result 子命令，带相同 --workspace 和 --request-id，以及 --result <官方原始结果文件>。`,
    '只有官方实际完成结果才能回写 completed；提交回执、超时或范围不符保持未完成。服务端操作数不能当作素材数。'
  ].join('\n');
}
export async function withLock(dir, operation) {
  const lock = path.join(dir, 'private', '.write-lock');
  const { open, unlink } = await import('node:fs/promises');
  const handle = await open(lock, 'wx', 0o600).catch(() => { throw new Error('工作区正在写入；若进程异常退出，请先核对原请求状态再移除锁'); });
  try { return await operation(); } finally { await handle.close(); await unlink(lock); }
}
