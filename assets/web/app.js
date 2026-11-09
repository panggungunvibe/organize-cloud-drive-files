import { buildLeaves, splitLeaves, selectPreviewAssets, globePlacement } from './gallery.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const element = (tag, value = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const methodNames = { move_in_place: '在原目录内移动归档，保留原文件名', move: '移动归档到已确认目标', copy: '复制归档，保留原文件' };
let data, leaves, previews, animationFinished = false, animating = false, generation = 0, pollTimer;
const leafNodes = new Map();
const mediaNames = { photo: '照片', video: '视频', other: '其他' };

async function getJSON(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '页面数据读取失败');
  return value;
}
function setStep(nextStep) {
  $$('[data-panel]').forEach(panel => {
    const active = Number(panel.dataset.panel) === nextStep;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  $$('[data-step-indicator]').forEach(node => {
    const value = Number(node.dataset.stepIndicator);
    node.classList.toggle('active', value === nextStep);
    node.classList.toggle('done', value < nextStep);
  });
  $$('.steps > i').forEach((line, index) => line.classList.toggle('done', index + 1 < nextStep));
}
function renderInventory() {
  $('#album-title').textContent = data.title;
  document.title = data.title + ' · 整理网盘文件';
  $('#mode-label').textContent = data.mode === 'demo' ? '本地照片预览 · 不连接网盘' : '最终确认后才会整理网盘';
  const inventory = $('#inventory');
  const title = element('div', '', 'inventory-title');
  title.append(element('span', '待整理素材'), element('strong', data.source.path));
  inventory.append(title);
  const stats = [['总素材', data.stats.total, '项']];
  for (const kind of ['photo', 'video', 'other']) {
    if (data.stats[kind]) stats.push([mediaNames[kind], data.stats[kind], kind === 'photo' ? '张' : kind === 'video' ? '段' : '项']);
  }
  const size = data.stats.unknownSize === data.stats.total ? '未知' : (data.stats.bytes / 1024 ** 3).toFixed(1);
  stats.push(['总容量', size, size === '未知' ? '' : 'GB' + (data.stats.unknownSize ? ' + 部分未知' : '')]);
  inventory.style.setProperty('--metric-count', stats.length);
  for (const [name, value, unit] of stats) {
    const metric = element('div', '', 'metric');
    metric.append(element('span', name), element('strong', value.toLocaleString('zh-CN')), element('small', unit));
    inventory.append(metric);
  }
  $('#inventory-note').textContent = '已读取 ' + data.stats.total + ' 项素材 · ' + leaves.length + ' 个最末级目录';
  $('#scope').textContent = '范围：' + data.source.path + ' → ' + data.target.path + '；' + methodNames[data.method] + '。';
}
function renderLogic() {
  const flow = $('#logic-flow');
  const source = element('article', '', 'logic-node source-node');
  source.append(element('span', '原始文件夹'), element('strong', data.title), element('small', data.stats.total + ' 项素材'));
  flow.append(source);
  const depth = Math.max(...leaves.map(l => l.path.length));
  for (let level = 0; level < Math.min(depth, 4); level++) {
    const arrow = element('div', '', 'flow-arrow'); arrow.append(element('i'), element('span', '归入目录'));
    const names = [...new Set(leaves.map(l => l.path[level]).filter(Boolean))];
    const node = element('article', '', 'logic-node');
    node.append(element('span', '第 ' + (level + 1) + ' 级'), element('strong', names.slice(0, 2).join(' / ')), element('small', names.slice(2).join('、') || '按已确认的逐文件方案归类'));
    flow.append(arrow, node);
  }
  data.rules.forEach((rule, index) => {
    const node = element('div');
    node.append(element('b', String(index + 1).padStart(2, '0')), element('span', rule));
    $('#rules').append(node);
  });
}
function renderDirectoryPlan() {
  const rootGroups = new Map();
  for (const leaf of leaves) {
    const root = leaf.path[0];
    if (!rootGroups.has(root)) rootGroups.set(root, []);
    rootGroups.get(root).push(leaf);
  }
  for (const [root, group] of rootGroups) {
    const card = element('article', '', 'folder-card');
    card.style.setProperty('--folder-color', group[0].color);
    const head = element('div', '', 'folder-card-head'), copy = element('div');
    copy.append(element('strong', root), element('span', group.reduce((n, l) => n + l.count, 0) + ' 项素材'));
    head.append(copy, element('i', '', 'folder-icon')); card.append(head);
    const prefixes = new Map();
    for (const leaf of group) {
      const prefix = leaf.path.slice(1, -1).join(' / ') || '归档内容';
      if (!prefixes.has(prefix)) prefixes.set(prefix, []);
      prefixes.get(prefix).push(leaf);
    }
    for (const [prefix, entries] of prefixes) {
      const block = element('div', '', 'media-group'), list = element('ul');
      for (const leaf of entries) {
        const row = element('li'); row.append(element('span', leaf.name), element('b', leaf.count + ' 项')); list.append(row);
      }
      block.append(element('strong', prefix), list); card.append(block);
    }
    $('#folder-plan').append(card);
  }
  $('#folder-plan-note').textContent = '以下目录来自全部 ' + data.stats.total + ' 项素材的逐文件方案，共 ' + leaves.length + ' 个最末级文件夹。';
  $('#method-note').textContent = methodNames[data.method];
  $('#target-note').textContent = '结果位置：' + data.target.path + '。动画结束后，还需正式确认才会操作网盘。';
}
function mediaCard(asset, className) {
  const card = element('div', '', className);
  card.title = [...asset.destination, asset.newName || asset.filename].join(' / ');
  if (asset.thumbnail) {
    const img = document.createElement('img');
    img.src = '/' + asset.thumbnail; img.alt = asset.newName || asset.filename;
    img.loading = 'eager'; img.decoding = 'async'; card.append(img);
    img.addEventListener('error', () => {
      img.remove(); card.classList.add('filename-card');
      card.append(element('span', asset.filename));
    }, { once: true });
  } else {
    card.classList.add('filename-card'); card.append(element('span', asset.newName || asset.filename));
  }
  if (asset.media === 'video') card.append(element('i'));
  return card;
}
function renderLeafColumns() {
  leafNodes.clear();
  const split = splitLeaves(leaves);
  $('#left-title').textContent = split.leftTitle; $('#right-title').textContent = split.rightTitle;
  for (const [side, group] of [['left', split.left], ['right', split.right]]) {
    const list = $('#' + side + '-destinations'); list.replaceChildren();
    $('#' + side + '-folder-count').textContent = group.length + ' 个文件夹';
    for (const leaf of group) {
      const node = element('article', '', 'leaf-folder'); node.dataset.leaf = leaf.id;
      node.style.setProperty('--leaf-color', leaf.color);
      node.title = leaf.path.join(' / ') + ' · 计划 ' + leaf.count + ' 项';
      const icon = element('div', '', 'leaf-folder-icon'), pile = element('span', '', 'leaf-preview-stack');
      pile.setAttribute('aria-hidden', 'true'); icon.append(pile, element('i'));
      const copy = element('div', '', 'leaf-folder-copy');
      copy.append(element('small', leaf.parent || data.title), element('strong', leaf.name));
      node.append(icon, copy, element('b', leaf.count.toLocaleString('zh-CN')));
      list.append(node); leafNodes.set(leaf.key, { node, pile, ids: new Set(), coverKeys: new Set() });
    }
  }
  const maxRows = Math.max(split.left.length, split.right.length);
  $('#sorting-board').style.setProperty('--board-height', Math.max(488, Math.min(740, maxRows * 28 + 80)) + 'px');
}
function buildMediaGlobe() {
  const globe = $('#media-globe'); globe.replaceChildren(); globe.classList.add('dense');
  previews.forEach((asset, index) => {
    const p = globePlacement(index, previews.length);
    const tile = mediaCard(asset, 'globe-tile ' + asset.media + '-tile');
    tile.style.setProperty('--x', p.x + '%'); tile.style.setProperty('--y', p.y + '%');
    tile.style.setProperty('--rotate', p.rotation + 'deg'); tile.style.setProperty('--size', p.size + 'px');
    tile.style.zIndex = p.z; tile.dataset.tileIndex = index; globe.append(tile);
  });
  $('#remaining-count').textContent = previews.length;
  $('#preview-denominator').textContent = '/ ' + previews.length + ' 份封面';
  const real = previews.filter(i => i.thumbnail).length;
  $('#asset-source-note').textContent = real + ' 份不重复真实封面' + (real < previews.length ? '，' + (previews.length - real) + ' 份无封面文件卡片' : '') + ' · 完整方案 ' + data.stats.total + ' 项素材';
}
function addToPile(asset) {
  const target = leafNodes.get(JSON.stringify(asset.destination));
  const key = asset.coverKey || asset.thumbnail || asset.id;
  if (!target || target.ids.has(asset.id) || target.coverKeys.has(key) || target.pile.children.length >= 10) return;
  target.ids.add(asset.id); target.coverKeys.add(key);
  if (asset.thumbnail) {
    const img = document.createElement('img'); img.src = '/' + asset.thumbnail; img.alt = ''; img.decoding = 'async';
    target.pile.append(img);
  } else target.pile.append(element('span', '▱', 'file-mini'));
  target.node.classList.add('has-previews');
}
function fillPiles() {
  for (const leaf of leaves) {
    // Every stacked cover belongs to this exact leaf; never cycle a small image set.
    for (const asset of leaf.items) addToPile(asset);
  }
}
function resetPreview() {
  $$('.flying-card').forEach(n => { n.getAnimations().forEach(a => a.cancel()); n.remove(); });
  $('#sorting-board').classList.remove('complete', 'sorting');
  $('#sort-complete').hidden = true;
  $('#sort-count').textContent = '0'; $('#sort-progress').style.width = '0%';
  renderLeafColumns(); buildMediaGlobe();
}
async function animateAsset(asset, index, token, reduced) {
  const tile = $('#media-globe').querySelector('[data-tile-index="' + index + '"]');
  const target = leafNodes.get(JSON.stringify(asset.destination));
  if (!tile || !target) throw new Error('素材缺少真实目标目录');
  const sourceRect = tile.getBoundingClientRect(), targetRect = target.node.getBoundingClientRect();
  const card = mediaCard(asset, 'flying-card ' + asset.media);
  const startX = sourceRect.left + sourceRect.width / 2 - 21, startY = sourceRect.top + sourceRect.height / 2 - 21;
  card.style.left = startX + 'px'; card.style.top = startY + 'px'; document.body.append(card);
  tile.classList.add('departing'); target.node.classList.add('receiving');
  const dx = targetRect.left + Math.min(28, targetRect.width * .22) - startX;
  const dy = targetRect.top + targetRect.height / 2 - startY;
  const curve = (index % 2 === 0 ? -1 : 1) * (34 + index % 5 * 5);
  try {
    await card.animate([
      { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx * .52 + 'px,' + (dy * .52 + curve) + 'px) rotate(' + (index % 2 ? -10 : 10) + 'deg) scale(.9)', opacity: 1, offset: .55 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(0deg) scale(.24)', opacity: .12 }
    ], { duration: reduced ? 1 : 680, easing: 'cubic-bezier(.2,.76,.18,1)', fill: 'forwards' }).finished;
    if (token === generation) addToPile(asset);
  } catch { /* A replay or page close cancels old visual flights only. */ }
  finally { card.remove(); target.node.classList.remove('receiving'); }
}
async function startSortingAnimation() {
  if (animating) return;
  const token = ++generation, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  animating = true; animationFinished = false; resetPreview();
  $('#replay-sorting').disabled = true; $('#sorting-title').textContent = '整理动画预览';
  $('#sort-status').textContent = '真实素材已铺满星球，正在展开最末级文件夹…';
  $('#sorting-board').classList.add('sorting');
  await delay(reduced ? 0 : 650);
  const flights = [];
  for (let index = 0; index < previews.length && token === generation; index++) {
    const asset = previews[index];
    flights.push(animateAsset(asset, index, token, reduced));
    $('#sort-count').textContent = index + 1;
    $('#remaining-count').textContent = previews.length - index - 1;
    $('#sort-progress').style.width = (index + 1) / previews.length * 100 + '%';
    $('#sort-status').textContent = '正在预览「' + (asset.newName || asset.filename) + '」 → ' + asset.destination.join(' / ');
    await delay(reduced ? 0 : 55);
  }
  await Promise.all(flights);
  if (token !== generation) return;
  animating = false; animationFinished = true; fillPiles();
  $('#sorting-board').classList.add('complete'); $('#sort-progress').style.width = '100%';
  $('#replay-sorting').disabled = false;
  $('#sort-status').textContent = '归类预览已完成，尚未因预览改动网盘。';
  showCompletion();
  if (data.status.status !== 'ready') await renderJob(data.status);
}
function showCompletion() {
  $('#sort-complete').hidden = false;
  $('#complete-title').textContent = '整理预览完成';
  $('#complete-message').textContent = '完整方案 ' + data.stats.total + ' 项素材，将按以上目录归档。';
  const button = $('#commit-cloud');
  button.hidden = data.status.status !== 'ready';
  button.disabled = !data.ready;
  button.textContent = data.mode === 'demo' ? '本地预览结束（不操作网盘）' : data.ready ? '正式确认以上归类，开始整理网盘' : '预览已完成，等待 Agent 完成官方校验';
}
function renderNotice(value) {
  const node = $('#cloud-notice'); node.replaceChildren(); node.hidden = !value;
  // Render official Markdown links without treating the notice as HTML.
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let end = 0;
  for (const match of (value || '').matchAll(re)) {
    node.append(document.createTextNode(value.slice(end, match.index)));
    const link = element('a', match[1]); link.href = match[2]; link.target = '_blank'; link.rel = 'noreferrer'; node.append(link);
    end = match.index + match[0].length;
  }
  node.append(document.createTextNode((value || '').slice(end)));
}
async function renderJob(job) {
  data.status = job;
  if (job.status === 'ready') return;
  const titles = { dispatching: '正在通知 Agent', queued: '整理指令已发送给 Agent', awaiting_agent: '确认已保存，请发送指令', running: '正在执行真实网盘整理', submitted: '网盘已接收任务，尚未完成', completed: '网盘整理执行成功', partial: '部分完成', failed: '真实整理未完成', needs_review: '真实整理未完成，需要处理', delivery_unknown: '无法确认指令是否送达', demo: '本地预览结束，未操作网盘' };
  const panel = $('#cloud-job'); panel.hidden = false;
  panel.classList.toggle('terminal', ['completed', 'demo', 'awaiting_agent'].includes(job.status));
  panel.classList.toggle('failed', job.status === 'failed');
  panel.classList.toggle('needs-review', ['delivery_unknown', 'needs_review'].includes(job.status));
  $('#cloud-job-title').textContent = titles[job.status] || '任务状态';
  $('#cloud-job-message').textContent = job.error || job.phase || '';
  const c = job.serviceCounts;
  $('#cloud-job-counts').textContent = c ? '计划素材 ' + data.stats.total + ' 项；网盘返回成功 ' + (c.success ?? '未知') + ' 项操作、失败 ' + (c.failed ?? '未知') + '、跳过 ' + (c.skipped ?? '未知') + '。操作数可能包含目录创建。' : '';
  renderNotice(job.notice || '');
  $('#request-label').textContent = job.requestId ? '请求编号：' + job.requestId : '';
  $('#commit-cloud').hidden = true;
  let resultURL;
  try { const u = new URL(job.resultLink); if (['http:', 'https:'].includes(u.protocol)) resultURL = u.href; } catch {}
  const link = $('#cloud-result-link'); link.hidden = !resultURL;
  if (resultURL) link.href = resultURL;
  if (animationFinished || !animating) {
    $('#sort-complete').hidden = false; $('#complete-title').textContent = titles[job.status] || job.phase;
    $('#complete-message').textContent = job.phase || '';
  }
  $('#manual-command').hidden = job.status !== 'awaiting_agent';
  if (job.status === 'awaiting_agent') {
    const reply = await getJSON('/api/agent-command'); $('#command-text').value = reply.command;
  }
}
async function commitCloudOrganization() {
  if (!animationFinished || animating || data.status.status !== 'ready') return;
  const button = $('#commit-cloud'); button.disabled = true; button.textContent = '正在保存确认并通知 Agent…';
  try {
    const job = await getJSON('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: data.csrf, planDigest: data.planDigest }) });
    await renderJob(job);
  } catch (error) { $('#page-error').textContent = error.message; button.disabled = !data.ready; }
}
async function init() {
  try {
    data = await getJSON('/api/view'); leaves = buildLeaves(data.items); previews = selectPreviewAssets(data.items);
    if (!previews.length) throw new Error('没有可预览的素材');
    renderInventory(); renderLogic(); renderDirectoryPlan(); renderLeafColumns(); buildMediaGlobe();
    if (data.status.status !== 'ready') {
      setStep(3); animationFinished = true; fillPiles(); $('#sorting-board').classList.add('complete'); await renderJob(data.status);
    } else if (new URLSearchParams(location.search).get('preview') === 'sorting') {
      setStep(3);
      if (new URLSearchParams(location.search).get('paused') !== '1') void startSortingAnimation();
      else $('#sort-status').textContent = previews.length + ' 份素材预览已铺满星球；可点击“播放整理预览”。';
      if (new URLSearchParams(location.search).get('paused') === '1') {
        $('#sort-complete').hidden = false; $('#complete-title').textContent = '素材星球已准备好';
        $('#complete-message').textContent = '点击播放，查看素材如何归入两侧文件夹。';
        $('#replay-sorting').textContent = '播放整理预览';
      }
    }
    pollTimer = setInterval(async () => {
      if (data.mode === 'demo' || data.status.status === 'ready') return;
      try { await renderJob(await getJSON('/api/status')); }
      catch (error) { $('#page-error').textContent = '暂时无法读取真实进度：' + error.message; }
    }, 2500);
  } catch (error) { $('#logic-title').textContent = '还没有可展示的真实素材'; $('#logic-intro').textContent = error.message; }
}
$('#confirm-logic').addEventListener('click', () => setStep(2));
$('#back-to-logic').addEventListener('click', () => setStep(1));
$('#confirm-folders').addEventListener('click', () => { setStep(3); void startSortingAnimation(); });
$('#replay-sorting').addEventListener('click', () => { if (!animating) void startSortingAnimation(); });
$('#commit-cloud').addEventListener('click', commitCloudOrganization);
$('#copy-command').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#command-text').value); $('#copy-command').textContent = '已复制，请发送到当前 Agent'; }
  catch { $('#command-text').focus(); $('#command-text').select(); $('#copy-command').textContent = '请复制选中的指令'; }
});
window.addEventListener('pagehide', () => { generation++; clearInterval(pollTimer); });
void init();
