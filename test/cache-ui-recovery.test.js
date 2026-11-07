import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Workspace,wireWorkspace} from '../lib/workspace.js';

async function fixture(run){
 const dir=await mkdtemp(path.join(tmpdir(),'cache-recovery-'));
 const workspace=new Workspace(dir);
 try{await workspace.load();await run(workspace,dir);}
 finally{await workspace.dispose();await rm(dir,{recursive:true,force:true});}
}

test('plugin prompt bytes survive memory writes, checkpoint updates, new turns and restart',()=>fixture(async(w,dir)=>{
 await w.propose('memory',{title:'Initial',content:'Keep the source private.'},{human:true});
 await w.checkpoint('one','/work',{goal:'Repair the UI',next:'Run tests'});
 let scans=0;
 const events=[{seq:1,type:'user/message',data:{source:{kind:'user',rpcId:'human'},content:[{type:'text',text:'Fix the UI.'}]}}];
 const session={id:'one',header:{cwd:'/work'},surface:{nodes:[1]},snapshotEvents:()=>{scans++;return events;}};
 const contexts=[];
 const ctx={systemPrompt:{context:p=>contexts.push(p)},on(){},inject(keys,fn){if(keys.includes('systemPrompt'))fn(this);},get:()=>null,effect(){}};
 wireWorkspace(ctx,w);
 const prefix=()=>contexts.map(c=>c.text({agent:{session}})).join('\n');
 const before=prefix();
 await w.propose('memory',{title:'Later',content:'A new fact from another conversation.'},{human:true});
 await w.checkpoint('one','/work',{goal:'Repair the UI',verified:'A test passed',next:'Check another view'});
 events.push({seq:2,type:'user/message',data:{source:{kind:'user',rpcId:'next'},content:[{type:'text',text:'Now check the import view.'}]}});
 session.surface.nodes.push(2);
 for(let i=0;i<100;i++)assert.equal(prefix(),before);
 assert.equal(scans,1,'cached continuity must not rescan long event history on every step');
 assert.equal(w.recall('new fact','/work').length,1,'new memories remain available on demand');
 await w.snapshotQueue;
 const reload=new Workspace(dir);await reload.load();
 assert.deepEqual(reload.continuityFor(session,'/work'),w.continuityFor(session,'/work'));
 await reload.dispose();
 w.clearSnapshot('one');
 assert.notEqual(prefix(),before);
 assert.equal(w.continuityFor(session,'/work').handoff.verified,'A test passed');
}));

