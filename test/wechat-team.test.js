import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {WechatBridge,wechatErrorReport,redactWechatError,wechatGuidance} from '../lib/wechat.js';
import {Bots} from '../lib/bots.js';import {ClawbotManager} from 'dsh-plugin-clawbot/manager';
const temporary=async fn=>{const root=await mkdtemp(path.join(tmpdir(),'wechat-team-'));try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
const event=(type,data={},seq=1)=>({type,seq,data});

test('WeChat detailed errors keep useful codes and causes while suppressing secrets and request bodies',()=>{
 const report=wechatErrorReport({kind:'error',error:{status:400,code:11128,requestId:'request-fixture',message:'Illegal API invocation from an unapproved channel',cause:{message:'authorization=Bearer PRIVATEVALUE api_key=PRIVATEKEY password=PRIVATEPASS user@example.org'}}});
 assert.match(report,/11128/);assert.match(report,/400/);assert.match(report,/request-fixture/);assert.match(report,/渠道/);assert.doesNotMatch(report,/PRIVATEVALUE|PRIVATEKEY|PRIVATEPASS|user@example/);
 const encoded=wechatErrorReport(new Error('400: '+JSON.stringify({message:JSON.stringify({code:11128,msg:'Request blocked'})})));assert.match(encoded,/11128/);
 assert.doesNotMatch(redactWechatError(JSON.stringify({messages:[{content:'PRIVATE CHAT'}]})),/PRIVATE CHAT/);
 assert(redactWechatError('x'.repeat(20000)).length<=900);assert.match(wechatErrorReport({}, {kind:'blocked'}),/审批/);
 const privatePath=path.join(path.parse(tmpdir()).root,'Users','Example Person','private file');assert.doesNotMatch(redactWechatError('failed at '+privatePath),/Example Person|private file/);
});
test('native child events are tied to an allowed WeChat root, filtered and projected without granting child control',()=>temporary(async root=>{
 const cwd=path.join(root,'work');await mkdir(cwd);const sessions=new Map();let receive;
 const ctx={get:k=>k==='sessions'?{get:id=>sessions.get(id)}:null};const bridge=new WechatBridge(path.join(root,'data'),ctx);await bridge.load();await bridge.configure({cwd,enabled:true});
 bridge.config.sessions.wx=cwd;sessions.set('wx',{header:{cwd}});
 for(const id of ['child-a','child-b'])sessions.set(id,{header:{origin:'subagent',parentSession:'wx',cwd}});
 sessions.set('foreign',{header:{origin:'subagent',parentSession:'desktop',cwd}});
 sessions.set('outside',{header:{origin:'subagent',parentSession:'wx',cwd:root}});
 const output=[],client=bridge.secureClient({openMux:fn=>{receive=fn;},listSessions:async()=>({items:[{sessionId:'wx'},{sessionId:'child-a'}]})});
 assert.equal(typeof client.openMux(x=>output.push(x)).then,'function');await Promise.resolve();
 const send=(id,e)=>receive({type:'session/event',sessionId:id,event:e});send('wx',event('turn/start'));
 send('child-a',event('turn/start'));send('child-b',event('turn/start'));
 send('foreign',event('turn/end',{reason:{kind:'error',error:{message:'OTHER PRIVATE'}}}));send('outside',event('turn/end',{reason:{kind:'error',error:{message:'OUTSIDE PRIVATE'}}}));
 send('child-a',event('turn/end',{reason:{kind:'error',error:{code:'TOOL_FAILED',message:'safe failure'}}},2));
 send('child-b',event('turn/end',{reason:{kind:'completed'}},2));
 send('wx',event('assistant/message',{content:[{type:'text',text:'Main answer'}]}));const original=event('turn/end',{reason:{kind:'completed'}},5);send('wx',original);
 const text=JSON.stringify(output);assert.match(text,/2 个子任务/);assert.match(text,/safe failure/);assert.match(text,/Main answer/);assert.doesNotMatch(text,/OTHER PRIVATE|OUTSIDE PRIVATE/);assert.equal(original.type,'turn/end');assert.equal(bridge.owns('child-a'),false);assert.equal((await client.listSessions()).items.length,1);
 const before=output.length;await bridge.stop();send('wx',original);assert.equal(output.length,before);await bridge.dispose();
}));
test('real ClawBot manager accepts one inbound turn, starts two team tasks and returns detailed errors to its owner',()=>temporary(async root=>{
 const cwd=path.join(root,'work');await mkdir(cwd);const sessions=new Map(),agents=new Map(),listeners=new Set(),sent=[];let first=true,pollRelease,resolveReply;
 const reply=new Promise(resolve=>{resolveReply=resolve;});
 const emit=(id,e)=>{for(const fn of listeners)fn({id},e);};
 let serial=0;const ctx={on:(_name,fn)=>{listeners.add(fn);return ()=>listeners.delete(fn);},get:k=>({sessionController:{},sessions:{get:id=>sessions.get(id)},agents:{get:id=>agents.get(id)},subagents:{resolveMaxDepth:()=>1,startActivation:async spec=>{const id='child-'+ ++serial;sessions.set(id,{header:{origin:'subagent',parentSession:spec.request.parent.session.id,cwd},snapshotEvents:()=>[]});emit(id,event('turn/start'));return {childId:id};}}}[k])};
 const bots=new Bots(path.join(root,'team'),ctx);await bots.load();let bridge;
 const base={openMux:(handler,signal,_status,opts)=>{const off=opts.eventBus(handler);signal.addEventListener('abort',off,{once:true});},listSessions:async()=>({items:[]}),createSession:async args=>{const s={id:args.sessionId,header:{cwd},snapshotEvents:()=>[]};sessions.set(s.id,s);agents.set(s.id,{session:s});return {sessionId:s.id};},prompt:async(id)=>{
  emit(id,event('turn/start'));const parent=agents.get(id);bots.state.policies[id]={enabled:true,maxParallel:2,maxTasks:8};const results=await Promise.all(['a','b'].map(key=>bots.execute({action:'spawn',key,task:'Independent local fixture'},{agent:parent,signal:new AbortController().signal})));
  assert.equal(results.length,2);assert.equal(serial,2);emit(results[0].childId,event('turn/end',{reason:{kind:'error',error:{code:'TOOL_FAILED',message:'Child fixture failed'}}},2));emit(results[1].childId,event('turn/end',{reason:{kind:'completed'}},2));
  emit(id,event('turn/end',{reason:{kind:'error',error:{status:400,code:11128,requestId:'fixture-request',message:'Illegal API invocation from an unapproved channel'}}},3));return {accepted:true};}};
 const fakeWeixin={getUpdates:async()=>{if(first){first=false;return {ret:0,msgs:[{message_id:'inbound-fixture',message_type:1,from_user_id:'owner',context_token:'fixture-context',item_list:[{type:1,text_item:{text:'Use two helpers'}}]}]};}return new Promise(resolve=>{pollRelease=resolve;});},notifyStart:async()=>{},notifyStop:async()=>{pollRelease?.({ret:0,msgs:[]});},getConfig:async()=>({}),sendText:async(to,text)=>{sent.push({to,text});resolveReply();}};
 class Manager extends ClawbotManager{constructor(cfg,opts){super(cfg,{...opts,weixinFactory:()=>fakeWeixin});}resolveAccount(){return {accountId:'fixture-account',userId:'owner',token:'fixture-only'};}}
 bridge=new WechatBridge(path.join(root,'data'),ctx,{loadModules:async()=>({ClawbotManager:Manager,createSessionControllerDshClient:()=>base,qr:{}})});
 try{await bridge.load();await bridge.configure({cwd,enabled:true});await bridge.save({...bridge.config,accountId:'fixture-account',userId:'owner'});await bridge.start();await Promise.race([reply,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No local reply')),3000);timer.unref();})]);
  assert.equal(sent[0].to,'owner');assert.match(sent[0].text,/11128/);assert.match(sent[0].text,/fixture-request/);assert.match(sent[0].text,/Child fixture failed/);assert.match(sent[0].text,/2 个子任务/);assert.doesNotMatch(sent[0].text,/fixture-only|fixture-context/);assert.equal(bots.tasks.runs.length,2);
 }finally{await bridge.dispose();await bots.close();}
}));
test('configured disabled child roles stay disabled; unconfigured team can use the default helper',()=>temporary(async root=>{
 const bots=new Bots(root,{get:()=>null});await bots.load();assert.equal(bots.taskProfiles().filter(p=>p.role==='child').length,1);
 await bots.save({revision:0,profiles:[{id:'disabled',name:'Disabled',role:'child',instructions:'',skills:[],model:null,enabled:false}]});assert.equal(bots.taskProfiles().filter(p=>p.enabled).length,0);assert.match(wechatGuidance(),/两个/);await bots.close();
}));
test('background child failure notifies only the bound owner once and stops after workspace revocation',()=>temporary(async root=>{
 const cwd=path.join(root,'work');await mkdir(cwd);const sessions=new Map([['wx',{header:{cwd}}],['child',{header:{origin:'subagent',parentSession:'wx',cwd}}]]),sent=[];
 const bridge=new WechatBridge(path.join(root,'data'),{get:k=>k==='sessions'?{get:id=>sessions.get(id)}:null});await bridge.load();await bridge.configure({cwd,enabled:true});bridge.config={...bridge.config,accountId:'bound',userId:'owner',sessions:{wx:cwd}};
 bridge.manager={watchers:new Map(),resolveAccount:()=>({accountId:'bound',userId:'owner'}),weixin:{sendText:async(to,text)=>sent.push({to,text})},cancelLogin(){},wxCfg:{},stop:async()=>{}};
 const relay=(id,e)=>bridge.projectFrame({type:'session/event',sessionId:id,event:e},()=>{},bridge.epoch);
 relay('wx',event('turn/start'));relay('child',event('turn/start'));relay('wx',event('turn/end',{reason:{kind:'completed'}},2));const failed=event('turn/end',{reason:{kind:'error',error:{code:'DISPATCH_FAILURE',message:'Background fixture failed'}}},3);
 relay('child',failed);relay('child',failed);await Promise.resolve();assert.equal(sent.length,1);assert.equal(sent[0].to,'owner');assert.match(sent[0].text,/Background fixture failed/);
 bridge.config.allowedCwds=[];relay('child',event('turn/end',{reason:{kind:'error',error:{message:'MUST_NOT_SEND'}}},4));assert.equal(sent.length,1);await bridge.dispose();
}));
