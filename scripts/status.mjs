import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { args, required, isMain, readJSON, writeJSON, privatePath, loadPlan, now, withLock } from './lib.mjs';

const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
export function parseResult(text) {
  let rows;
  try { const json = JSON.parse(text); rows = Array.isArray(json) ? json : [json]; }
  catch { rows = text.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); }
  rows = rows.map(r => r.result || r);
  const r = rows.filter(r => r.type === 'result').at(-1) || rows.filter(r => typeof r.code === 'number').at(-1);
  if (!r || typeof r.code !== 'number') throw new Error('没有可识别的官方结果');
  if (!['file_organize_apply', 'file-organize-apply'].includes(r.action)) throw new Error('需要精确文件整理 apply 结果，不能使用搜索或账号响应');
  const d = r.data || {}, s = d.summary || {};
  const serviceCounts = { success: count(s.success_count), failed: count(s.fail_count), skipped: count(s.skip_count) };
  const notice = typeof r.notice?.text === 'string' ? r.notice.text : '';
  const common = { serviceCounts, notice, resultLink: d.detail_url || '', providerTaskId: d.organize_task_id || '', providerTaskDir: d.task_dir || null, organizePath: d.organize_path || null };
  if (r.code === 0 && d.operations_finished === true && !d.error) {
    if (serviceCounts.success === 0 && serviceCounts.failed > 0) return { ...common, status: 'failed', phase: `这次没有文件整理成功，${serviceCounts.failed} 项仍在原位置`, error: r.msg || '所有操作均未成功' };
    return { ...common, status: 'completed', phase: serviceCounts.failed > 0 ? `整理执行已结束，${serviceCounts.failed} 项未能落位，请查看结果` : '网盘整理执行成功', completedAt: now() };
  }
  if (r.code === 0 && !d.error) return { ...common, status: 'submitted', phase: '网盘已接收任务，正在等待实际完成结果' };
  return { ...common, status: 'needs_review', phase: '网盘执行未完成，请由 Agent 按原任务处理', error: typeof d.error === 'string' ? d.error : r.msg || '官方接口未返回成功结果' };
}
export async function updateStatus(dir, requestId, change) {
  return withLock(dir, async () => {
    const { plan, planDigest } = await loadPlan(dir);
    const approval = await readJSON(privatePath(dir, 'approval'));
    const status = await readJSON(privatePath(dir, 'status'));
    if (approval.requestId !== requestId || approval.planDigest !== planDigest || status.requestId !== requestId) throw new Error('请求编号或方案指纹不匹配');
    if (!['running','needs_review'].includes(change.status) && (!change.providerTaskDir || path.resolve(change.providerTaskDir) !== path.resolve(plan.validation.taskDir))) throw new Error('官方结果不属于本方案的任务目录');
    if (change.providerTaskDir && path.resolve(change.providerTaskDir) !== path.resolve(plan.validation.taskDir)) throw new Error('官方结果不属于本方案的任务目录');
    if (['completed', 'failed', 'partial'].includes(status.status)) throw new Error('该请求已结束，不能由迟到响应覆盖');
    const updated = { ...status, ...change, total: plan.items.length, plannedFolders: [...new Set(plan.items.map(i => i.destination.join('/')))], organizePath: change.organizePath || plan.target.path, updatedAt: now() };
    await writeJSON(privatePath(dir, 'status'), updated);
    return updated;
  });
}
if (isMain(import.meta.url)) {
  const a = args(), mode = a._[0];
  const change = mode === 'running' ? { status: 'running', phase: a.message || 'Agent 正在真实整理网盘' } : mode === 'result' ? parseResult(await readFile(required(a, 'result'), 'utf8')) : mode === 'problem' ? { status:'needs_review', phase:a.message || '真实整理未完成，请查看 Agent 说明', error:required(a,'error') } : null;
  if (!change) throw new Error('用法: status.mjs running|result|problem --workspace DIR --request-id ID [--result FILE | --error TEXT]');
  console.log(JSON.stringify(await updateStatus(path.resolve(required(a, 'workspace')), required(a, 'request-id'), change), null, 2));
}
