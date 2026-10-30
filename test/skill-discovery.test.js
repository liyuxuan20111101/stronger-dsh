import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Workspace,wireWorkspace} from '../lib/workspace.js';
async function fixture(fn){const dir=await mkdtemp(path.join(tmpdir(),'skill-discovery-'));const w=new Workspace(dir);await w.load();try{await fn(w);}finally{await w.dispose();await rm(dir,{recursive:true,force:true});}}
test('private skill discovery and body loads recheck channel, workspace, approval and candidate revision',()=>fixture(async w=>{
 let provider,invalidations=0;const cleanup=[];const services={skills:{register:()=>()=>{},registerProvider:create=>{provider=create({invalidate(){invalidations++;}});return ()=>{};}}};const ctx={get:k=>services[k],on(){},inject(keys,fn){if(keys.every(k=>services[k]))fn({...services,effect:fn=>cleanup.push(fn())});},effect:fn=>cleanup.push(fn())};wireWorkspace(ctx,w);w.channelFor=id=>id==='wx'?'wechat':'desktop';
 const skill=await w.propose('skill',{name:'local-statistics',title:'Compare',description:'比较统计数据',content:'Verify sampling first',scope:'workspace'},{human:true,cwd:'/one'});
 const opts=(id,cwd='/one')=>({scope:{session:{id}},cwd});
 assert.equal((await provider.list(opts('main','/two'))).candidates.length,0);assert.equal((await provider.list(opts('wx'))).candidates.length,0);assert.equal((await provider.list({cwd:'/one'})).candidates.length,0);
 const observation=await provider.list(opts('main')),candidate=observation.candidates[0];assert.equal(observation.complete,false,'private candidates must not be reused by host cache across sessions');assert.equal(candidate.content,undefined);assert.equal((await provider.get(candidate,opts('main'))).content,skill.content);assert.equal(await provider.get(candidate,opts('wx')),undefined);
 await w.edit(skill.id,{description:'改为比较抽样',content:'Verify sample and missing values'});assert.equal(await provider.get(candidate,opts('main')),undefined,'stale candidate cannot load changed instructions');const fresh=(await provider.list(opts('main'))).candidates[0];assert.match((await provider.get(fresh,opts('main'))).content,/missing values/);await w.decide(skill.id,'archived');assert.equal(await provider.get(fresh,opts('main')),undefined);assert(invalidations>=3);
 for(const off of cleanup.reverse())await off?.();
}));
test('skill search returns bounded summaries with explicit continuation and refuses stale pages',()=>fixture(async w=>{
 for(let i=0;i<26;i++)await w.propose('skill',{name:'local-stat-'+i,title:'stat'+i,description:'统计 sampling '+i,content:'PRIVATE BODY '+i},{human:true});
 const page=w.skillCatalog({query:'统计',limit:12});assert.equal(page.total,26);assert.equal(page.skills.length,12);assert.equal(page.nextOffset,12);assert(!JSON.stringify(page).includes('PRIVATE BODY'));assert.equal(w.skillCatalog({query:'统计',limit:12,offset:12,revision:page.revision}).skills.length,12);
 await w.builtinSkill('think',false);assert.throws(()=>w.skillCatalog({query:'统计',offset:12,revision:page.revision}),/已更新/);assert.throws(()=>w.skillCatalog({limit:999}));assert.throws(()=>w.skillCatalog({offset:-1}));assert.equal(w.skillCatalog({query:'absent-term'}).total,0);
}));
