import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Escape dismisses an open native picker before its containing dialog; listeners unload',()=>{
 const listeners=new Map();let closed=0,stopped=0;
 const select={matches:selector=>selector===':open'},target={closest:selector=>selector==='select'?select:null};
 const root={getClientRects:()=>[{}],querySelectorAll:()=>[],contains:x=>x===target,focus(){}};
 const doc={activeElement:null,querySelectorAll:()=>[root]};
 const win={__ModuleLoader__:{load:x=>x.factory(()=>({}))},addEventListener:(name,fn,capture)=>listeners.set(!!capture,fn),removeEventListener:(name,fn,capture)=>{assert.equal(listeners.get(!!capture),fn);listeners.delete(!!capture);}};
 const code=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8').replace("return {name:'dsh-ui-stronger',inject:","window.focus=manageDialogFocus;return {name:'dsh-ui-stronger',inject:");
 vm.runInNewContext(code,{window:win,document:doc});const cleanup=win.focus(root,()=>closed++);
 listeners.get(true)({key:'Escape',target,stopPropagation(){stopped++;}});
 assert.equal(stopped,1);assert.equal(closed,0);
 select.matches=()=>false;listeners.get(true)({key:'Escape',target,stopPropagation(){stopped++;}});assert.equal(stopped,1);
 listeners.get(false)({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(closed,1);
 cleanup();assert.equal(listeners.size,0);
});
