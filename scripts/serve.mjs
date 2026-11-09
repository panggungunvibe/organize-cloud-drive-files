import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { args, isMain, required, readJSON, writeJSON, loadPlan, viewPlan, privatePath, detectBridge, safeAsset, agentMessage, now, run, withLock } from './lib.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
export async function createOrganizer(dir, options = {}) {
  dir = path.resolve(dir);
  const config = await readJSON(privatePath(dir, 'config'));
  const bridge = options.bridge || await detectBridge(config);
  const dispatch = options.dispatch || (message => run(bridge.cli, ['queue', '--thread', bridge.thread, '--message', message], { timeout: 30000, maxBuffer: 1024 * 1024 }));
  async function confirm(planDigest) {
    const saved = await withLock(dir, async () => {
      const { plan, planDigest: actual } = await loadPlan(dir);
      if (actual !== planDigest) throw new Error('方案已经变化，请刷新后重新确认');
      if (plan.mode === 'demo') return { demo: true };
      if (!plan.validation.ready || !plan.validation.executionSupported) throw new Error('方案尚未完成官方校验或不支持此执行方式');
      const existing = await readJSON(privatePath(dir, 'approval'), null);
      if (existing) {
        if (existing.planDigest !== actual) throw new Error('已有其他方案的请求，不能重复执行');
        const status = await readJSON(privatePath(dir, 'status'), null);
        if (!status || status.status === 'ready') await writeJSON(privatePath(dir, 'status'), { status: 'needs_review', phase: '确认已保存，但发送过程曾中断，请 Agent 核对原请求后继续', requestId: existing.requestId, planDigest: actual, updatedAt: now() });
        return { existing: true };
      }
      const approval = { requestId: randomUUID(), planDigest: actual, providerDigest: plan.validation.providerDigest, source: plan.source, target: plan.target, method: plan.method, itemCount: plan.items.length, confirmedAt: now() };
      const prompt = agentMessage(dir, approval, plan);
      await writeJSON(privatePath(dir, 'approval'), approval);
      await writeFile(path.join(dir, 'private/agent-command.txt'), prompt, { mode: 0o600 });
      await writeJSON(privatePath(dir, 'status'), { status: bridge.available ? 'dispatching' : 'awaiting_agent', phase: bridge.available ? '确认已保存，正在通知 Agent' : '确认已保存，请把指令发送到当前 Agent', requestId: approval.requestId, planDigest: actual, updatedAt: now() });
      return { approval, prompt };
    });
    if (saved.demo) return { status: 'demo', phase: '演示已结束：没有发送指令，也没有操作网盘' };
    if (!saved.existing && bridge.available) {
      let patch;
      try { await dispatch(saved.prompt); patch = { status: 'queued', phase: '指令已发送，等待 Agent 执行' }; }
      catch { patch = { status: 'delivery_unknown', phase: '无法确认是否已送达，请在原 Agent 对话核对请求编号；不要重复提交' }; }
      await withLock(dir, async () => {
        const current = await readJSON(privatePath(dir, 'status'));
        if (current.requestId === saved.approval.requestId && current.status === 'dispatching') await writeJSON(privatePath(dir, 'status'), { ...current, ...patch, updatedAt: now() });
      });
    }
    return readJSON(privatePath(dir, 'status'));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const port = server.address().port;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: '仅允许本机访问' });
    try {
      const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (req.method === 'GET' && pathname === '/api/view') {
        const { plan, planDigest } = await loadPlan(dir);
        return json(res, 200, { ...viewPlan(plan, await readJSON(privatePath(dir, 'covers'), {})), planDigest, csrf: config.csrf, bridge: { available: bridge.available, reason: bridge.reason }, status: await readJSON(privatePath(dir, 'status')) });
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        const status = await readJSON(privatePath(dir, 'status'));
        // If a process stopped mid-dispatch, preserve the pending request; never silently resend.
        return json(res, 200, status);
      }
      if (req.method === 'GET' && pathname === '/api/agent-command') {
        const status = await readJSON(privatePath(dir, 'status'));
        if (status.status !== 'awaiting_agent') return json(res, 409, { error: '当前无需手动发送' });
        return json(res, 200, { command: await readFile(path.join(dir, 'private/agent-command.txt'), 'utf8') });
      }
      if (req.method === 'POST' && pathname === '/api/confirm') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return json(res, 403, { error: '请从原网页确认' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) throw new Error('请求过大'); }
        const b = JSON.parse(body);
        if (typeof b.csrf !== 'string' || Buffer.byteLength(b.csrf) !== Buffer.byteLength(config.csrf) || !timingSafeEqual(Buffer.from(b.csrf), Buffer.from(config.csrf))) return json(res, 403, { error: '会话令牌不匹配，请刷新' });
        return json(res, 200, await confirm(b.planDigest));
      }
      if (req.method !== 'GET') return json(res, 405, { error: '不支持此方法' });
      const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
      if (!['index.html', 'app.js', 'gallery.js', 'style.css'].includes(relative) && !relative.startsWith('thumbs/')) return json(res, 404, { error: '未找到' });
      const file = await safeAsset(path.join(dir, 'public'), relative), type = types[path.extname(file)];
      if (!type) return json(res, 404, { error: '不支持此资源' });
      res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(file));
    } catch (e) { json(res, e.code === 'ENOENT' ? 404 : 409, { error: e.message }); }
  });
  return server;
}
if (isMain(import.meta.url)) {
  const a = args(), dir = path.resolve(required(a, 'workspace'));
  const server = await createOrganizer(dir);
  server.listen(a.port ? Number(a.port) : 0, '127.0.0.1', () => console.log(`整理页面：http://127.0.0.1:${server.address().port}/`));
}
