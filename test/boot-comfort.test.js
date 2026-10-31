import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {BOOT_SCRIPT} from '../lib/boot.js';
function harness({hidden=false,reduced=false}={}){
 const events=new Map(),documentEvents=new Map(),timers=new Map(),attrs=new Set();let serial=0,removals=0;
 const button={},node={toggleAttribute:(k,v)=>v?attrs.add(k):attrs.delete(k),setAttribute:k=>attrs.add(k),remove:()=>removals++};
 const window={addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),matchMedia:()=>({matches:reduced})};
 const document={hidden,getElementById:id=>id==='dsh-ui-loading'?node:button,addEventListener:(n,f)=>documentEvents.set(n,f),removeEventListener:n=>documentEvents.delete(n)};
 vm.runInNewContext(BOOT_SCRIPT,{window,document,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)});
 const tick=ms=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
 return {events,documentEvents,timers,attrs,button,document,tick,removed:()=>removals};
}
test('boot waits for actual readiness, fades once, and releases every listener',()=>{
 const h=harness();assert.equal(h.removed(),0);assert.deepEqual([...h.timers.values()].map(t=>t.ms),[20000]);
 const ready=h.events.get('dsh-ui-ready');ready();ready();assert(h.attrs.has('data-exit'));assert.equal(h.events.size,0);assert.equal(h.documentEvents.size,0);assert.equal(h.button.onclick,null);assert.equal(h.removed(),0);
 h.tick(220);assert.equal(h.removed(),1);h.tick(20000);assert.equal(h.removed(),1);
});
test('boot pauses offscreen and removes immediately for reduced motion or a hidden page',()=>{
 for(const options of [{hidden:true},{reduced:true}]){const h=harness(options);assert.equal(h.attrs.has('data-paused'),!!options.hidden);h.events.get('dsh-ui-ready')();assert.equal(h.removed(),1);assert.equal(h.timers.size,0);}
 const h=harness();h.document.hidden=true;h.documentEvents.get('visibilitychange')();assert(h.attrs.has('data-paused'));h.document.hidden=false;h.documentEvents.get('visibilitychange')();assert(!h.attrs.has('data-paused'));h.button.onclick();
});
test('escape and timeout both unlock the workspace when client boot fails',()=>{
 for(const exit of [h=>h.events.get('keydown')({key:'Escape'}),h=>h.tick(20000)]){const h=harness();exit(h);h.tick(220);assert.equal(h.removed(),1);assert.equal(h.events.size,0);assert.equal(h.documentEvents.size,0);}
});
