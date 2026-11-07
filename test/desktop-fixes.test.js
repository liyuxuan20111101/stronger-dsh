import test from 'node:test';
import assert from 'node:assert/strict';
import {createFetchRpc,API_ACTIONS,apply} from '../lib/index.js';
import {createModelCatalog} from '../lib/model-catalog.js';
import {Intelligence} from '../lib/intelligence.js';
import {WechatBridge} from '../lib/wechat.js';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Context} from '@deepseek-ai/cordis';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const request=(action,options={})=>new Request('https://dsh.invalid/api/ui-stronger/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'test',method:'ui-stronger/'+action,payload:{}}),...options});
test('Fetch RPC has exact shared API envelopes on both desktop and web carriers, validates inputs and cancellation',async()=>{
 let invoked=0;const handler=createFetchRpc('status',async()=>{invoked++;return {ready:true};});
 for(const protocol of ['https:','dsh-app:']){const req=request('status');const actual=new Request(req.url.replace('https:',protocol),req);const res=await handler(actual);assert.equal(res.status,200);assert.deepEqual(await res.json(),{type:'server-response',rpcId:'test',result:{ok:true,value:{ready:true}}});assert.equal(res.headers.get('cache-control'),'no-store');}
 assert.equal((await handler(new Request('https://dsh.invalid/api/ui-stronger/status'))).status,405);
 assert.equal((await handler(request('other'))).status,404);
 assert.equal((await handler(request('status',{headers:{}}))).status,415);
 assert.equal((await handler(request('status',{body:'{'}))).status,400);
 assert.equal((await handler(request('status',{body:JSON.stringify({type:'client-request',rpcId:'test',method:'ui-stronger/deleteArchivedSession'})}))).status,400);
 assert.equal((await handler(request('status',{body:' '.repeat(12*1024*1024+1)}))).status,413);
 const controller=new AbortController(),cancelled=request('status',{signal:controller.signal});controller.abort();assert.equal((await (await handler(cancelled)).json()).result.ok,false);assert.equal(invoked,2);
});
test('plugin registers exact Fetch routes without a webServer or stealing the native gateway',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'shared-route-')),before=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const ctx=new Context(),routes=new Map();ctx.provide('commands',{register:()=>()=>{}});ctx.provide('connection',{fetch:{register:r=>{assert(!routes.has(r.path));routes.set(r.path,r);}},rpc:{handle(){assert.fail('HTTP-only RPC was used');},intercept(){assert.fail('native gateway must retain ownership');}}});const f=ctx.plugin({name:'fetch-test',inject:['commands'],apply});await f;
 try{assert.equal(routes.size,API_ACTIONS.length);for(const action of ['status','wechatStatus','modelCatalog','modelCapabilities','workbench','deleteArchivedSession']){const route=routes.get('/api/ui-stronger/'+action);assert(route);assert.deepEqual(route.methods,['POST']);assert.equal(route.requestBody,'buffered');}const res=await routes.get('/api/ui-stronger/status').fetch(request('status'));assert.equal((await res.json()).result.value.version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);}
 finally{await f.dispose();await rm(home,{recursive:true,force:true});if(before===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=before;}
});
test('many model names do not trigger expensive capability fanout, cached healthy providers are reused',async()=>{
 let reads=0,caps=0;const llm={listProviders:()=>[{id:'p'}],listModels:async()=>{reads++;return Array.from({length:100},(_,i)=>({id:'m'+i}));},resolveModelInfo:async()=>{caps++;return new Promise(()=>{});}};const catalog=createModelCatalog({get:k=>k==='llm'?llm:{currentSelection:()=>({provider:'other',model:'n'})}},{timeout:20});
 assert.equal((await catalog.load()).groups[0].models.length,100);assert.equal(caps,0);await catalog.load();assert.equal(reads,1);catalog.invalidate();await catalog.load();assert.equal(reads,2);catalog.dispose();
});
test('selected capability reads are shared, cached and checked against the catalog',async()=>{
 let reads=0;const i=new Intelligence('/unused',{get:k=>k==='sessionController'?{modelCatalog:async()=>({groups:[{id:'p',models:[{id:'m'}]}]})}:{resolveModelInfo:async()=>{reads++;return {reasoning:{efforts:[{id:'high'}],defaultEffort:'high'}};}}});
 const a=await Promise.all([i.capabilities({provider:'p',model:'m'}),i.capabilities({provider:'p',model:'m'})]);assert.equal(reads,1);assert.equal(a[0].reasoning.defaultEffort,'high');await i.capabilities({provider:'p',model:'m'});assert.equal(reads,1);await assert.rejects(i.capabilities({provider:'unknown',model:'m'}),/目录/);
});
test('WeChat can apply an effort after lazy capabilities without accepting unsupported values',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'lazy-effort-'));await mkdir(path.join(home,'work'));const b=new WechatBridge(home,{get:k=>k==='sessionController'?{modelCatalog:async()=>({groups:[{id:'p',models:[{id:'m'}]}]})}:k==='llm'?{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high'}]}})}:null});await b.load();
 try{await b.configure({cwd:path.join(home,'work'),enabled:false});assert.equal((await b.modelPreference({provider:'p',model:'m',reasoningEffort:'high'},true)).route.reasoningEffort,'high');await assert.rejects(b.modelPreference({provider:'p',model:'m',reasoningEffort:'unsupported'},true));}finally{await b.dispose();await rm(home,{recursive:true,force:true});}
});
test('native provider editor is retained; waiting feedback appears without duplicate model navigation',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.wire=wireModelSettingsProgress;return {name:'dsh-ui-stronger',inject:");const win={__ModuleLoader__:{load:b=>b.factory(id=>id==='react'?React:{Button:({children})=>React.createElement('button',null,children)})}};vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});
 let wrapped,cleanup,registered;const original=()=>React.createElement('div',null,'native provider editor'),inject=()=>({controller:{},useSnapshot:()=>({status:'loading'})});const ctx={effect:fn=>cleanup=fn(),slots:{entriesOfSlot:()=>[{options:{id:'models',order:10,label:'Models',inject},component:original}],subscribe:()=>()=>{},register:(meta,component)=>{registered=meta;wrapped=component;return ()=>{wrapped=null;};}}};win.wire(ctx);assert.equal(registered.id,'models');assert.equal(registered.inject,inject);const html=renderToStaticMarkup(React.createElement(wrapped,inject()));assert.match(html,/native provider editor/);assert.match(html,/正在读取供应商/);cleanup();assert.equal(wrapped,null);
 assert.doesNotMatch(source,/select\.showPicker|select\.focus\(\).*showPicker/);assert.match(source,/\.wnFoaW_rowQuickActions\{display:none!important\}/);assert.match(source,/zs-delete-label/);
});
