import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { initWorkspace } from '../scripts/init-workspace.mjs';
import { importPlan } from '../scripts/import-plan.mjs';
import { createOrganizer } from '../scripts/serve.mjs';
import { parseResult, updateStatus } from '../scripts/status.mjs';
import { readJSON, privatePath, validatePlan, digest, writeJSON } from '../scripts/lib.mjs';
import { buildLeaves, splitLeaves, selectPreviewAssets, globePlacement } from '../assets/web/gallery.js';
import { createLocalPreview } from '../scripts/demo.mjs';

const plan = () => ({version:1,title:'测试相册',mode:'live',method:'move_in_place',source:{fid:'root',path:'/样例'},target:{fid:'root',path:'/样例'},rules:['按内容归类'],validation:{ready:true,providerDigest:'provider-check-1',proposalPath:'/fictional-task/proposal.json',taskDir:'/fictional-task',executionSupported:true},items:[{id:'one',fid:'root|f1',parentFid:'root',filename:'a.jpg',media:'photo',size:null,destination:['城市 A','照片','风景']},{id:'two',fid:'root|f2',parentFid:'root',filename:'b.mp4',media:'video',size:1024,destination:['未知','视频','片段']}]});
const raw = (overrides={}) => ({code:0,msg:'成功',action:'file_organize_apply',type:'result',data:{task_dir:'/fictional-task',operations_finished:true,summary:{success_count:4,fail_count:0,skip_count:0},detail_url:'https://example.com/result',...overrides}});
async function fixture(t, options={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'organize-test-'));
  await initWorkspace(dir,{bridge:'manual'});await importPlan(dir,options.plan||plan());
  const server=await createOrganizer(dir,options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const view=await fetch(url+'/api/view').then(r=>r.json());
  const confirm=(changes={},headers={})=>fetch(url+'/api/confirm',{method:'POST',headers:{Origin:url,'Content-Type':'application/json',...headers},body:JSON.stringify({csrf:view.csrf,planDigest:view.planDigest,...changes})});
  return {dir,server,url,view,confirm};
}

