import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Bots} from '../lib/bots.js';
import {API_ACTIONS} from '../lib/index.js';

test('small collaboration status is read-only, per-session and does not expose role bodies',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'team-status-'));
 const sessions=new Map([['one',{id:'one',header:{}}],['two',{id:'two',header:{}}],['child',{id:'child',header:{origin:'subagent',parentSession:'one'}}]]);
 const ctx={get:key=>key==='sessions'?sessions:key==='subagents'?{startActivation(){}}:null};
 let bots=new Bots(data,ctx);
 try{
  await bots.load();const before=JSON.stringify(bots.state);
  const first=bots.policyStatus('one');assert(first.editable);assert(first.available);assert.equal(first.policy.enabled,false);
  assert.equal(JSON.stringify(bots.state),before);
  assert(!bots.policyStatus('child').editable);assert(!bots.policyStatus('missing').editable);
  assert.deepEqual(Object.keys(first).sort(),['available','editable','policy','reason','revision','sessionId']);
  assert(JSON.stringify(first).length<400);
  await bots.configurePolicy({sessionId:'one',revision:first.revision,...first.policy,enabled:true});
  assert(bots.policyStatus('one').policy.enabled);assert(!bots.policyStatus('two').policy.enabled);
  await assert.rejects(bots.configurePolicy({sessionId:'one',revision:first.revision,...first.policy}),/版本/);
  await assert.rejects(bots.configurePolicy({sessionId:'child',revision:bots.state.revision,...first.policy,enabled:true}));
  await bots.close();bots=new Bots(data,ctx);await bots.load();assert(bots.policyStatus('one').policy.enabled);
  const unavailable=new Bots(data,{get:key=>key==='sessions'?sessions:null});await unavailable.load();assert(!unavailable.policyStatus('one').available);await unavailable.close();
  assert.throws(()=>bots.policyStatus('x'.repeat(161)));assert(API_ACTIONS.includes('teamPolicyStatus'));
 }finally{await bots.close();await rm(data,{recursive:true,force:true});}
});

test('three file entry points share one accessible picker without native nested upload chrome',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.qa={LocalFilePicker,TeamAccess};return {name:'dsh-ui-stronger',inject:");
 const win={__ModuleLoader__:{load:bundle=>bundle.factory(id=>id==='react'?React:{})}};
 vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,...['背景','对话','工作台'].map(label=>React.createElement(win.qa.LocalFilePicker,{key:label,label,hint:'本机文件',disabled:label==='背景',accept:'.json',onChange(){}}))));
 assert.equal((html.match(/type="file"/g)||[]).length,3);
 const ids=[...html.matchAll(/<input id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,3);
 for(const id of ids)assert(html.includes('for="'+id+'"'));
 assert.match(html,/aria-disabled="true"/);
 assert.equal((source.match(/type:'file'/g)||[]).length,1,'all owned file selectors must reuse the shared picker');
 assert.match(source,/backgroundFlight\.current=true/);
 const team=renderToStaticMarkup(React.createElement(win.qa.TeamAccess,{store:{},control:async()=>({}),sessionId:'one'}));
 assert.equal((team.match(/role="switch"/g)||[]).length,1);
 assert.match(team,/aria-label="允许本会话调用子智能体"/);
 assert.doesNotMatch(source,/aria-label':'允许当前会话自主协作'/,'advanced panel does not duplicate the header switch');
 assert.match(source,/readVersion\.current===version/,'late status reads cannot overwrite a successful toggle');
});

test('native new-chat content is centered within symmetric rails and collapsed icon remains visible',async()=>{
 const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
 const styles=source.slice(source.indexOf(' const SURFACE_CSS='),source.indexOf(' function wireEntryOwnership('));
 assert.match(styles,/grid-template-columns:12px minmax\(0,1fr\) 12px/);
 assert.match(styles,/\.wtg9ga_newSessionContent\{width:100%;/);
 assert.match(styles,/\.wtg9ga_newSessionLabelMask\{[^}]*mask-image:none!important/);
 assert.match(styles,/\.wtg9ga_collapsed \.wtg9ga_newSession svg\{display:block/);
 assert.match(styles,/\.zs-file-picker>input\[type=file\][^}]*min-height:0!important/);
 assert.match(styles,/prefers-reduced-motion:reduce/);
 assert(source.includes('+ANGULAR_CSS+TERMINAL_CSS+SURFACE_CSS;'));
 assert.doesNotMatch(source,/font:(?:\d{3} )?\d+px(?:\/[\d.]+(?:px)?)? inherit/);
 assert.match(styles,/::-webkit-slider-runnable-track\{height:3px/);
});

test('WeChat picker renders while selection and capabilities are both absent',async()=>{
 const source=(await readFile(new URL('../lib/client.js',import.meta.url),'utf8')).replace("return {name:'dsh-ui-stronger',inject:","window.qa={WechatModelPicker};return {name:'dsh-ui-stronger',inject:");
 const win={__ModuleLoader__:{load:bundle=>bundle.factory(id=>id==='react'?React:{})}};
 vm.runInNewContext(source,{window:win,setTimeout,clearTimeout});
 const markup=renderToStaticMarkup(React.createElement(win.qa.WechatModelPicker,{control:async()=>({})}));
 assert.match(markup,/正在读取模型/);assert.match(markup,/微信思考强度/);
});
