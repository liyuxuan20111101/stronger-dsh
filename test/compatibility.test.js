import test from 'node:test';
import assert from 'node:assert/strict';
import {wireModelCatalog} from '../lib/model-catalog.js';
import {requestFailure} from '../lib/assurance.js';
import {wireIntelligence} from '../lib/intelligence.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function setup(original){
 const service={modelCatalog:original},cleanups=[];let reads=0;
 const llm={listProviders:()=>[{id:'healthy',name:'Healthy'}],listModels:async()=>{reads++;return [{id:'model',name:'Model'}];},resolveModelInfo:async()=>({})};
 const scope={get:k=>({sessionController:service,llm,agentDefaultModel:{currentSelection:()=>({provider:'healthy',model:'model'})}}[k]),effect:fn=>cleanups.push(fn()),on(){}};
 wireModelCatalog({inject:(_deps,fn)=>fn(scope)},{timeout:20,nativeTimeout:5});
 return {service,cleanups,reads:()=>reads};
}
test('healthy native catalog preserves plugin fields, receiver and arguments without adapter rediscovery',async()=>{
 const result={groups:[],default:{provider:'custom'},thirdParty:{routing:'preserved'}};let receiver,args;
 const f=setup(function(...values){receiver=this;args=values;return result;});
 assert.equal(await f.service.modelCatalog('extra',{generation:3}),result);
 assert.equal(receiver,f.service);assert.deepEqual(args,['extra',{generation:3}]);assert.equal(f.reads(),0);
 f.cleanups.forEach(fn=>fn());
});
test('catalog timeout falls back to healthy adapters and unloading a middle wrapper leaves later plugins intact',async()=>{
 let native=()=>new Promise(()=>{});const original=function(...args){return native(...args);},f=setup(original),captured=f.service.modelCatalog;
 assert.equal((await captured.call(f.service)).groups[0].id,'healthy');
 const later=function(...args){return captured.apply(this,args);};f.service.modelCatalog=later;
 f.cleanups.forEach(fn=>fn());assert.equal(f.service.modelCatalog,later);
 native=value=>({afterUnload:value});assert.deepEqual(await later.call(f.service,'native'),{afterUnload:'native'});
 assert.equal(f.reads(),1,'disposed captured wrapper is a transparent pass-through');
});
test('upstream channel diagnostic uses terminal events only, drops raw private details and clears after success',()=>{
 const failed={seq:4,type:'turn/end',data:{reason:{kind:'error',error:{status:400,message:'11128 Illegal API invocation from an unapproved channel',privateDetail:'DO_NOT_COPY'}}}};
 const note=requestFailure([failed]);assert.equal(note.kind,'channel-rejected');assert.equal(note.retryable,false);assert.doesNotMatch(JSON.stringify(note),/DO_NOT_COPY/);
 assert.equal(requestFailure([{...failed,type:'tool/result'}]),null);
 assert.equal(requestFailure([failed,{seq:5,type:'turn/start'}]),null);
 assert.equal(requestFailure([failed,{seq:6,type:'turn/end',data:{reason:{kind:'completed'}}}]),null);
 assert.equal(requestFailure([{...failed,data:{reason:{kind:'error',message:'429 rate limited'}}}]),null);
});
test('client catalog adapter does not eagerly load, forwards extensions and becomes inert on unload',async()=>{
 let cleanup,reads=0,args;const original=function(...values){assert.equal(this,catalog);reads++;args=values;return Promise.resolve({native:true});};
 const catalog={load:original,generation:0,store:{getSnapshot:()=>({status:'ready',value:{}})},invalidate(){}};
 const win={__ModuleLoader__:{load:x=>x.factory(()=>({}))}};
 const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8').replace("return {name:'dsh-ui-stronger',inject:","window.wire=wireNativeCatalog;return {name:'dsh-ui-stronger',inject:");
 vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});win.wire({inject:(_keys,fn)=>fn({get:()=>({catalog}),effect:fn=>{cleanup=fn();}})});
 assert.equal(reads,0);const captured=catalog.load;await captured.call(catalog,'first');assert.deepEqual(args,['first']);
 const later=function(...values){return captured.apply(this,values);};catalog.load=later;cleanup();assert.equal(catalog.load,later);
 assert.deepEqual(await later.call(catalog,'after'),{native:true});assert.deepEqual(args,['after']);
});
test('follow-host compression preserves the native receiver and unload does not break a later context plugin',async()=>{
 let cleanup,install,seen;const engine={config:{auto:true},compactIfNeeded:function(){seen=this;return 'native';},summarize:function(){seen=this;return 'summary';}};
 const service={ready:true,config:{context:{auto:null},tasks:{}},route:()=>null};
 const ctx={inject:(keys,fn)=>{if(keys.includes('compaction'))install=fn;},on:()=>()=>{},effect:fn=>{const off=fn();cleanup??=off;}};
 wireIntelligence(ctx,service);install({get:()=>engine});assert.equal(engine.compactIfNeeded({},'pressure'),'native');assert.equal(seen,engine);
 assert.equal(await engine.summarize({},{}),'summary');assert.equal(seen,engine);
 const captured=engine.compactIfNeeded,later=function(...args){return captured.apply(this,args);};engine.compactIfNeeded=later;cleanup();
 service.config.context={auto:false};assert.equal(engine.compactIfNeeded({},'pressure'),'native');assert.equal(engine.compactIfNeeded,later);assert.equal(seen,engine);
});

test('synchronous adapter failure during native timeout rejects without an uncaught timer error',async()=>{
 let cleanup;const service={modelCatalog:()=>new Promise(()=>{})};
 const scope={get:k=>({sessionController:service,llm:{listProviders(){throw Error('adapter restarting');}},agentDefaultModel:{currentSelection:()=>({})}}[k]),effect:fn=>{cleanup=fn();},on(){}};
 wireModelCatalog({inject:(_keys,fn)=>fn(scope)},{timeout:10,nativeTimeout:2});
 await assert.rejects(service.modelCatalog(),/模型目录暂不可用/);cleanup();
});
