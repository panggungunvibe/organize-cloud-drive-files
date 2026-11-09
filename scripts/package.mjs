import { mkdtemp, mkdir, cp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { skillRoot, readJSON, run } from './lib.mjs';

const temp=await mkdtemp(path.join(os.tmpdir(),'organize-skill-package-'));
try{
  const name='organize-cloud-drive-files',root=path.join(temp,name);
  await mkdir(root);
  for(const entry of ['SKILL.md','agents','scripts','references','assets','LICENSE','README.md','package.json','tests'])await cp(path.join(skillRoot,entry),path.join(root,entry),{recursive:true,verbatimSymlinks:true});
  async function rejectLinks(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw new Error('发布包禁止符号链接');if(e.isDirectory())await rejectLinks(path.join(dir,e.name));}}
  await rejectLinks(root);
  const pkg=await readJSON(path.join(skillRoot,'package.json')),dest=path.join(skillRoot,'dist',`${name}-${pkg.version}.zip`);
  await mkdir(path.dirname(dest),{recursive:true});await rm(dest,{force:true});
  await run('zip',['-q','-r',dest,name],{cwd:temp});console.log(dest);
}finally{await rm(temp,{recursive:true,force:true});}
