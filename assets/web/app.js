const $ = id => document.getElementById(id);
const text = (tag, value, cls) => { const e = document.createElement(tag); e.textContent = value; if (cls) e.className = cls; return e; };
let data, animationFrame, animating = false, flightGeneration = 0, pollTimer;
const folders = new Map();
const methodName = { move_in_place: '在原目录内移动归档', move: '移动到目标目录', copy: '复制归档，保留原文件' };
const labels = { ready:'等待确认',dispatching:'正在通知 Agent',queued:'已发送，等待 Agent',awaiting_agent:'等待发送指令',running:'真实整理中',submitted:'网盘处理中',completed:'网盘执行成功',partial:'部分完成',failed:'执行失败',needs_review:'需要处理',delivery_unknown:'送达状态未知',demo:'离线演示' };
async function api(url, options) { const r = await fetch(url, options); const d = await r.json(); if (!r.ok) throw new Error(d.error || '读取失败'); return d; }
function step(n) { for (let i=1;i<=3;i++) $(`step${i}`).hidden=i!==n; document.querySelectorAll('nav span').forEach(e=>e.classList.toggle('active',Number(e.dataset.step)===n)); }
function stats() {
  const s=data.stats, values=[['总素材',s.total+' 项'],['照片',s.photo+' 张'],['视频',s.video+' 段'],['其他',s.other+' 项'],['总容量',(s.bytes/1024**3).toFixed(2)+' GB'+(s.unknownSize?' + 未知':'')]];
  values.filter(([k])=>!(k==='视频'&&!s.video)&&!(k==='其他'&&!s.other)).forEach(([k,v])=>{const e=text('div','', 'stat');e.append(text('span',k),text('b',v));$('stats').append(e);});
}
function buildPlan() {
  $('title').textContent=data.title; document.title=data.title+' · 整理网盘文件'; $('source').textContent=data.source.path;
  $('mode').textContent=data.mode==='demo'?'演示素材 · 不连接网盘':'本地工作区';$('method').textContent=methodName[data.method];
  stats();data.rules.forEach(r=>$('rules').append(text('li',r)));
  $('scope').textContent=`整理范围：${data.source.path} · ${data.stats.total} 项素材 · ${methodName[data.method]} · 目标：${data.target.path}`;
  $('confirm-scope').textContent=$('scope').textContent;
  $('folder-summary').textContent=`${data.groups.length} 个最末级文件夹，共 ${data.stats.total} 项素材；保留原名，单独列出方案中要求的改名。`;
  for(const g of data.groups){const e=text('div','', 'tree-group');const row=text('div','','tree-leaf');row.append(text('b','▱ '+g.path.at(-1)),text('span',g.count+' 项'));e.append(text('div',g.path.slice(0,-1).join(' / '),'tree-path'),row);$('tree').append(e);}
  if(data.mode==='demo') $('confirm').textContent='演示确认（不操作网盘）';
  if(!data.ready){$('confirm').disabled=true;$('confirm').textContent='等待 Agent 完成方案校验';}
}
function cover(item, cls) {
  const e=text('div','',cls);
  if(item.thumbnail){const img=document.createElement('img');img.src='/'+item.thumbnail;img.alt=item.newName||item.filename;img.loading='eager';img.addEventListener('error',()=>{img.remove();e.textContent=item.media==='video'?'▶':'▧';},{once:true});e.append(img);}else{e.textContent=(item.media==='video'?'▶ ':'')+(item.newName||item.filename).slice(0,12);}
  e.title=[...item.destination,item.newName||item.filename].join(' / ');return e;
}
function prepareScene() {
  folders.clear();$('left-folders').replaceChildren();$('right-folders').replaceChildren();$('particles').replaceChildren();
  // A subset can fly, but every file and every destination remains in the plan.
  const sampled=data.items.length<=160?data.items:Array.from({length:160},(_,n)=>data.items[Math.floor(n*data.items.length/160)]);
  $('sample-note').textContent=`以 ${sampled.length} 份不重复素材展示归档过程；分类方案覆盖全部 ${data.stats.total} 项。动画是预览，尚未操作网盘。`;
  const groups=data.groups.map(g=>({...g,side:0}));let left=0,right=0;
  for(const g of groups){g.side=left<=right?0:1;if(g.side===0)left++;else right++;const e=text('div','','folder');const head=text('div','','folder-head'),counter=text('span',`0 / ${g.count}`);head.append(text('b','▱ '+g.path.at(-1)),counter);const pile=text('div','','folder-photos');e.append(head,text('div',g.path.slice(0,-1).join(' / '),'folder-parent'),pile);$(g.side===0?'left-folders':'right-folders').append(e);folders.set(g.key,{e,pile,counter,count:0,g});}
  return sampled.map((item,i)=>{const e=cover(item,'particle '+item.media);$('particles').append(e);const z=1-2*(i+.5)/sampled.length;const r=Math.sqrt(1-z*z);const angle=i*Math.PI*(3-Math.sqrt(5));return{item,e,x:Math.cos(angle)*r,y:z,z:Math.sin(angle)*r,rotation:(i*29%44)-22,flying:false};});
}
function animate() {
  cancelAnimationFrame(animationFrame);flightGeneration++;const generation=flightGeneration;const particles=prepareScene();animating=true;
  $('replay').hidden=true;$('final').hidden=true;$('progress-bar').style.width='0%';$('animation-title').textContent='让回忆慢慢归位。';
  const started=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,duration=reduced?1200:13000;
  function finish(){animating=false;$('replay').hidden=false;$('progress-bar').style.width='100%';$('animation-title').textContent='杂乱的素材，现在井井有条。';$('preview-count').textContent=data.stats.total;for(const f of folders.values()){f.counter.textContent=f.g.count+' 项';}if(!data.status||data.status.status==='ready')$('final').hidden=false;}
  function frame(t){if(generation!==flightGeneration)return;const p=Math.min(1,(t-started)/duration),width=$('globe').clientWidth,height=$('globe').clientHeight,rotation=(t-started)/11000;
    for(let i=0;i<particles.length;i++){const q=particles[i],threshold=.20+.64*i/Math.max(1,particles.length-1),flight=Math.max(0,Math.min(1,(p-threshold)/.14));
      const x=q.x*Math.cos(rotation)-q.z*Math.sin(rotation),z=q.x*Math.sin(rotation)+q.z*Math.cos(rotation),depth=.72+.28*(z+1)/2;
      let dx=x*width*.41,dy=q.y*height*.37,scale=depth,opacity=.5+.5*(z+1)/2;
      if(flight>0){const target=folders.get(q.item.group),a=target.pile.getBoundingClientRect(),b=$('globe').getBoundingClientRect(),ease=1-(1-flight)**3;const tx=a.left+a.width*.5-(b.left+width*.5),ty=a.top+Math.min(45,a.height*.5)-(b.top+height*.48);dx+=(tx-dx)*ease;dy+=(ty-dy)*ease;scale*=1-.5*ease;if(flight===1){q.e.hidden=true;if(!q.flying){q.flying=true;target.count++;target.counter.textContent=target.count+' 预览 / '+target.g.count;const m=cover(q.item,'mini');const img=m.querySelector('img');if(img){img.style.width='100%';img.style.height='100%';img.style.objectFit='cover';}target.pile.append(m);}}}
      q.e.style.transform=`translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${scale}) rotate(${q.rotation}deg)`;q.e.style.opacity=opacity;q.e.style.zIndex=Math.round((z+1)*100);
    }
    $('progress-bar').style.width=(p*100)+'%';$('preview-count').textContent=Math.round(data.stats.total*(1-p));if(p<1)animationFrame=requestAnimationFrame(frame);else finish();
  }animationFrame=requestAnimationFrame(frame);
}
async function renderJob(s) {
  data.status=s; if(s.status==='ready')return;
  $('job').hidden=false;$('final').hidden=true;$('job-label').textContent=labels[s.status]||s.status;$('job-phase').textContent=s.phase||'';$('request').textContent=s.requestId?'请求编号 '+s.requestId:'';
  const c=s.serviceCounts;$('job-counts').textContent=c?`计划素材 ${data.stats.total} 项。网盘返回：成功 ${c.success??'未知'} 项操作，失败 ${c.failed??'未知'}，跳过 ${c.skipped??'未知'}。操作数可能包含目录。`:'';
  $('job-error').textContent=s.error||'';$('job-notice').textContent=s.notice||'';
  let result;try{result=new URL(s.resultLink);if(!['https:','http:'].includes(result.protocol))result=null;}catch{}$('result-link').hidden=!result;if(result)$('result-link').href=result.href;
  $('manual').hidden=s.status!=='awaiting_agent';if(s.status==='awaiting_agent'){const d=await api('/api/agent-command');$('command').value=d.command;}
}
async function confirm(){if(animating)return;$('confirm').disabled=true;$('error').textContent='';try{await renderJob(await api('/api/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:data.csrf,planDigest:data.planDigest})}));}catch(e){$('error').textContent=e.message;$('confirm').disabled=false;}}
$('logic-next').onclick=()=>step(2);$('plan-back').onclick=()=>step(1);$('preview').onclick=()=>{step(3);animate();};$('replay').onclick=animate;$('confirm').onclick=confirm;
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('command').value);$('copy').textContent='已复制，请发送到当前 Agent';}catch{$('command').focus();$('command').select();$('copy').textContent='请复制选中的指令';}};
(async()=>{try{data=await api('/api/view');buildPlan();if(data.status.status!=='ready'){step(3);await renderJob(data.status);$('replay').hidden=false;$('sample-note').textContent='已恢复本次确认与执行状态。重播只展示预览，不会重复提交。';}pollTimer=setInterval(async()=>{if(data.status.status==='ready'||data.mode==='demo')return;try{await renderJob(await api('/api/status'));}catch(e){$('error').textContent='状态暂时无法读取：'+e.message;}},2500);}catch(e){$('error').textContent='无法读取方案：'+e.message;}})();
window.addEventListener('pagehide',()=>{clearInterval(pollTimer);cancelAnimationFrame(animationFrame);});
