import path from 'node:path';
import { args, required, findQuark, detectBridge, run } from './lib.mjs';

const a = args();
const root = await findQuark(a['quark-root']);
console.log(JSON.stringify({ quarkInstalled: Boolean(root), quarkRoot: root, bridge: (await detectBridge(a)).available ? 'codex_queue' : 'manual' }, null, 2));
if (a['check-auth']) {
  if (!root) throw new Error('先安装官方夸克 Skill');
  const input = required(a, 'session-input'), session = required(a, 'session-id');
  if (!/^\d+-[a-zA-Z0-9]+$/.test(session)) throw new Error('session-id 应为 timestamp-random，并在本对话复用');
  const result = await run(process.execPath, [path.join(root, 'scripts/quark-drive.cjs'), 'get-user-info', '--session-input', input, '--session-id', session], { cwd: root, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
}
