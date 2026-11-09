import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { args, isMain } from './lib.mjs';
import { initWorkspace } from './init-workspace.mjs';
import { importPlan } from './import-plan.mjs';

export async function createDemo(dir) {
  dir = path.resolve(dir);
  await initWorkspace(dir, { title: '散落的旅行记忆', bridge: 'manual' });
  const items = [];
  for (let i=0;i<144;i++) {
    const id=`sample-${String(i+1).padStart(3,'0')}`, hue=(i*137.508)%360;
    // Every thumbnail is a distinct numbered abstract composition, never a personal photo.
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="hsl(${hue},27%,${42+i%25}%)"/><circle cx="${20+i*7%130}" cy="${20+i*11%100}" r="${18+i%28}" fill="hsl(${(hue+40)%360},40%,80%)"/><path d="M0 160 L${i*13%150} ${55+i%70} L160 160Z" fill="hsl(${(hue+180)%360},18%,28%)"/><text x="9" y="142" font-family="monospace" font-size="13" fill="white">SAMPLE ${i+1}</text></svg>`;
    await writeFile(path.join(dir,'public/thumbs',id+'.svg'),svg);
    const media=i%9===0?'video':i%23===0?'other':'photo',city=['城市 A','海岸 B','未知'][i%3],theme=['人物','建筑','自然风景','日常片段'][Math.floor(i/3)%4];
    items.push({id,fid:'fictional-'+id,parentFid:'fictional-root',filename:id+(media==='video'?'.mp4':media==='other'?'.pdf':'.jpg'),media,size:1024000+i*1024,destination:[city,media==='photo'?'照片':media==='video'?'视频':'其他',media==='other'?'资料':theme],thumbnail:'thumbs/'+id+'.svg'});
  }
  await importPlan(dir,{version:1,title:'散落的旅行记忆',mode:'demo',method:'move_in_place',source:{fid:'fictional-root',path:'/演示相册'},target:{fid:'fictional-root',path:'/演示相册'},rules:['先按可靠的拍摄地点或内容分组；证据不足的放入未知','各地点下分开照片、视频和其他文件','最后按主题归档，保留原文件名'],validation:{ready:true,executionSupported:true},items});
  return dir;
}
if(isMain(import.meta.url)){
  const a=args(),dir=await createDemo(a.dir||'.demo');
  console.log('演示素材已生成，全部为虚构图案，无网盘操作能力。');
  const {createOrganizer}=await import('./serve.mjs');
  const server=await createOrganizer(dir);
  server.listen(a.port?Number(a.port):0,'127.0.0.1',()=>console.log(`演示页面：http://127.0.0.1:${server.address().port}/`));
}
