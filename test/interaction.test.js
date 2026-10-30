import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const original=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
function client(extra={}){const win={__ModuleLoader__:{load:x=>x.factory(()=>({}))},addEventListener(){},removeEventListener(){},...extra.window};const code=original.replace("return {name:'dsh-ui-stronger',inject:","window.testApi={focusableIn,manageDialogFocus,requestSignal,wireNativeCatalog};return {name:'dsh-ui-stronger',inject:");vm.runInNewContext(code,{window:win,setTimeout,clearTimeout,AbortSignal,...extra,window:win});return win.testApi;}

test('dialog focus skips disabled controls, wraps inside the top modal and respects handled keys',()=>{
 let key,closed=0;const doc={activeElement:null};
 const node=(disabled=false)=>({disabled,isConnected:true,matches:()=>disabled,closest:()=>null,getClientRects:()=>[{}],focus(){doc.activeElement=this;}});
 const previous=node(),disabled=node(true),first=node(),last=node(),root={querySelectorAll:()=>[disabled,first,last],getClientRects:()=>[{}],contains:x=>[first,last].includes(x),focus(){doc.activeElement=root;}};
 let dialogs=[root];doc.activeElement=previous;doc.querySelectorAll=()=>dialogs;
 const api=client({document:doc,window:{addEventListener:(_name,fn)=>{key=fn;},removeEventListener(){}}});const cleanup=api.manageDialogFocus(root,()=>closed++);
 assert.equal(doc.activeElement,first);doc.activeElement=last;let prevented=false;key({key:'Tab',preventDefault(){prevented=true;}});assert(prevented);assert.equal(doc.activeElement,first);
 key({key:'Escape',defaultPrevented:true});assert.equal(closed,0);
 const nested={getClientRects:()=>[{}],contains:()=>false};dialogs.push(nested);key({key:'Escape'});assert.equal(closed,0,'background modal must not close with the foreground one');
 dialogs=[root];key({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(closed,1);
 dialogs=[];cleanup();assert.equal(doc.activeElement,previous);
});

test('opening native settings does not steal focus back to the previous rail button',()=>{
 let restored=false;const previous={isConnected:true,matches:()=>false,focus(){restored=true;}},first={matches:()=>false,closest:()=>null,getClientRects:()=>[{}],focus(){}},root={querySelectorAll:()=>[first],getClientRects:()=>[{}],contains:()=>false},native={getClientRects:()=>[{}],contains:()=>false};let dialogs=[root];const doc={activeElement:previous,querySelectorAll:()=>dialogs};
 const api=client({document:doc});const cleanup=api.manageDialogFocus(root,()=>{});dialogs=[native];cleanup();assert.equal(restored,false);
});

test('collapsed details controls are not keyboard destinations even if a renderer reports their old rectangles',()=>{
 const root={},summary={contains:x=>x===toggle},details={tagName:'DETAILS',open:false,parentElement:root,querySelector:()=>summary},toggle={parentElement:details,matches:()=>false,closest:()=>null,getClientRects:()=>[{}]},hidden={...toggle};
 const api=client({document:{}});root.querySelectorAll=()=>[toggle,hidden];assert.deepEqual([...api.focusableIn(root)],[toggle]);details.open=true;assert.equal(api.focusableIn(root).length,2);
});

test('explicit cancellation signals retain action deadlines',()=>{
 let duration;const bounded=new AbortController();const proxy={timeout:ms=>{duration=ms;return bounded.signal;},any:AbortSignal.any.bind(AbortSignal)};
 const api=client({AbortSignal:proxy}),caller=new AbortController(),signal=api.requestSignal('speak',caller.signal);assert.equal(duration,150000);caller.abort();assert(signal.aborted);
 const other=new AbortController(),waiting=api.requestSignal('connections',other.signal);assert.equal(duration,15000);bounded.abort();assert(waiting.aborted,'deadline still applies when caller supplies a signal');
});

test('catalog unload settles pending wrapper operations and restores the native loader',async()=>{
 let cleanup;const catalog={load:()=>new Promise(()=>{}),generation:0,store:{getSnapshot:()=>({status:'loading',value:null}),set(){}},invalidate(){}};
 const native=catalog.load,api=client();api.wireNativeCatalog({inject:(_services,fn)=>fn({get:()=>({catalog}),effect:fn=>{cleanup=fn();}})},{timeout:1000});
 const pending=catalog.load();cleanup();await assert.rejects(pending,/已关闭/);assert.equal(catalog.load,native);
});

test('voice toggle and reply playback have distinct icons and accessible names',()=>{
 const react={...React,useEffect(){},useCallback:fn=>fn,useState:value=>[value?.revision===0?{...value,hasAnswer:true}:value,()=>{}],useRef:()=>({current:null}),useSyncExternalStore:(_sub,snapshot)=>snapshot()};
 const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?react:{})}};vm.runInNewContext(original.replace("return {name:'dsh-ui-stronger',inject:","window.Header=Header;return {name:'dsh-ui-stronger',inject:"),{window:win});
 const store={subscribe(){},snapshot:()=>({preferences:{enabled:true,voice:true},capabilities:{voice:true}})},html=renderToStaticMarkup(React.createElement(win.Header,{store,control(){},sessionId:'fixture'}));
 assert.match(html,/aria-label="本地语音"/);assert.match(html,/aria-label="朗读最近回复"/);assert.match(html,/m9 5 11 7-11 7V5Z/);assert.equal((html.match(/M4 9h4l5-4v14l-5-4H4z/g)??[]).length,1,'speaker glyph belongs only to the voice toggle');
});

