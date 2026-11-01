import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelCatalog,wireModelCatalog} from '../lib/model-catalog.js';

function fixture(){
 let stalled=true,slowReads=0;
 const llm={listProviders:()=>[{id:'fast',name:'Fast'},{id:'slow',name:'Slow'}],listModels:async id=>{if(id==='slow'){slowReads++;if(stalled)return new Promise(()=>{});}return [{id:'one',name:'One'}];},resolveModelInfo:async()=>({reasoning:{efforts:[{id:'mid',name:'Medium'}],defaultEffort:'mid'}})};
 const ctx={get:key=>({llm,agentDefaultModel:{currentSelection:()=>({provider:'fast',model:'one'})}}[key])};
 return {ctx,llm,recover:()=>{stalled=false;},reads:()=>slowReads};
}
test('stalled provider cannot hide healthy models, duplicate reads share work and errors do not leak credentials',async()=>{
 const f=fixture(),catalog=createModelCatalog(f.ctx,{timeout:20});
 const a=catalog.load(),b=catalog.load();assert.equal(a,b);
 const result=await a;assert.deepEqual(result.groups.map(p=>p.id),['fast']);assert.deepEqual(result.default,{provider:'fast',model:'one'});assert.equal(result.failures[0].id,'slow');assert.equal(result.groups[0].models[0].reasoning.defaultEffort,'mid');
 assert.equal(f.reads(),1,'concurrent reads share one adapter operation');
 f.recover();assert.equal((await catalog.load()).groups.length,2,'explicit retry after timeout can recover without an adapter-change event');
 f.llm.listModels=async()=>{throw Error('secret-api-key');};catalog.invalidate();assert.doesNotMatch(JSON.stringify(await catalog.load()),/secret-api-key/);catalog.dispose();await assert.rejects(catalog.load(),/关闭/);
});
test('late old generation cannot overwrite a fresh provider catalog or default',async()=>{
 const f=fixture();let release;
 f.llm.listModels=()=>new Promise(resolve=>{release=resolve;});f.llm.listProviders=()=>[{id:'old',name:'Old'}];
 const catalog=createModelCatalog(f.ctx,{timeout:30}),old=catalog.load();
 f.llm.listProviders=()=>[{id:'new',name:'New'}];f.llm.listModels=async()=>[{id:'two',name:'Two'}];catalog.invalidate();
 assert.equal((await catalog.load()).groups[0].id,'new');release([{id:'one',name:'One'}]);await old;
 assert.equal((await catalog.load()).groups[0].id,'new');catalog.dispose();
});
test('native catalog adapter restores the original on unload and invalidates when configuration changes',async()=>{
 const f=fixture(),original=()=>new Promise(()=>{}),service={modelCatalog:original},cleanups=[],events=new Map();
 const scope={get:k=>k==='sessionController'?service:f.ctx.get(k),effect:fn=>{cleanups.push(fn());},on:(name,fn)=>events.set(name,fn)};
 wireModelCatalog({inject:(_services,fn)=>fn(scope)},{timeout:15,nativeTimeout:1});assert.notEqual(service.modelCatalog,original);
 assert.equal((await service.modelCatalog()).groups.length,1);f.recover();events.get('llm/adapters-updated')();assert.equal((await service.modelCatalog()).groups.length,2);
 for(const cleanup of cleanups.reverse())cleanup();assert.equal(service.modelCatalog,original);
});