test('identity, collisions, traversal and missing validation are rejected',()=>{
  let p=plan();p.items[1].fid='different-prefix|f1';assert.throws(()=>validatePlan(p),/身份重复/);
  p=plan();p.items[1].filename='a.jpg';p.items[1].destination=p.items[0].destination;assert.throws(()=>validatePlan(p),/重名/);
  p=plan();p.items[0].destination=['..'];assert.throws(()=>validatePlan(p));
  p=plan();p.items[0].thumbnail='thumbs/../../secret.png';assert.throws(()=>validatePlan(p));
  p=plan();delete p.validation.taskDir;assert.throws(()=>validatePlan(p));
  p=plan();p.target.fid='other';assert.throws(()=>validatePlan(p));
  const changed=plan();changed.items[0].newName='renamed.jpg';assert.notEqual(digest(changed),digest(plan()));
});
test('public view strips identities; private files and foreign host are inaccessible',async t=>{
  const f=await fixture(t);assert.equal(f.view.items.length,2);assert.equal(f.view.items[0].fid,undefined);assert.equal(f.view.source.fid,undefined);assert.equal(f.view.stats.unknownSize,1);
  assert.equal((await fetch(f.url+'/private/plan.json')).status,404);
  for (const resource of ['/app.js','/gallery.js','/style.css']) assert.equal((await fetch(f.url+resource)).status,200);
  const foreignHostStatus=await new Promise((resolve,reject)=>{const req=http.get(f.url+'/api/view',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(foreignHostStatus,403);
  assert.equal((await f.confirm({}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await f.confirm({csrf:'bad'})).status,403);
  assert.equal((await f.confirm({planDigest:'old'})).status,409);
});
test('manual confirmation persists, duplicate does not resubmit, changed plan is blocked',async t=>{
  let calls=0;const f=await fixture(t,{dispatch:()=>{calls++;}});
  const result=await f.confirm().then(r=>r.json());assert.equal(result.status,'awaiting_agent');
  const again=await f.confirm().then(r=>r.json());assert.equal(again.requestId,result.requestId);assert.equal(calls,0);
  const command=await fetch(f.url+'/api/agent-command').then(r=>r.json());assert.ok(command.command.includes(result.requestId));
  assert.equal((await fetch(f.url+'/api/status').then(r=>r.json())).status,'awaiting_agent');
  assert.equal((await importPlan(f.dir,plan())).changed,false);
  const p=plan();p.rules.push('修订');await assert.rejects(importPlan(f.dir,p),/已有确认/);
});
test('demo cannot queue or save live approval',async t=>{
  const p=plan();p.mode='demo';let calls=0;const f=await fixture(t,{plan:p,bridge:{available:true},dispatch:()=>{calls++;}});
  assert.equal((await f.confirm().then(r=>r.json())).status,'demo');assert.equal(calls,0);assert.equal(await readJSON(privatePath(f.dir,'approval'),null),null);
});
test('unvalidated preview cannot execute',async t=>{
  const p=plan();p.validation.ready=false;const f=await fixture(t,{plan:p});assert.equal(f.view.ready,false);assert.equal((await f.confirm()).status,409);
});
test('queue deduplicates and delivery uncertainty does not trigger automatic retry',async t=>{
  let calls=0;const f=await fixture(t,{bridge:{available:true},dispatch:async()=>{calls++;throw new Error('timeout');}});
  assert.equal((await f.confirm().then(r=>r.json())).status,'delivery_unknown');
  await f.confirm();assert.equal(calls,1);
});
test('fast Agent result cannot be overwritten by queue completion',async t=>{
  let dir;const f=await fixture(t,{bridge:{available:true},dispatch:async()=>{
    const approval=await readJSON(privatePath(dir,'approval'));
    await updateStatus(dir,approval.requestId,parseResult(JSON.stringify(raw())));
  }});dir=f.dir;
  const s=await f.confirm().then(r=>r.json());assert.equal(s.status,'completed');assert.equal(s.total,2);assert.equal(s.serviceCounts.success,4);
  await assert.rejects(updateStatus(dir,s.requestId,{status:'running'}),/已结束/);
});
test('result parser distinguishes receipt from execution and retains raw counts',()=>{
  assert.equal(parseResult(JSON.stringify(raw({operations_finished:false}))).status,'submitted');
  let result=parseResult(JSON.stringify({result:raw({summary:{success_count:666,fail_count:0}})}));assert.equal(result.status,'completed');assert.equal(result.serviceCounts.success,666);assert.equal(result.serviceCounts.skipped,null);assert.equal(result.fileCounts,undefined);
  result=parseResult(JSON.stringify(raw({summary:{success_count:0,fail_count:3}})));assert.equal(result.status,'failed');
  result=parseResult('progress text\n'+JSON.stringify(raw({error:'server error'})));assert.equal(result.status,'needs_review');assert.equal(result.error,'server error');
  assert.throws(()=>parseResult(JSON.stringify({code:0,action:'get-user-info',data:{}})));
  assert.throws(()=>parseResult(JSON.stringify({...raw(),action:'file_organize_check'})));
});
test('result must belong to the approved provider task',async t=>{
  const f=await fixture(t),s=await f.confirm().then(r=>r.json());
  await assert.rejects(updateStatus(f.dir,'wrong',{status:'running'}),/不匹配/);
  await assert.rejects(updateStatus(f.dir,s.requestId,parseResult(JSON.stringify(raw({task_dir:'/other-task'})))),/不属于/);
  await updateStatus(f.dir,s.requestId,{status:'running',phase:'正在执行'});
  const p=plan();p.rules.push('篡改');await writeJSON(privatePath(f.dir,'plan'),p);
  await assert.rejects(updateStatus(f.dir,s.requestId,parseResult(JSON.stringify(raw()))),/指纹不匹配/);
});
test('external symlink thumbnails are neither imported nor served',async t=>{
  const f=await fixture(t),secret=path.join(f.dir,'private','secret.svg');await writeFile(secret,'secret');
  await symlink(secret,path.join(f.dir,'public/thumbs','outside.svg'));
  assert.equal((await fetch(f.url+'/thumbs/outside.svg')).status,409);
  const p=plan();p.items[0].thumbnail='thumbs/outside.svg';await assert.rejects(importPlan(f.dir,p),/超出/);
});

test('original gallery uses exact destinations and supports albums without video',()=>{
  const items=Array.from({length:230},(_,i)=>({id:'f'+i,filename:'same-name.jpg',media:'photo',destination:i%5===0?['少量目录','人物']:['大目录','风景'],thumbnail:'thumbs/'+i+'.jpg',coverKey:i<2?'same-cover':String(i)}));
  const leaves=buildLeaves(items);assert.equal(leaves.reduce((n,l)=>n+l.count,0),230);
  assert.equal(leaves[0].count,46);assert.equal(leaves[1].count,184);
  const split=splitLeaves(leaves);assert.equal(split.left.length+split.right.length,2);assert.ok(!split.rightTitle.includes('视频'));
  const sample=selectPreviewAssets(items);assert.equal(sample.length,180);assert.equal(new Set(sample.map(i=>i.coverKey)).size,180);
  assert.equal(new Set(sample.map(i=>JSON.stringify(i.destination))).size,2);
  for(let i=0;i<sample.length;i++){const p=globePlacement(i,sample.length);assert.ok(p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100);}
});
test('local preview loads only supplied media and preserves real counts and filenames',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'own-album-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const album=path.join(root,'my-photos'),workspace=path.join(root,'web');await mkdir(path.join(album,'已有分类'),{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXKsAAAAASUVORK5CYII=','base64');
  await writeFile(path.join(album,'已有分类','one.png'),png);await writeFile(path.join(album,'two.png'),png);
  await writeFile(path.join(album,'readme.txt'),'not a media file');
  await createLocalPreview(workspace,album);
  const p=await readJSON(privatePath(workspace,'plan'));assert.equal(p.mode,'demo');assert.equal(p.items.length,2);
  assert.deepEqual(p.items.map(i=>i.filename).sort(),['one.png','two.png']);assert.ok(p.items.every(i=>i.media==='photo'));
  const covers=await readJSON(privatePath(workspace,'covers'));assert.equal(Object.values(covers)[0],Object.values(covers)[1]);
  assert.equal(selectPreviewAssets(p.items.map(i=>({...i,coverKey:covers[i.id]}))).length,1);
});
