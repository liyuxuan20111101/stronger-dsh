import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Workspace,wireWorkspace,readSkillLibrary,conversationGuidance} from '../lib/workspace.js';
import {WechatBridge,validateInbound} from '../lib/wechat.js';

test('local skill instructions stay lazy, register in catalog, and can be disabled persistently',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'local-library-'));const root=path.join(dir,'skill-library');
 try{
  await mkdir(path.join(root,'learnpath'),{recursive:true});await writeFile(path.join(root,'index.json'),JSON.stringify({version:1,skills:[{name:'learnpath',description:'学习计划'}]}));await writeFile(path.join(root,'learnpath/SKILL.md'),'---\nname: learnpath\n---\nPRIVATE_FULL_INSTRUCTIONS');
  const w=new Workspace(dir);await w.load();const registered=new Map(),cleanup=[];const ctx={skills:{register(s){registered.set(s.name,s);return ()=>registered.delete(s.name);}},on(){},inject(keys,fn){if(keys.every(k=>ctx[k]))fn(ctx);},effect(fn){const off=fn();if(off)cleanup.push(off);}};wireWorkspace(ctx,w);assert(registered.get('learnpath').invocation.modelInvocable);assert(registered.get('learnpath').invocation.userInvocable);assert(w.view().builtinSkills.some(s=>s.name==='learnpath'&&s.enabled));assert(!JSON.stringify(w.skillCatalog()).includes('PRIVATE_FULL_INSTRUCTIONS'));assert(w.allSkills().find(s=>s.name==='learnpath').content.includes('PRIVATE_FULL_INSTRUCTIONS'));assert(!JSON.stringify(w.prompt()).includes('PRIVATE_FULL_INSTRUCTIONS'));await w.builtinSkill('learnpath',false);assert(!registered.has('learnpath'));assert.equal(w.skillCatalog({query:'learnpath'}).skills[0].status,'archived');for(const off of cleanup.reverse())await off();const again=new Workspace(dir);await again.load();assert.equal(again.view().builtinSkills.find(s=>s.name==='learnpath').enabled,false);await again.dispose();
  await writeFile(path.join(root,'index.json'),JSON.stringify({version:1,skills:[{name:'../escape',description:'x'}]}));await assert.rejects(readSkillLibrary(dir));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('malformed local library cannot overwrite existing workspace records',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'broken-library-'));
 try{const w=new Workspace(dir);await w.load();await w.propose('memory',{title:'fixture',content:'original memory'},{human:true});await w.dispose();await mkdir(path.join(dir,'skill-library'));await writeFile(path.join(dir,'skill-library/index.json'),'{broken');const again=new Workspace(dir);await again.load();assert(again.view().skillLibraryError);assert.equal(again.view().records[0].content,'original memory');await again.dispose();}finally{await rm(dir,{recursive:true,force:true});}
});

test('concurrent WeChat session creation keeps both ownership mappings and failed prompts settle pending state',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'wechat-serial-')),data=path.join(dir,'data'),cwd=path.join(dir,'work');await mkdir(cwd);await mkdir(data);
 const bridge=new WechatBridge(data,{get:()=>null});
 try{await bridge.load();await bridge.configure({enabled:true,cwd});let sequence=0;const base={listSessions:async()=>({items:[]}),createSession:async()=>{const n=++sequence;await new Promise(r=>setTimeout(r,5));return {sessionId:'wx-'+n};},prompt:async()=>{assert.equal(bridge.status().pendingInputs,1);throw Error('temporary failure');}};const client=bridge.secureClient(base);const [a,b]=await Promise.all([client.createSession({cwd}),client.createSession({cwd})]);assert(bridge.owns(a.sessionId));assert(bridge.owns(b.sessionId));assert.equal(Object.keys(JSON.parse(await readFile(path.join(data,'wechat.json'),'utf8')).sessions).length,2);await assert.rejects(client.prompt(a.sessionId,'hello'));assert.equal(bridge.status().pendingInputs,0);assert.equal(bridge.status().lastInput,null);assert.throws(()=>validateInbound([{type:'text',text:'  \n'}]));}finally{await bridge.dispose();await rm(dir,{recursive:true,force:true});}
});

test('conversation style is stable, channel aware, and forbids invented experiences',()=>{
 assert.equal(conversationGuidance('desktop'),conversationGuidance('desktop'));assert.match(conversationGuidance(),/不伪装真人/);assert.match(conversationGuidance('wechat'),/多张图片/);assert.doesNotMatch(conversationGuidance(),/当前为微信/);
});
