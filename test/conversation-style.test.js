import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {Workspace,wireWorkspace} from '../lib/workspace.js';

test('expression preference persists, native opts out, and existing persona/memory are unchanged',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'conversation-style-'));let w;
 try{w=new Workspace(dir);await w.load();const p=await w.propose('persona',{title:'Fixture',content:'Synthetic speaking preference'},{human:true});await w.persona(p.id);await w.propose('memory',{title:'Fixture fact',content:'Synthetic project fact'},{human:true});const original=structuredClone(w.state.records);assert(w.conversationFor({id:'one',header:{}}));await w.setConversationStyle('concise');await assert.rejects(w.setConversationStyle('invented'));assert.deepEqual(w.state.records,original);assert.equal(w.state.activePersona,p.id);await w.dispose();w=new Workspace(dir);await w.load();assert.equal(w.view().conversationStyle,'concise');await w.setConversationStyle('native');assert.equal(w.conversationFor({id:'one',header:{}}),'');assert.deepEqual(w.state.records,original);await w.dispose();w=null;}finally{await w?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('root conversation style is stable and does not alter child JSON reviews or tool calls',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'style-isolation-'));const w=new Workspace(dir);
 try{await w.load();let context;const cleanup=[];const ctx={systemPrompt:{context:p=>{if(p.name==='ui-stronger:conversation')context=p;}},on(){},inject(keys,fn){if(keys.every(k=>ctx[k]))fn(ctx);},effect(fn){const off=fn();if(off)cleanup.push(off);}};wireWorkspace(ctx,w);
  const root={id:'root',header:{}};const before=context.text({agent:{session:root}});root.snapshotEvents=()=>[{text:'a completely different user topic'}];assert.equal(context.text({agent:{session:root}}),before);assert.equal(context.text({}), '');assert.equal(context.text({agent:{session:{id:'child',header:{origin:'subagent',parentSession:'root'}}}}),'');w.channelFor=()=> 'isolated';assert.equal(context.text({agent:{session:root}}),'');w.channelFor=()=> 'wechat';assert.notEqual(context.text({agent:{session:root}}),before);for(const off of cleanup.reverse())await off();
 }finally{await w.dispose();await rm(dir,{recursive:true,force:true});}
});
