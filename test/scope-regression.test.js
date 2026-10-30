import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {WechatBridge} from '../lib/wechat.js';
import {Workspace} from '../lib/workspace.js';
const temporary=async fn=>{const root=await mkdtemp(path.join(tmpdir(),'scope-regression-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
test('explicit empty WeChat allowlist never silently restores a previously selected directory',()=>temporary(async root=>{
 const folder=path.join(root,'tasks');await mkdir(folder);const bridge=new WechatBridge(path.join(root,'data'),{get:()=>null});await bridge.load();
 await bridge.configure({cwd:folder,enabled:false});const before=await readFile(path.join(root,'data','wechat.json'),'utf8');
 await assert.rejects(bridge.configure({cwd:folder,enabled:true,allowedCwds:[]}),/明确选择/);assert.equal(bridge.config.enabled,false);assert.equal(await readFile(path.join(root,'data','wechat.json'),'utf8'),before);
 await bridge.configure({cwd:folder,enabled:true,allowedCwds:[folder]});await bridge.configure({cwd:folder,enabled:false});assert.equal(bridge.status().enabled,false);await bridge.dispose();
}));
test('workspace-scoped persona is never injected into another directory even when channel memory is shared',()=>temporary(async root=>{
 const workspace=new Workspace(root);await workspace.load();const persona=await workspace.propose('persona',{title:'Project tone',content:'Use the project-specific style',scope:'workspace'},{human:true,cwd:'/approved-project'});await workspace.persona(persona.id);
 assert.equal(workspace.prompt('/approved-project').persona.title,'Project tone');assert.equal(workspace.prompt('/other-project').persona,null);
 workspace.shareMemory=()=>true;assert.equal(workspace.prompt('/other-project','wechat').persona,null);assert.equal(workspace.prompt('/approved-project','wechat').persona.title,'Project tone');
 assert.equal(workspace.snapshotFor('other-session','/other-project').persona,null);await workspace.dispose();
}));
