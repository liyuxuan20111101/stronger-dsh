import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {apply,answerText} from '../lib/index.js';
import {Workspace} from '../lib/workspace.js';
const require=createRequire(process.env.ZHIWEI_REACT_ROOT||import.meta.url);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {Context}=await import(process.env.DSH_CORDIS_ENTRY?pathToFileURL(process.env.DSH_CORDIS_ENTRY).href:'@deepseek-ai/cordis');

test('native model catalog retries partial failure and bounds stalled transport without accepting late data',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.__wireCatalog=wireNativeCatalog;return {name:'dsh-ui-stronger',inject:");const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?React:{})}};
 vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});
 let state={status:'ready',value:{groups:[],failures:[{id:'offline'}]}},resolveOld,cleanup,reads=0;
 const catalog={generation:0,store:{getSnapshot:()=>state,set:v=>{state=v;}},invalidate(){this.generation++;this.inflight=undefined;state={...state,status:'idle'};},load(){reads++;state={...state,status:'loading'};return new Promise(resolve=>{resolveOld=resolve;});}};
 const original=catalog.load;win.__wireCatalog({inject:(_s,fn)=>fn({get:()=>({catalog}),effect:fn=>{cleanup=fn();}})},{timeout:15});
 await new Promise(r=>setTimeout(r,25));assert.equal(state.status,'error');assert.match(state.error,/超时/);assert.equal(reads,1);assert.equal(catalog.generation,2,'failed ready catalog and timed out transport each invalidate once');
 resolveOld({groups:[{id:'late'}]});await new Promise(r=>setTimeout(r,1));assert.equal(state.status,'error');cleanup();assert.equal(catalog.load,original);
 assert.doesNotMatch(source,/aria-label':'切换当前会话模型'|当前模型与供应商/,'one native composer model selector; no duplicate plugin selector');
});