test('surface dismissal waits for motion, respects unsaved work and is immediate when motion is disabled',()=>{
 const run=(motion,canClose)=>{let timer,closed=0;const react={...React,useRef:v=>({current:v}),useState:v=>[v,()=>{}],useEffect(){}};const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?react:id==='react-dom'?{createPortal:node=>node}:{})},matchMedia:()=>({matches:false})};
 vm.runInNewContext(original.replace("return {name:'dsh-ui-stronger',inject:","window.Surface=FocusSurface;return {name:'dsh-ui-stronger',inject:"),{window:win,document:{body:{},documentElement:{hasAttribute:()=>motion}},setTimeout:(fn,ms)=>{timer={fn,ms};return 1;},clearTimeout(){}});
 const surface=win.Surface({label:'Test',children:null,onClose:()=>closed++,canClose});surface.props.onPointerDown({target:1,currentTarget:1});return {get closed(){return closed;},get timer(){return timer;}};};
 const animated=run(true,true);assert.equal(animated.closed,0);assert.equal(animated.timer.ms,145);animated.timer.fn();assert.equal(animated.closed,1);assert.equal(run(false,true).closed,1);const dirty=run(true,false);assert.equal(dirty.closed,0);assert.equal(dirty.timer,undefined);
});

test('native tab motion follows one gesture without observing selection attributes, and unload cancels its frame',()=>{
 let effect,observerOptions,frame,click,cancelled=0,disconnected=0;const react={...React,useEffect:fn=>{effect=fn;},useSyncExternalStore:(_sub,snapshot)=>snapshot()};const win={__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?react:{})},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
 const doc={hidden:false,body:{},querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='click')click=fn;},removeEventListener(){}};
 vm.runInNewContext(original.replace("return {name:'dsh-ui-stronger',inject:","window.Motion=MotionBridge;return {name:'dsh-ui-stronger',inject:"),{window:win,document:doc,MutationObserver:class{observe(_node,options){observerOptions=options;}disconnect(){disconnected++;}},requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame:()=>cancelled++,setTimeout,clearTimeout});
 const store={subscribe:()=>()=>{},snapshot:()=>({preferences:{enabled:true,motion:true}})};win.Motion({store,navigation:{panelInfo:{subscribe:()=>()=>{}}}});const cleanup=effect();assert.equal(observerOptions.attributes,undefined);click({target:{closest:()=>({getAttribute:()=> 'false'})}});assert.equal(typeof frame,'function');cleanup();assert.equal(cancelled,1);assert.equal(disconnected,1);
});

test('motion batches insertion bursts, bounds concurrent animations and cancels on hidden pages',()=>{
 let effect,mutate,frame,visibility,animated=0,cancelled=0,raf=0;const react={...React,useEffect:fn=>{effect=fn;},useSyncExternalStore:(_s,get)=>get()};const win={innerHeight:800,__ModuleLoader__:{load:x=>x.factory(id=>id==='react'?react:{})},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};const doc={hidden:false,body:{},documentElement:{toggleAttribute(){},removeAttribute(){}},querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='visibilitychange')visibility=fn;},removeEventListener(){}};vm.runInNewContext(original.replace("return {name:'dsh-ui-stronger',inject:","window.Motion=MotionBridge;return {name:'dsh-ui-stronger',inject:"),{window:win,document:doc,MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){}},requestAnimationFrame:fn=>{frame=fn;raf++;return raf;},cancelAnimationFrame(){},setTimeout,clearTimeout});const store={subscribe:()=>()=>{},snapshot:()=>({preferences:{enabled:true,motion:true}})};win.Motion({store,navigation:{}});const close=effect();const node=()=>({nodeType:1,matches:()=>true,getBoundingClientRect:()=>({top:10,bottom:30,width:20,height:20}),animate:()=>{animated++;return {finished:new Promise(()=>{}),cancel(){cancelled++;}};}});mutate([{addedNodes:Array.from({length:30},node)}]);assert.equal(raf,1);frame();assert.equal(animated,0);mutate([{addedNodes:Array.from({length:6},node)}]);frame();assert.equal(animated,6);mutate([{addedNodes:[node()]}]);frame();assert.equal(animated,6);doc.hidden=true;visibility();assert.equal(cancelled,6);close();
});