test('failed compaction keeps the prefix; successful compaction and revocation refresh safely',()=>fixture(async w=>{
 const row=await w.propose('memory',{title:'Fact',content:'Revocable fact.'},{human:true});
 let listener;
 wireWorkspace({on(_name,fn){listener=fn;},inject(){},effect(){}},w);
 const session={id:'one',snapshotEvents:()=>[],surface:{nodes:[]}};
 const before=JSON.stringify(w.snapshotFor('one','/work'));
 await w.propose('memory',{title:'New',content:'New fact.'},{human:true});
 listener(session,{type:'compaction/end',data:{error:'Cancelled'}});
 assert.equal(JSON.stringify(w.snapshotFor('one','/work')),before);
 listener(session,{type:'compaction/end',data:{}});
 assert.notEqual(JSON.stringify(w.snapshotFor('one','/work')),before);
 w.continuityFor(session,'/work');
 await w.decide(row.id,'archived');
 assert(!w.snapshotFor('one','/work').memories.some(r=>r.id===row.id));
 assert.equal(w.continuitySnapshots.size,0,'revoked snapshot must invalidate its companion');
 const source=await readFile(new URL('../lib/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/wechatConfigure'\)\{[^\n]*clearSnapshots/);
}));

test('bounded LRU retains an active old conversation beyond the former 64-entry limit',()=>fixture(async w=>{
 await w.propose('memory',{title:'Initial',content:'Original fact.'},{human:true});
 const original=w.snapshotFor('active','/work');
 await w.propose('memory',{title:'Later',content:'Subsequent fact.'},{human:true});
 for(let i=0;i<550;i++){
  w.snapshotFor('idle-'+i,'/work');
  assert.deepEqual(w.snapshotFor('active','/work'),original);
 }
 assert.equal(w.snapshots.size,512);
 assert.equal(w.snapshots.has(w.snapshotKey('idle-0','/work')),false);
}));

test('memory priorities preserve legacy facts, pin important entries and cold-tier temporary originals',()=>fixture(async(w,dir)=>{
 const pinned=await w.propose('memory',{title:'Constraint',content:'Pinned fact. '.repeat(25),priority:'pinned'},{human:true});
 for(let i=0;i<15;i++)await w.propose('memory',{title:'Normal '+i,content:('Regular fact '+i+'. ').repeat(25)},{human:true});
 const temporary=await w.propose('memory',{title:'Old temporary',content:'Recall this original temporary detail.',priority:'temporary'},{human:true});
 await w.mutate(state=>{state.records.find(r=>r.id===temporary.id).updatedAt='2020-01-01T00:00:00Z';delete state.records.find(r=>r.title==='Normal 14').priority;});
 const snapshot=w.snapshotFor('s','/work');
 assert.equal(snapshot.memories[0].id,pinned.id);
 assert(!snapshot.memories.some(r=>r.id===temporary.id));
 assert(snapshot.memories.some(r=>r.title==='Normal 14'));
 assert(snapshot.memoryBudget.used<=2200);
 assert.equal(w.recallContext({id:temporary.id},'/work').record.text,temporary.content);
 assert.equal(w.view().memorySnapshot.cold,1);
 await assert.rejects(w.edit(pinned.id,{priority:'unknown'}));
 await w.edit(temporary.id,{priority:'normal'});
 assert.equal(w.view().memorySnapshot.cold,0);
 assert((await readFile(path.join(dir,'workspace.json'),'utf8')).includes(temporary.content));
}));

test('legacy snapshots upgrade without rewriting frozen memory and malformed companion is preserved',()=>fixture(async(w,dir)=>{
 const before=w.snapshotFor('one','/work');await w.snapshotQueue;
 await writeFile(path.join(dir,'memory-snapshots.json'),JSON.stringify({version:1,entries:[...w.snapshots]}));
 const reload=new Workspace(dir);await reload.load();assert.deepEqual(reload.snapshotFor('one','/work'),before);await reload.dispose();
 const corrupt=JSON.stringify({version:1,entries:[...w.snapshots],continuity:[[w.snapshotKey('one','/work'),{handoff:'unsafe'}]]});
 await writeFile(path.join(dir,'memory-snapshots.json'),corrupt);
 const broken=new Workspace(dir);await broken.load();assert(broken.snapshotError);await broken.dispose();
 assert.equal(await readFile(path.join(dir,'memory-snapshots.json'),'utf8'),corrupt);
}));

test('disabled visual theme retains its management entry and visible accessible switch',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.qa={Settings,ExtensionEntry,ConversationImports};return {name:'dsh-ui-stronger',inject:");
 const win={__ModuleLoader__:{load:bundle=>bundle.factory(id=>id==='react'?React:{})}};
 vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});
 const state={preferences:{enabled:false,motion:true,startup:true},capabilities:{},error:''};
 const store={snapshot:()=>state,subscribe:()=>()=>{},update(){}};
 const entry=renderToStaticMarkup(React.createElement(win.qa.ExtensionEntry,{store}));
 assert.match(entry,/界面与扩展/);
 const settings=renderToStaticMarkup(React.createElement(win.qa.Settings,{store,tab:'interface'}));
 assert.match(settings,/type="button" role="switch" aria-label="界面强化" aria-checked="false"/);
 const imports=renderToStaticMarkup(React.createElement(win.qa.ConversationImports,{control:async()=>({items:[]}),navigation:{}}));
 assert.match(imports,/zs-import-upload/);assert.match(imports,/aria-label="选择对话导出文件"/);
 assert.doesNotMatch(source,/if\(!s\.preferences\.enabled\|\|!tab\)return null/);
 assert.match(source,/\.zs-import-upload svg\{width:16px;height:16px/);
});
