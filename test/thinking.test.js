import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ThinkingStore,THINK_SKILL,thinkingTool,retrieve} from '../lib/thinking.js';
async function fixture(run){const dir=await mkdtemp(path.join(tmpdir(),'thinking-test-'));try{await run(new ThinkingStore(dir),dir);}finally{await rm(dir,{force:true,recursive:true});}}
test('thinking persists revisions, rejects stale writes and preserves note history',()=>fixture(async(s,dir)=>{
 let b=await s.run('create',{title:'学习因果'});b=await s.run('add',{id:b.id,revision:b.revision,collection:'notes',title:'理解',text:'相关未必因果'});const old=b.revision;
 b=await s.run('edit',{id:b.id,revision:b.revision,collection:'notes',itemId:b.notes[0].id,text:'需要排查共同原因'});assert.equal(b.notes[0].versions[0].text,'相关未必因果');
 await assert.rejects(s.run('update',{id:b.id,revision:old,patch:{summary:'覆盖'}}),/其他窗口/);assert.equal((await s.run('get',{id:b.id})).summary,'');
 const restored=new ThinkingStore(dir);assert.equal((await restored.run('get',{id:b.id})).notes[0].text,'需要排查共同原因');assert.equal(JSON.parse(await readFile(path.join(dir,'thinking.json'),'utf8')).schema,1);
}));
test('context contains only explicitly selected memories and cited lexical hits',()=>fixture(async s=>{
 let b=await s.run('create',{title:'因果关系'});const call=(op,p)=>s.run(op,{id:b.id,revision:b.revision,...p}).then(x=>(b=x));
 await call('add',{collection:'memories',title:'私密',text:'不应注入的记忆'});await call('add',{collection:'materials',title:'因果教材.md',text:'共同原因导致两个变量相关。'.repeat(2000)});
 let prompt=await s.run('prompt',{id:b.id,action:'decompose',query:'共同原因'});assert.equal(prompt.hits.length,0);assert.doesNotMatch(prompt.prompt,/不应注入/);
 await call('edit',{collection:'materials',itemId:b.materials[0].id,selected:true});prompt=await s.run('prompt',{id:b.id,action:'repeat',query:'共同原因'});assert(prompt.hits.length>0);assert.equal(prompt.hits[0].source,'因果教材.md');assert.equal(typeof prompt.hits[0].offset,'number');assert.match(prompt.prompt,/^\/think/);assert.doesNotMatch(prompt.prompt,/不应注入/);
 assert.equal(retrieve([{selected:false,text:'共同原因',title:'未选'}],'共同原因').length,0);
}));
test('agent access is session-bound; proposals require review and cannot overwrite notes',()=>fixture(async s=>{
 let b=await s.run('create',{title:'决策'});await assert.rejects(s.agent({action:'read',id:b.id},'session-a'),/没有获得/);
 b=await s.run('update',{id:b.id,revision:b.revision,patch:{sessionId:'session-a',aiAccess:true}});
 await assert.rejects(s.agent({action:'read',id:b.id},'session-b'),/没有获得/);await assert.rejects(s.agent({action:'update',id:b.id},'session-a'),/只允许/);
 await s.agent({action:'propose',id:b.id,title:'待确认',text:'模型提出的解释'},'session-a');b=await s.run('get',{id:b.id});assert.equal(b.notes.length,0);assert.equal(b.proposals.length,1);
 b=await s.run('review',{id:b.id,revision:b.revision,proposalId:b.proposals[0].id,accept:true});assert.equal(b.notes[0].text,'模型提出的解释');assert.equal(b.proposals.length,0);
 const tool=thinkingTool(s);assert.equal(tool.output.schema.type,'string');assert.match(await tool.execute({action:'read',id:b.id},{agent:{session:{id:'session-a'}},signal:new AbortController().signal}),/决策/);assert.equal(THINK_SKILL.name,'think');
}));
test('merge import regenerates IDs, clears authorization and does not modify source backup',()=>fixture(async s=>{
 let b=await s.run('create',{title:'原记录'});b=await s.run('update',{id:b.id,revision:b.revision,patch:{sessionId:'one',aiAccess:true}});const backup=await s.run('backup');const result=await s.run('import',{document:backup});const imported=await s.run('get',{id:result.ids[0]});assert.notEqual(imported.id,b.id);assert.equal(imported.aiAccess,false);assert.equal(imported.sessionId,'');assert.equal(backup.boards[0].aiAccess,true);
 const curio=await s.run('import',{document:{format:'curio-project',schema_version:2,project:{title:'Curio 原问题',card:{goal:'理解统计',constraints:'',questions:[]},messages:[{role:'user',content:'请举例'}]}}});const old=await s.run('get',{id:curio.ids[0]});assert.equal(old.summary,'理解统计');assert.match(old.notes[1].text,/请举例/);
 await assert.rejects(s.run('import',{document:{format:'curio-project',schema_version:99}}),/请选择/);
}));
test('concept validation is transactional and concurrent changes cannot lose data',()=>fixture(async s=>{
 let b=await s.run('create',{title:'概念'});await assert.rejects(s.run('update',{id:b.id,revision:0,patch:{graph:{nodes:[{id:'a',text:'A'}],edges:[{from:'a',to:'missing'}]}}}),/不存在/);assert.equal((await s.run('get',{id:b.id})).revision,0);
 const results=await Promise.allSettled([s.run('update',{id:b.id,revision:0,patch:{summary:'一'}}),s.run('update',{id:b.id,revision:0,patch:{summary:'二'}})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await s.run('get',{id:b.id})).revision,1);
}));
