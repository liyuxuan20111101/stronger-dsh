import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {Intelligence,compressionTrigger,contextPolicy,policyFacade,wireIntelligence} from '../lib/intelligence.js';

const fixed=()=>contextPolicy({auto:true,triggerMode:'tokens',thresholdTokens:32000,thresholdRatio:.75});
async function fixture(run){const dir=await mkdtemp(path.join(tmpdir(),'compression-trigger-'));try{await run(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('legacy compression settings retain their automatic choice and gain validated trigger defaults',()=>{
 const old=contextPolicy({auto:false,thresholdRatio:.65,tailTokens:8192});
 assert.equal(old.auto,false);assert.equal(old.triggerMode,'ratio');assert.equal(old.thresholdTokens,32768);
 assert.equal(contextPolicy({...old,thresholdRatio:.655}).thresholdRatio,.655);
 for(const patch of [{triggerMode:'unknown'},{thresholdTokens:4095},{thresholdTokens:16000001},{thresholdTokens:8192.5},{thresholdTokens:'32000'},{thresholdRatio:.95}])assert.throws(()=>contextPolicy({...old,...patch}));
});

test('fixed trigger uses each routed capacity and reserves output without retaining more than the threshold',()=>{
 const engine={config:{thresholdRatio:.8,retainRatio:.3,modelPolicies:[{provider:'p',model:'m',retainTokens:20000}]}};
 for(const [capacity,reserved] of [[64000,4096],[1000000,32000],[32768,8192],[32768,30000]]){
  const expected=compressionTrigger(fixed(),capacity,reserved),facade=policyFacade(engine,fixed(),null,capacity,reserved),p=facade.config;
  const actual=Math.floor(Math.min(capacity*p.thresholdRatio,capacity-reserved-p.headroomTokens));
  assert.equal(actual,expected.effectiveTokens);
  assert(Math.floor((capacity-reserved)*p.retainRatio)<actual);
  assert(p.maxTokens<=4000);assert.equal(p.compactionRetries,0);
 }
 assert.equal(compressionTrigger(fixed(),1000000).effectiveTokens,32000);
 assert.equal(compressionTrigger(fixed(),64000).effectiveTokens,32000);
 assert.equal(compressionTrigger(fixed(),32768,8192).effectiveTokens,22528);
 assert(compressionTrigger(fixed(),32768,8192).limited);
 assert.equal(engine.config.thresholdRatio,.8);assert.equal(engine.config.modelPolicies[0].retainTokens,20000);
});

test('percentage trigger tracks model size and missing or exhausted capacity remains explicit',()=>{
 const policy=contextPolicy({auto:true,thresholdRatio:.655});
 assert.equal(compressionTrigger(policy,128000).effectiveTokens,83840);
 assert.equal(compressionTrigger(policy,1000000).effectiveTokens,655000);
 assert.equal(compressionTrigger(policy,null).effectiveTokens,null);
 assert.equal(compressionTrigger(policy,32768,32768).effectiveTokens,null);
 assert.match(compressionTrigger(policy,32768,32768).reason,/预留/);
});

test('policy survives restart and current threshold follows actual metadata and request output reservation',()=>fixture(async dir=>{
 const session={requestHeader:()=>({config:{provider:'p',model:'small',maxTokens:8192}}),requestContext:()=>({contextWindow:1000000})};
 const ctx={get:key=>key==='sessions'?new Map([['one',session]]):key==='llm'?{resolveModelInfo:async()=>({context:{contextWindow:32768},defaultMaxTokens:4096})}:null};
 let service=new Intelligence(dir,ctx);await service.load();await service.configure({context:fixed()});service=new Intelligence(dir,ctx);await service.load();
 const result=await service.contextStatus('one');assert.equal(result.capacity,32768);assert.equal(result.effectiveTokens,22528);
 assert.equal(service.config.context.thresholdTokens,32000);
 assert.equal((await service.contextStatus('unknown')).effectiveTokens,null);
 await assert.rejects(service.contextStatus('x'.repeat(161)));
 const prior=JSON.parse(await readFile(path.join(dir,'intelligence.json'),'utf8'));delete prior.context.triggerMode;delete prior.context.thresholdTokens;
 await writeFile(path.join(dir,'intelligence.json'),JSON.stringify(prior));
 const legacy=new Intelligence(dir,ctx);await legacy.load();assert.equal(legacy.config.context.triggerMode,'ratio');assert.equal(legacy.config.context.auto,true);
}));

test('native pressure hook receives fixed targets for different models and manual mode preserves overflow recovery',()=>fixture(async dir=>{
 const ctx=new Context(),calls=[];
 const engine={config:{auto:true,thresholdRatio:.8,modelPolicies:[]},compactIfNeeded:async function(agent,trigger){const capacity=agent.session.requestHeader().config.model==='small'?64000:1000000;calls.push({trigger,threshold:Math.floor(capacity*this.config.thresholdRatio)});return 'native';},summarize:async()=>''};
 ctx.provide('compaction',engine);ctx.provide('llm',{resolveModelInfo:async(_provider,model)=>({context:{contextWindow:model==='small'?64000:1000000},defaultMaxTokens:4096})});
 const service=new Intelligence(dir,ctx);await service.load();const original=engine.compactIfNeeded;
 const fiber=ctx.plugin({apply:scope=>wireIntelligence(scope,service)});await fiber;
 try{
  await service.configure({context:fixed()});
  for(const model of ['small','large'])await engine.compactIfNeeded({session:{requestContext:()=>({contextWindow:1000000}),requestHeader:()=>({config:{provider:'p',model}})}},'pressure');
  assert.deepEqual(calls.map(c=>c.threshold),[32000,32000]);
  await service.configure({context:{...fixed(),auto:false}});
  const agent={session:{requestContext:()=>({contextWindow:64000}),requestHeader:()=>({config:{provider:'p',model:'small'}})}};
  assert.equal(await engine.compactIfNeeded(agent,'pressure'),null);assert.equal(calls.length,2);
  assert.equal(await engine.compactIfNeeded(agent,'context-overflow'),'native');assert.equal(calls.at(-1).trigger,'context-overflow');
 }finally{await fiber.dispose();assert.equal(engine.compactIfNeeded,original);}
}));

test('first legacy write preserves exact old settings for rollback without overwriting the backup',()=>fixture(async dir=>{
 const old={version:1,context:{auto:false,thresholdRatio:.7,tailTokens:8192},routingEnabled:false,routes:Object.fromEntries(['subagent','search','operations','summary','review'].map(role=>[role,null])),tasks:{}};
 const raw=JSON.stringify(old,null,2);await writeFile(path.join(dir,'intelligence.json'),raw);
 const service=new Intelligence(dir,{get:()=>null});await service.load();
 await service.configure({context:fixed()});
 const backups=(await readdir(dir)).filter(name=>name.startsWith('intelligence.pre-threshold-'));assert.equal(backups.length,1);assert.equal(await readFile(path.join(dir,backups[0]),'utf8'),raw);
 await service.configure({context:{...fixed(),thresholdTokens:64000}});assert.equal(await readFile(path.join(dir,backups[0]),'utf8'),raw);
}));