test('model settings shortcut opens the native root shell and does not replace account or provider configuration',async()=>{
 let navigationFor;const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.__navigation=navigationFor;return {name:'dsh-ui-stronger',inject:");const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?React:{})},dispatchEvent(){}};
 vm.runInNewContext(source,{window:win,CustomEvent:class{},document:{}});navigationFor=win.__navigation;let section,starts=0;const settingsEntry={store:{create:()=>({actions:{openSection:id=>{section=id;}}})}};const nav=navigationFor({slots:{entriesOfSlot:name=>name==='sidebar.settings'?[settingsEntry]:[],subscribe:()=>()=>{}},get:()=>null,layout:{panelInfo:{},selectPanel(){}},uiWorkspace:{startSession(){starts++;}}});nav.models();assert.equal(section,'models');assert.equal(starts,0);nav.dispose();
 assert.doesNotMatch(source,/wtg9ga_panelTitle\{display:none|_5Qcc8a_label\{display:none/);assert.match(source,/\['speak','compactNow'\]\.includes\(action\)\?150000/);
});
async function mount(home){process.env.DSH_HOME=home;const ctx=new Context(),commands=new Map(),channels=new Map();ctx.provide('commands',{register(def){commands.set(def.name,def);return ()=>commands.delete(def.name);}});ctx.provide('connection',{rpc:{handle(ch,fn){channels.set(ch,fn);return ()=>channels.delete(ch);}}});const fiber=ctx.plugin({name:'test-ui-stronger',inject:['commands'],apply});await fiber;await new Promise(r=>setTimeout(r,20));return {ctx,commands,channels,fiber,rpc:channels.get('/ui-stronger')};}
test('public plugin uses host session data, rejects paths and has no private capabilities',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'ui-stronger-public-'));const m=await mount(home);
 try{const s=await m.rpc('status',{});assert.equal(s.value.version,JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version);assert.equal(s.value.edition,'public');assert.equal(s.value.capabilities.voice,false);assert.equal((await m.rpc('preferences',{voice:true})).ok,false);assert.equal((await m.rpc('asset',{path:'secret.png'})).ok,false);assert.equal((await m.rpc('exec',{})).ok,false);assert.equal((await m.rpc('status',{},AbortSignal.abort())).ok,false);assert.equal((await m.rpc('preferences',{motion:false})).value.preferences.motion,false);assert.match((await m.commands.get('ui').handler({rawInput:'status'})).text,/界面增强/);}
 finally{await m.fiber.dispose();assert.equal(m.channels.size,0);assert.equal(m.commands.size,0);await rm(home,{recursive:true,force:true});}
});
test('public connection entry validates local resources and binds DSH answer playback',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'ui-full-')),data=path.join(home,'plugins-data/dsh-ui-stronger');await mkdir(data,{recursive:true});
 const skin=path.join(data,'custom.png'),reference=path.join(data,'ref.wav');await writeFile(skin,Buffer.from([137,80,78,71]));await writeFile(reference,Buffer.alloc(1024));
 const {createServer}=await import('node:http');const server=createServer(async(req,res)=>{for await(const _ of req){};if(req.url==='/openapi.json'){res.end('{}');return;}const wav=Buffer.alloc(1024);wav.write('RIFF');wav.write('WAVE',8);res.end(wav);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const m=await mount(home);
 try{assert.equal((await m.rpc('status',{})).value.edition,'public');assert.equal((await m.rpc('configure',{api:'https://remote.example',reference})).ok,false);assert.equal((await m.rpc('configure',{skin:'C:/secret.exe'})).ok,false);
  assert.equal((await m.rpc('configure',{api:'http://127.0.0.1:'+server.address().port,skin,reference,transcript:'test'})).ok,true);
  assert.equal((await m.rpc('status',{})).value.edition,'full');await m.rpc('preferences',{voice:true,pet:true});assert.match((await m.rpc('asset',{})).value.image,/data:image/);
  m.ctx.emit('session/event',{id:'one'},{type:'turn/start'});m.ctx.emit('session/event',{id:'one'},{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'Visible answer'}]}}});m.ctx.emit('session/event',{id:'one'},{type:'turn/end'});
  const a=(await m.rpc('activity',{sessionId:'one'})).value;assert.equal(a.busy,false);assert.equal(a.hasAnswer,true);assert.equal((await m.rpc('speak',{sessionId:'other',revision:a.revision})).ok,false);assert.equal(Buffer.from((await m.rpc('speak',{sessionId:'one',revision:a.revision})).value.wav,'base64').subarray(0,4).toString(),'RIFF');assert.equal((await m.rpc('speak',{sessionId:'one',revision:a.revision,offset:-1})).ok,false);
 }finally{await m.fiber.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}
});
test('client registers host branding, startup, chat controls and settings, all reversible',async()=>{
 let plugin;const attrs=new Set(),entries=new Map();let removed=false;const doc={addEventListener(){},removeEventListener(){},documentElement:{toggleAttribute:(k,v)=>v?attrs.add(k):attrs.delete(k),removeAttribute:k=>attrs.delete(k)},createElement:()=>({dataset:{},remove(){removed=true;}}),head:{append(){}}};
 const win={__ModuleLoader__:{load(b){plugin=b.factory(id=>id==='react'?React:{FishLogo:()=>React.createElement('svg'),BrandWordmark:()=>React.createElement('span',null,'DeepSeek')});}},addEventListener(){},removeEventListener(){},dispatchEvent(){},matchMedia:()=>({matches:false})};
 vm.runInNewContext(await readFile(new URL('../lib/client.js',import.meta.url),'utf8'),{window:win,document:doc,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,console,CustomEvent:class{constructor(type){this.type=type;}},MutationObserver:class{observe(){}disconnect(){}}});
 const ctx=new Context();ctx.provide('layout',{panelInfo:{subscribe:()=>()=>{},getSnapshot:()=>({activePanelId:null})},selectPanel(){},toggleSidebar(){}});ctx.provide('uiWorkspace',{startSession(){}});ctx.provide('slots',{entriesOfSlot:()=>[],subscribe:()=>()=>{},inject(_n,fn){return fn();},register(meta,component){const key=entries.has(meta.name)?meta.id:meta.name;entries.set(key,{meta,component});return ()=>entries.delete(key);}});ctx.provide('connection',{rpc:{call:async()=>({ok:true,value:{edition:'public',preferences:{enabled:true,motion:true,startup:true},capabilities:{},loaded:true}})}});const f=ctx.plugin(plugin);await f;await new Promise(r=>setTimeout(r,20));
 for(const name of ['sidebar.brand.mark','sidebar.footer.action','conversation.hero.brand.mark','conversation.header.leading','shell.overlay','conversation.session.header.actions','settings.section'])assert(entries.has(name),name);
 const entry=entries.get('settings.section');const html=renderToStaticMarkup(React.createElement(entry.component,entry.meta.inject()));assert.match(html,/接入语音模型/);assert.match(html,/界面增强/);assert.doesNotMatch(html,/知微|ZHIWEI|原生窗口/);assert(attrs.has('data-ui-stronger'));assert(!entries.has('sidebar'),'native sidebar keeps ownership of its child slots');const welcome=entries.get('conversation.hero.brand.mark');const home=renderToStaticMarkup(React.createElement(welcome.component,{}));assert.match(home,/有什么想推进的/);assert.doesNotMatch(home,/工作模块|编辑模块/,'empty or stock-only shortcuts must not reserve a blank home row');assert.doesNotMatch(home,/WORKSPACE \/ 01|快速操作 ↗|管理能力与工具/);
 const store=entry.meta.inject().store,rpc=ctx.get('connection').rpc;let resolveStatus;
 const snapshot={edition:'public',preferences:{enabled:true,motion:true,startup:true},capabilities:{},loaded:true};
 rpc.call=(_channel,action)=>action==='status'?new Promise(resolve=>{resolveStatus=resolve;}):Promise.resolve({ok:true,value:{...snapshot,preferences:{...snapshot.preferences,motion:false}}});
 const stale=store.refresh();await store.update({motion:false});resolveStatus({ok:true,value:snapshot});await stale;assert(!attrs.has('data-ui-stronger-motion'),'stale status cannot overwrite a newer preference');
 const pending=store.refresh();await f.dispose();resolveStatus({ok:true,value:snapshot});await pending;
 assert.equal(entries.size,0);assert.equal(attrs.size,0);assert(removed);
});
test('reply extraction excludes reasoning, tool calls and non-assistant messages',()=>{
 assert.equal(answerText({type:'user/message',data:{message:{content:[{type:'text',text:'user'}]}}}), '');
 assert.equal(answerText({type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'thought'},{type:'tool-call',text:'cmd'},{type:'text',text:'answer'}]}}}), 'answer');
});

