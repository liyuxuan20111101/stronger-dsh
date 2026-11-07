import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {Workspace,wireWorkspace} from '../lib/workspace.js';
import {wireModelCatalog} from '../lib/model-catalog.js';

async function client(){
 const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
 const window={location:{protocol:'dsh-app:'},__ModuleLoader__:{load:b=>b.factory(id=>id==='react'?React:{})}};
 vm.runInNewContext(source.replace("return {name:'dsh-ui-stronger',inject:","window.qa={callControl,wirePresetEntry,wireModelSettingsProgress};return {name:'dsh-ui-stronger',inject:"),{window,AbortSignal,setTimeout,clearTimeout});
 return window.qa;
}
test('missing small policy read uses older authenticated view, while write errors are never retried',async()=>{
 const {callControl}=await client(),calls=[];
 const view={policies:{},defaultPolicy:{enabled:false,maxParallel:2,maxTasks:8},revision:7,capabilities:{spawn:true}};
 const ctx={connection:{rpc:{call:async(channel,method)=>{calls.push([channel,method]);if(method==='ui-stronger/bots')return {ok:true,value:view};throw Error('transport failure for /api/'+method+': HTTP 404');}}}};
 const result=await callControl(ctx,'teamPolicyStatus',{sessionId:'one'});
 assert.equal(result.revision,7);assert.equal(result.policy.enabled,false);assert(result.available);
 assert.deepEqual(calls,[['/api','ui-stronger/teamPolicyStatus'],['/api','ui-stronger/bots']]);
 calls.length=0;ctx.connection.rpc.call=async(...args)=>{calls.push(args);throw Error('business error');};
 await assert.rejects(callControl(ctx,'teamPolicy',{sessionId:'one'}),/business error/);assert.equal(calls.length,1);
});
test('catalog extension arguments bypass shared cache and keep receiver and synchronous contract',()=>{
 const service={modelCatalog:function(...args){assert.equal(this,service);return args[0];}},cleanups=[];
 wireModelCatalog({inject:(_keys,fn)=>fn({get:key=>key==='sessionController'?service:{},effect:fn=>cleanups.push(fn()),on(){}})});
 const a={plugin:'a'},b={plugin:'b'};
 assert.equal(service.modelCatalog(a),a);assert.equal(service.modelCatalog(b),b);cleanups.forEach(fn=>fn());
});
test('preset entry preserves native metadata, inject and label, and opens the host settings',async()=>{
 const {wirePresetEntry}=await client();let cleanup,component,meta,section;
 const native={options:{id:'agent-preset',order:-10,locale:'native',priority:30,inject:()=>({})},component:()=>null};
 const ctx={effect:fn=>cleanup=fn(),slots:{subscribe:()=>()=>{},entriesOfSlot:name=>name==='sidebar.settings'?[{store:{create:()=>({actions:{openSection:id=>section=id}})}}]:[native],register:(m,c)=>{meta=m;component=c;return()=>{};}}};
 wirePresetEntry(ctx);assert.equal(meta.inject,native.options.inject);assert.equal(meta.locale,'native');assert.equal(meta.priority,30);
 // Exercise the produced button without mounting hooks into a second React runtime.
 const old=React.useState;React.useState=()=>['',()=>{}];
 try{const tree=component({sessionId:'one'});tree.props.children[0].props.onClick();assert.equal(section,'agent-presets');}finally{React.useState=old;cleanup();}
});
test('skill service replacement has independent registrations and old disposal leaves new registrations alive',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'skill-coexist-')),workspace=new Workspace(data),scopes=[];let install;
 await workspace.load();
 const ctx={on(){},inject:(keys,fn)=>{if(keys.includes('skills'))install=fn;},effect(){}};
 wireWorkspace(ctx,workspace);
 const make=()=>{const names=new Set(),cleanups=[];const scope={skills:{register:s=>{names.add(s.name);return()=>names.delete(s.name);}},effect:fn=>cleanups.push(fn())};scopes.push({names,cleanups});return scope;};
 try{install(make());install(make());assert(scopes[0].names.size>0);assert.equal(scopes[0].names.size,scopes[1].names.size);scopes[0].cleanups.forEach(fn=>fn());assert(scopes[1].names.size>0);}finally{scopes[1]?.cleanups.forEach(fn=>fn());await workspace.dispose();await rm(data,{recursive:true,force:true});}
});
