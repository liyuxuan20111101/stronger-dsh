import {Computer,wireComputer} from './computer.js';
import {Bots,wireBots} from './bots.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import packageInfo from '../package.json' with {type:'json'};
import {homedir} from 'node:os';
import path from 'node:path';
import {LocalMedia} from './media.js';
import {Workspace,wireWorkspace} from './workspace.js';
import {wireGuard} from './guard.js';
import {Workbench,wireWorkbench} from './workbench.js';
import {WechatBridge,wechatGuidance} from './wechat.js';
import {Assurance,wireAssurance} from './assurance.js';
import {Intelligence,wireIntelligence} from './intelligence.js';
import {wireModelCatalog} from './model-catalog.js';
import {wireBoot} from './boot.js';
import {ThinkingStore,thinkingTool} from './thinking.js';
import {ModelAccess,wireModelAccess} from './model-access.js';
export const name='dsh-ui-stronger';
export const inject=['commands'];
export const CHANNEL='/ui-stronger';
export const API_ACTIONS=Object.freeze(["activateBot","activity","asset","bots","builtinSkill","cancelTeamTask","compactNow","configure","configureIntelligence","configureWorkbench","connections","contextUsage","conversationStyle","createWorkspace","deleteArchivedSession","deleteSkill","editRecord","importConversations","indexKnowledge","intelligence","knowledgeRoot","modelAccess","modelCapabilities","reloadSkills","modelCatalog","modelStatus","persona","preferences","processTrace","recall","record","recordStatus","refreshMemory","removeKnowledgeRoot","saveBots","searchHistory","searchKnowledge","selectModel","sessionUsage","setModelAccess","setWechatModel","skillLearning","speak","status","stop","taskProfile","teamPolicy","teamPolicyStatus","teamTimeline","thinking","wechatConfigure","wechatLogin","wechatModel","wechatPoll","wechatStatus","workbench","workspace","workspaces"]);
const defaults={enabled:true,motion:true,startup:true,voice:false,pet:false};
export function answerText(event){if(event?.type!=='assistant/message')return '';return (event.data?.message?.content??[]).filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n').slice(0,8000);}
export function apply(ctx){
 const data=path.join(process.env.DSH_HOME||path.join(homedir(),'.dsh'),'plugins-data','dsh-ui-stronger');
 const bots=new Bots(data,ctx);wireBots(ctx,bots);const media=new LocalMedia(data),workspace=new Workspace(data),workbench=new Workbench(data,ctx),wechat=new WechatBridge(data,ctx),intelligence=new Intelligence(data,ctx);let preferences={...defaults},revision=0,connectionsRevision=0,disposed=false,loadError=null;const sessions=new Map();wireBoot(ctx,()=>preferences.enabled&&preferences.startup);wireIntelligence(ctx,intelligence);wireModelCatalog(ctx);workspace.reviewRoute=()=>intelligence.route('review');
 workspace.channelFor=(id,initialHeader)=>{const seen=new Set();for(let depth=0;id&&depth<12;depth++){if(seen.has(id))return 'isolated';seen.add(id);if(wechat.owns(id))return 'wechat';const session=depth===0&&initialHeader?{header:initialHeader.header??initialHeader}:ctx.get('sessions')?.get(id);if(session?.header?.origin==='subagent'){id=session.header.parentSession;if(!id)return 'isolated';}else return 'desktop';}return 'isolated';};workspace.shareMemory=()=>wechat.config.shareMemory;workbench.sessionAllowed=(id,current,header)=>!workbench.deleted.includes(id)&&(wechat.config.shareMemory||workspace.channelFor(id,header)===workspace.channelFor(current));const thinking=new ThinkingStore(data);ctx.inject(['tools'],scope=>scope.tools.register(thinkingTool(thinking)));const assurance=new Assurance(ctx,workspace);wireAssurance(ctx,assurance);wireWorkspace(ctx,workspace);wireGuard(ctx,workspace);wireWorkbench(ctx,workbench);wireComputer(ctx,new Computer(workspace));
 const access=new ModelAccess(data);wireModelAccess(ctx,access);
 ctx.inject(['systemPrompt'],scope=>scope.systemPrompt.context({name:'ui-stronger:wechat-tools',order:237,interpolate:false,text:({agent})=>agent?.session?.header?.origin!=='subagent'&&wechat.owns(agent?.session?.id)?wechatGuidance():''}));
 const loading=(async()=>{await media.load();await workspace.load();await bots.load();await workbench.load();await wechat.load();await intelligence.load();await access.load();await thinking.loading;if(thinking.error)throw thinking.error;try{const p=JSON.parse(await readFile(path.join(data,'ui.json'),'utf8'));for(const k of Object.keys(defaults))if(typeof p[k]==='boolean')preferences[k]=p[k];}catch{}})().catch(e=>{loadError=e;});
 ctx.inject(['sessionController'],scope=>{void loading.then(()=>{if(!loadError&&wechat.config.enabled)return wechat.start();}).catch(()=>{});});
 const state=()=>({version:packageInfo.version,connectionsRevision,deletedSessions:[...workbench.deleted],preferences:{...preferences},edition:media.capabilities().voice||media.capabilities().pet?'full':'public',capabilities:media.capabilities(),workbench:{modules:workbench.config.modules,historyEnabled:workbench.config.historyEnabled},workspace:{revision:workspace.state.revision,runtime:workspace.runtime,guard:workspace.state.guard,lastReview:workspace.lastReview??null}});
 async function act(action,payload={},signal){
  await loading;if(loadError)throw new Error('本机数据读取失败，未覆盖原文件：'+loadError.message);if(disposed)throw new Error('插件已停用');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('无效参数');
  if(action==='teamPolicyStatus'){if(Object.keys(payload).some(k=>k!=='sessionId'))throw Error('无效会话查询');return bots.policyStatus(payload.sessionId);}if(action==='teamPolicy')return bots.configurePolicy(payload);if(action==='cancelTeamTask'){if(Object.keys(payload).some(k=>!['sessionId','taskId'].includes(k)))throw Error('无效任务操作参数');const parent=ctx.get('agents')?.get(payload.sessionId),row=bots.tasks.runs.find(r=>r.parent===payload.sessionId&&r.id===payload.taskId);if(!parent||!row)throw Error('当前主会话或任务不可用');await bots.cancel(row,parent);return bots.refreshTimeline(payload.sessionId);}if(action==='bots')return bots.view();if(action==='teamTimeline'){if(typeof payload.sessionId!=='string'||!ctx.get('sessions')?.get(payload.sessionId))throw Error('请先打开实际会话');return bots.refreshTimeline(payload.sessionId);}if(action==='saveBots')return bots.save(payload);if(action==='activateBot')return bots.activate(payload.sessionId,payload.profileId);
  if(action==='thinking'){const {op,...args}=payload;if(typeof op!=='string')throw Error('缺少思考操作');return thinking.run(op,args);}
  const fields={deleteArchivedSession:['sessionId','confirm'],wechatModel:[],setWechatModel:['route'],importConversations:['action','id','text','title','offset','confirm'],modelAccess:[],setModelAccess:['provider','model','enabled'],modelStatus:['sessionId'],selectModel:['sessionId','route'],intelligence:['sessionId'],configureIntelligence:['context','routingEnabled','routes','sessionId'],reloadSkills:[],modelCapabilities:['provider','model'],modelCatalog:[],taskProfile:['sessionId','kind'],compactNow:['sessionId'],builtinSkill:['name','enabled'],skillLearning:['enabled'],deleteSkill:['id'],status:[],preferences:Object.keys(defaults),connections:[],configure:['api','reference','transcript','skin'],asset:[],activity:['sessionId','after'],speak:['sessionId','revision','offset'],stop:[],workspace:[],record:['kind','title','content','scope','cwd','name','description','priority'],editRecord:['id','title','content','description','priority'],recordStatus:['id','status'],persona:['id'],conversationStyle:['style'],knowledgeRoot:['path'],removeKnowledgeRoot:['id'],indexKnowledge:[],searchKnowledge:['query'],recall:['query','cwd'],workbench:[],configureWorkbench:['modules','historyEnabled'],sessionUsage:['sessionId'],contextUsage:['sessionId'],processTrace:['sessionId'],searchHistory:['query','sessionId','cursor'],refreshMemory:['sessionId'],wechatStatus:[],wechatConfigure:['cwd','enabled','allowedCwds','shareMemory'],workspaces:[],createWorkspace:['name'],wechatLogin:[],wechatPoll:['verifyCode']};
  if(!fields[action]||Object.keys(payload).some(k=>!fields[action].includes(k)))throw new Error('不支持的操作或参数');
  if(action==='modelAccess')return access.view();
  if(action==='setModelAccess')return access.set(payload);
  if(action==='modelStatus')return intelligence.modelStatus(payload.sessionId);
  if(action==='selectModel')return intelligence.select(payload.sessionId,payload.route,signal);
  if(action==='intelligence')return {...intelligence.view(),compression:await intelligence.contextStatus(payload.sessionId,signal)};
  if(action==='configureIntelligence'){const {sessionId,...settings}=payload;if(sessionId!==undefined&&(typeof sessionId!=='string'||!sessionId||sessionId.length>160))throw Error('无效会话');const value=await intelligence.configure(settings,signal);return {...value,compression:await intelligence.contextStatus(sessionId,signal)};}
  if(action==='wechatModel')return wechat.modelPreference();
  if(action==='setWechatModel')return wechat.modelPreference(payload.route,true);
  if(action==='reloadSkills')return workspace.reloadSkills();if(action==='modelCapabilities')return intelligence.capabilities(payload);if(action==='modelCatalog')return intelligence.catalog();
  if(action==='deleteArchivedSession'){const result=await workbench.deleteArchived(payload.sessionId,payload.confirm);const manager=wechat.manager;for(const [peer,row]of Object.entries(manager?.state?.loadSessionMap?.()??{}))if(row.sessionId===payload.sessionId)manager.state.removeSessionMapEntry(peer);return result;}
  if(action==='taskProfile')return intelligence.task(payload.sessionId,payload.kind);
  if(action==='compactNow')return intelligence.compact(payload.sessionId,signal);
  if(action==='builtinSkill')return workspace.builtinSkill(payload.name,payload.enabled);
  if(action==='skillLearning')return workspace.skillLearning(payload.enabled);
  if(action==='deleteSkill')return workspace.deleteSkill(payload.id);
  if(action==='wechatStatus')return wechat.status();
  if(action==='wechatConfigure')return wechat.configure(payload);
  if(action==='workspaces')return workbench.workspaces();
  if(action==='createWorkspace')return workbench.createWorkspace(payload.name);
  if(action==='wechatLogin')return wechat.login();
  if(action==='wechatPoll')return wechat.poll(payload.verifyCode);
  if(action==='workbench')return workbench.view();
  if(action==='configureWorkbench')return workbench.configure(payload);
  if(action==='processTrace'){if(typeof payload.sessionId!=='string'||payload.sessionId.length>160)throw Error('无效会话');return assurance.trace(payload.sessionId);}
  if(action==='sessionUsage')return workbench.sessionUsage(payload.sessionId);
  if(action==='importConversations')return workbench.imports(payload.action,payload);
  if(action==='contextUsage')return workbench.context(payload.sessionId);
  if(action==='refreshMemory'){if(typeof payload.sessionId!=='string'||!ctx.get('sessions')?.get(payload.sessionId))throw Error('请先打开实际会话');workspace.clearSnapshot(payload.sessionId);return {refreshed:true};}
  if(action==='searchHistory'){const actual=ctx.get('sessions')?.get(payload.sessionId);if(!actual)throw Error('请先打开实际会话');return workbench.history(payload.query,ctx.get('workingDirectory')?.get(actual)??actual.header.cwd,signal,actual.id,payload.cursor);}
  if(action==='workspace')return {...workspace.view(),lastReview:workspace.lastReview??null,audit:workspace.audit??[]};
  if(action==='record')return workspace.propose(payload.kind,payload,{human:true,cwd:payload.cwd??''});
  if(action==='editRecord')return workspace.edit(payload.id,payload);
  if(action==='recordStatus')return workspace.decide(payload.id,payload.status);
  if(action==='persona')return workspace.persona(payload.id);
  if(action==='conversationStyle')return workspace.setConversationStyle(payload.style);
  if(action==='knowledgeRoot')return workspace.addRoot(payload.path);
  if(action==='removeKnowledgeRoot')return workspace.removeRoot(payload.id);
  if(action==='indexKnowledge')return workspace.reindex(signal);
  if(action==='searchKnowledge')return {results:workspace.search(payload.query)};
  if(action==='recall')return {memories:workspace.recall(payload.query,payload.cwd??'')};
  if(action==='status')return state();if(action==='connections')return {...media.config};if(action==='configure'){await media.stop();await media.configure(payload);connectionsRevision++;if(!media.capabilities().voice)preferences.voice=false;if(!media.capabilities().pet)preferences.pet=false;return state();}
  if(action==='preferences'){
   for(const v of Object.values(payload))if(typeof v!=='boolean')throw new Error('开关必须为布尔值');
   if(payload.voice&&!media.capabilities().voice)throw new Error('请先接入本地语音');if(payload.pet&&!media.capabilities().pet)throw new Error('请先接入本机形象');
   preferences={...preferences,...payload};await mkdir(data,{recursive:true});await writeFile(path.join(data,'ui.json'),JSON.stringify(preferences,null,2));if(!preferences.voice||!preferences.enabled)await media.stop();return state();
  }
  if(action==='asset')return preferences.pet&&preferences.enabled?media.asset():null;if(action==='stop'){await media.stop();return state();}
  if(typeof payload.sessionId!=='string'||payload.sessionId.length>160)throw new Error('无效会话');const item=sessions.get(payload.sessionId);
  if(action==='activity')return {busy:item?.busy??false,revision:item?.revision??0,hasAnswer:!!item?.text};
  if(!preferences.enabled||!preferences.voice)throw new Error('请先开启本机语音');if(!item?.text||item.revision!==payload.revision)throw new Error('该回复已更新，请重试');
  if(payload.offset!==undefined&&(!Number.isSafeInteger(payload.offset)||payload.offset<0||payload.offset>8000))throw new Error('无效朗读位置');return media.speak(item.text,payload.offset??0);
 }
 ctx.effect(()=>()=>{disposed=true;sessions.clear();return loading.then(()=>Promise.all([media.dispose(),wechat.dispose(),thinking.close()]));},'ui-stronger: media cleanup');
 ctx.effect(()=>ctx.commands.register({name:'ui',description:'界面增强：status / motion on|off / startup on|off / voice on|off / pet on|off / on / off',input:{hint:'status | motion/startup/voice/pet on/off | on | off'},handler:async({rawInput})=>{
  try{const [key='status',value]=rawInput.trim().split(/\s+/).filter(Boolean);let s;if(key==='status')s=await act('status');else if(['on','off'].includes(key))s=await act('preferences',{enabled:key==='on'});else if(['motion','startup','voice','pet'].includes(key)&&['on','off'].includes(value))s=await act('preferences',{[key]:value==='on'});else throw new Error('可用：status、on/off、motion/startup/voice/pet on/off');return {kind:'success',text:`界面增强 ${s.version} · ${s.preferences.enabled?'已启用':'已停用'} · 语音${s.capabilities.voice?'已接入':'未接入'} · 形象${s.capabilities.pet?'已接入':'未接入'}。`};}catch(e){return {kind:'error',text:e.message};}
 }}),'ui-stronger: slash settings');
 ctx.inject(['connection'],scope=>{const connection=scope.get('connection');if(typeof connection.fetch?.register==='function'){for(const action of API_ACTIONS)connection.fetch.register({path:'/api/ui-stronger/'+action,methods:['POST'],requestBody:'buffered',fetch:createFetchRpc(action,act)});}else if(typeof connection.admit==='function'){scope.inject(['webServer'],web=>{const server=web.get('webServer');web.effect(()=>server.register({kind:'prefix',path:CHANNEL,handler:createPrivateRpc(connection,act)}),'ui-stronger: authenticated owner RPC');});}else scope.effect(()=>connection.rpc.handle(CHANNEL,async(action,payload,signal)=>{try{if(signal?.aborted)throw Error('已取消');return {ok:true,value:await act(action,payload,signal)};}catch(e){return {ok:false,error:{code:'ui-stronger',message:e.message,details:{}}};}}),'ui-stronger: legacy authenticated RPC');});
 ctx.on('session/event',(session,event)=>{
  if(disposed||!preferences.enabled||!['turn/start','turn/end','assistant/message'].includes(event.type))return;const id=session.id,item=sessions.get(id)??{busy:false,text:'',revision:0};
  if(event.type==='turn/start'){item.busy=true;item.text='';}if(event.type==='turn/end')item.busy=false;const text=answerText(event);if(text){item.text=text;item.revision=++revision;}sessions.delete(id);sessions.set(id,item);if(sessions.size>24)sessions.delete(sessions.keys().next().value);
 },{global:true});
}



export function createPrivateRpc(connection,act){return async(req,res)=>{
 const admission=connection.admit(req);if('rejection' in admission||admission.peer?.principal?.kind!=='owner'){res.writeHead(admission.rejection??403);res.end();return;}
 const action=new URL(req.url,'http://dsh.invalid').pathname.slice(CHANNEL.length+1);if(req.method!=='POST'||!/^[-\w]+$/.test(action)){res.writeHead(404);res.end();return;}if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){res.writeHead(415);res.end();return;}
 const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});let body,bytes=0;try{const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>12*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);res.end();return;}
 if(body?.type!=='client-request'||typeof body.rpcId!=='string'||body.rpcId.length>200||body.method!==action){res.writeHead(400);res.end();return;}let result;try{if(abort.signal.aborted)throw Error('已取消');result={ok:true,value:await act(action,body.payload,abort.signal)};}catch(e){result={ok:false,error:{code:'ui-stronger',message:e.message,details:{}}};}if(res.destroyed)return;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify({type:'server-response',rpcId:body.rpcId,result}));
 };}

// Exact Fetch routes use the host's authenticated owner-only registry on every carrier.
export function createFetchRpc(action,act){return async request=>{
 if(request.method!=='POST')return new Response('',{status:405});
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return new Response('',{status:415});
 const expected='ui-stronger/'+action;if(new URL(request.url).pathname!=='/api/'+expected)return new Response('',{status:404});
 let body;try{const reader=request.body?.getReader();if(!reader)return new Response('',{status:400});const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12*1024*1024){await reader.cancel();return new Response('',{status:413});}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return new Response('',{status:400});}
 if(body?.type!=='client-request'||typeof body.rpcId!=='string'||body.rpcId.length>200||body.method!==expected)return new Response('',{status:400});
 let result;try{request.signal.throwIfAborted();result={ok:true,value:await act(action,body.payload,request.signal)};}catch(e){result={ok:false,error:{code:'ui-stronger',message:String(e?.message??'操作失败'),details:{}}};}
 return Response.json({type:'server-response',rpcId:body.rpcId,result},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
};}
