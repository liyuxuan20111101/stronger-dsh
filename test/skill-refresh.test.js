import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Workspace,wireWorkspace} from '../lib/workspace.js';

test('refreshing local skills updates native discovery, keeps switches and invalidates old catalog pages',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'skill-refresh-'));
 const root=path.join(dir,'skill-library');await mkdir(root);const manifest=rows=>writeFile(path.join(root,'index.json'),JSON.stringify({version:1,skills:rows}));
 await mkdir(path.join(root,'local-planning'));await writeFile(path.join(root,'local-planning/SKILL.md'),'Planning process');await manifest([{name:'local-planning',description:'Plan a local task'}]);
 const w=new Workspace(dir);await w.load();const registered=new Map(),cleanup=[];
 const ctx={skills:{register:s=>{registered.set(s.name,s);return()=>registered.delete(s.name);}},on(){},effect:fn=>{const off=fn();if(off)cleanup.push(off);},inject(keys,fn){if(keys.every(key=>ctx[key]))fn(ctx);}};wireWorkspace(ctx,w);
 try{
  const previous=w.skillCatalog({limit:1});assert.equal(w.view().builtinSkills.find(s=>s.name==='local-planning').origin,'library');assert(registered.has('local-planning'));
  await w.builtinSkill('local-planning',false);await mkdir(path.join(root,'local-checking'));await writeFile(path.join(root,'local-checking/SKILL.md'),'Checking process');await manifest([{name:'local-planning',description:'Plan a local task'},{name:'local-checking',description:'Check a local task'}]);
  await w.reloadSkills();assert(!registered.has('local-planning'));assert(registered.has('local-checking'));assert.equal(w.skillCatalog({query:'local-checking'}).skills[0].source,'library');assert.throws(()=>w.skillCatalog({offset:1,revision:previous.revision}),/已更新/);
  await writeFile(path.join(root,'index.json'),'{broken');const failure=await w.reloadSkills();assert(failure.skillLibraryError);assert(!registered.has('local-checking'));assert.equal(await readFile(path.join(root,'local-checking/SKILL.md'),'utf8'),'Checking process');
 }finally{for(const off of cleanup.reverse())await off();await w.dispose();await rm(dir,{recursive:true,force:true});}
});

test('skill search separates imported skills and builtins, preserves actions and matches all search words',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.SkillLibraryControls=SkillLibraryControls;return {name:'dsh-ui-stronger',inject:");const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?React:{})}};vm.runInNewContext(source,{window:win});
 const skills=[{name:'local-plan',description:'Plan a learning path',origin:'library',enabled:true},{name:'context-handoff',description:'Save a task handoff',enabled:false}];
 const panel=query=>renderToStaticMarkup(React.createElement(win.SkillLibraryControls,{skills,query,busy:false,onQuery(){},onReload(){},onToggle(){}}));
 const full=panel('');assert.match(full,/本机导入 · 1/);assert.match(full,/内置技能 · 1/);assert.match(full,/刷新目录/);assert.match(full,/aria-checked="true"/);const filtered=panel('LOCAL learning');assert.match(filtered,/local-plan/);assert.doesNotMatch(filtered,/context-handoff/);assert.match(filtered,/内置技能 · 0/);
});
