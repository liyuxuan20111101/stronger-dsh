import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {readSkillLibrary} from '../lib/workspace.js';import {WechatBridge} from '../lib/wechat.js';
const temp=async fn=>{const dir=await mkdtemp(path.join(tmpdir(),'usage-bugs-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}};
test('local skill frontmatter is stripped for LF, CRLF and BOM and actual NUL is rejected',()=>temp(async d=>{
 const root=path.join(d,'skill-library');await mkdir(path.join(root,'example'),{recursive:true});await writeFile(path.join(root,'index.json'),JSON.stringify({version:1,skills:[{name:'example',description:'Example'}]}));
 for(const ending of ['\n','\r\n'])for(const bom of ['','\uFEFF']){await writeFile(path.join(root,'example/SKILL.md'),bom+['---','name: example','description: FRONTMATTER_ONLY','---','actual body'].join(ending));const [skill]=await readSkillLibrary(d);assert(!skill.content.includes('FRONTMATTER_ONLY'));assert(skill.content.includes('\nactual body'));}
 await writeFile(path.join(root,'index.json'),'\uFEFF'+JSON.stringify({version:1,skills:[{name:'example',description:'Example'}]}));assert.equal((await readSkillLibrary(d)).length,1);await writeFile(path.join(root,'example/SKILL.md'),'bad\0body');await assert.rejects(readSkillLibrary(d));
}));
test('stopped WeChat client cannot persist a late created session or call a reconfigured channel',()=>temp(async d=>{
 const cwd=path.join(d,'work');await mkdir(cwd);const b=new WechatBridge(path.join(d,'data'),{get:()=>null});await b.load();await b.configure({cwd,enabled:true});let finish,entered;const started=new Promise(r=>entered=r);const client=b.secureClient({listSessions:async()=>({items:[]}),createSession:async()=>{entered();return new Promise(r=>finish=r);}});
 try{const pending=client.createSession({cwd});await started;await b.stop();finish({sessionId:'late'});await assert.rejects(pending);assert(!b.owns('late'));await assert.rejects(client.createSession({cwd}));}finally{await b.dispose();}
}));
test('stopping during ClawBot module load does not instantiate a late manager',()=>temp(async d=>{
 const cwd=path.join(d,'work');await mkdir(cwd);let finish,entered,created=0;const started=new Promise(r=>entered=r);const b=new WechatBridge(path.join(d,'data'),{get:n=>n==='sessionController'?{}:null},{loadModules:async()=>{entered();return new Promise(r=>finish=r);}});await b.load();await b.configure({cwd,enabled:true});
 const pending=b.ensure();await started;const stop=b.stop();finish({ClawbotManager:class{constructor(){created++;this.wxCfg={};}resolveAccount(){}cancelLogin(){}async stop(){}},createSessionControllerDshClient:()=>({}),qr:{}});await assert.rejects(pending);await stop;assert.equal(created,0);assert.equal(b.manager,null);await b.dispose();
}));
test('WeChat status refresh deduplicates, pauses offscreen and cannot update after unmount',async()=>{
 const original=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');const timers=new Map(),events=new Map();let serial=0,resolve,calls=0,updates=0;const document={hidden:false};
 const win={__ModuleLoader__:{load:x=>x.factory(()=>({}))},addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
 vm.runInNewContext(original.replace("return {name:'dsh-ui-stronger',inject:","window.watch=watchWechatStatus;return {name:'dsh-ui-stronger',inject:"),{window:win,document,AbortController,setInterval:(fn)=>{timers.set(++serial,fn);return serial;},clearInterval:id=>timers.delete(id),setTimeout,clearTimeout,AbortSignal});
 const dispose=win.watch(async()=>{calls++;return new Promise(r=>resolve=r);},()=>updates++,()=>{}),tick=[...timers.values()][0];tick();tick();assert.equal(calls,1);resolve({connected:true});await new Promise(r=>setImmediate(r));assert.equal(updates,1);document.hidden=true;tick();assert.equal(calls,1);document.hidden=false;events.get('focus')();assert.equal(calls,2);dispose();resolve({connected:true});await new Promise(r=>setImmediate(r));assert.equal(updates,1);assert.equal(timers.size,0);assert.equal(events.size,0);
});