test('WeChat descendants inherit memory isolation and missing parent provenance stays isolated',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'channel-provenance-')),data=path.join(home,'plugins-data/dsh-ui-stronger'),cwd=path.join(home,'tasks');await mkdir(cwd,{recursive:true});const w=new Workspace(data);await w.load();await w.propose('memory',{title:'Desktop private',content:'desktop-only-reference'},{human:true});await w.propose('memory',{title:'Mobile private',content:'wechat-only-reference'},{human:true,channel:'wechat'});await w.dispose();await writeFile(path.join(data,'wechat.json'),JSON.stringify({version:1,enabled:false,cwd,accountId:'',userId:'',allowedCwds:[cwd],shareMemory:false,sessions:{wx:cwd}}));
 const m=await mount(home),prompts=[];const sessions=new Map([['wx-child',{header:{origin:'subagent',parentSession:'wx'}}],['unknown-child',{header:{origin:'subagent'}}]]);m.ctx.provide('sessions',{get:id=>sessions.get(id)});m.ctx.provide('systemPrompt',{context:p=>{prompts.push(p);return ()=>{};}});
 try{assert.equal((await m.rpc('status')).ok,true);const prompt=prompts.find(p=>p.name==='ui-stronger:workspace');assert(prompt);const read=id=>JSON.parse(prompt.text({agent:{session:{id,header:{cwd}}}}));assert.match(JSON.stringify(read('wx-child')),/wechat-only-reference/);assert.doesNotMatch(JSON.stringify(read('wx-child')),/desktop-only-reference/);assert.equal(read('unknown-child').memories.length,0);assert.equal((await m.rpc('wechatConfigure',{cwd,enabled:false,allowedCwds:[cwd],shareMemory:true})).ok,true);assert.equal(read('wx-child').memories.length,2);assert.equal(read('unknown-child').memories.length,0);}finally{await m.fiber.dispose();await rm(home,{recursive:true,force:true});}
});




test('collaboration panel keeps hook order while loading resolves and includes task/message state',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.__BotsPanel=BotsPanel;return {name:'dsh-ui-stronger',inject:");let loaded=false,index=0,trace=[];const fake={...React,useSyncExternalStore:()=>{trace.push('store');return {sessionId:'p'};},useState:initial=>{trace.push('state');const n=index++;return [loaded&&n===0?{profiles:[],capabilities:{spawn:true},bindings:{}}:initial,()=>{}];},useRef:v=>{trace.push('ref');return {current:v};},useEffect:()=>trace.push('effect')};const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?fake:{})}};vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});win.__BotsPanel({store:{},control:()=>{}});const before=[...trace];loaded=true;index=0;trace=[];const result=win.__BotsPanel({store:{},control:()=>{}});assert.deepEqual(trace,before);assert.equal(result.type,'section');assert.match(source,/teamTimeline/);assert.match(source,/消息记录/);
});
