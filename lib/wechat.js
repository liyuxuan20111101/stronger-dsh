import {readFile,writeFile,mkdir,rename,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function redactWechatError(value){
 let text=String(value??'').slice(0,12000);
 text=text.replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g,'[私钥已隐藏]')
  .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w_]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,'[凭据已隐藏]')
  .replace(/\bBearer\s+[^\s,;"']+/gi,'Bearer [已隐藏]')
  .replace(/(["']?(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|cookie|credential|aeskey|aes_key|context_token)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1[已隐藏]')
  .replace(/https?:\/\/[^\s<>"']+/gi,url=>{try{const u=new URL(url);return u.origin+u.pathname+(u.search?'?[参数已隐藏]':'');}catch{return '[地址已隐藏]';}})
  .replace(/\b[A-Z]:[\\/][^\r\n"'<>，。；]+/gi,'[本机路径已隐藏]')
  .replace(/\/(?:Users|home)\/[^\r\n"'<>，。；]+/g,'[本机路径已隐藏]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已隐藏]')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
 if(/["'](?:messages|prompt|headers|request_body|requestBody|body|content|system|tools)["']\s*:/i.test(text))return '原始错误含请求内容或头部，已隐藏；可在本机 DSH 查看原始记录。';
 return text.slice(0,900);
}
export function wechatErrorReport(error,{stage='执行',kind='error',task='主任务'}={}){
 const fields={},messages=[],seen=new Set();let nodes=0;
 const walk=(value,depth=0)=>{if(value==null||depth>4||++nodes>40)return;if(typeof value==='string'){
   const trimmed=value.trim();let decoded;try{const json=trimmed.replace(/^\d{3}:\s*/,'');if(json.startsWith('{')&&json.length<=16000)decoded=JSON.parse(json);}catch{}
   if(decoded){walk(decoded,depth+1);return;}if(value.trim())messages.push(redactWechatError(value));return;
  }if(typeof value!=='object'||seen.has(value))return;seen.add(value);
  for(const key of ['status','statusCode','httpStatus','code','requestId','request_id']){const v=value[key];if((typeof v==='string'||typeof v==='number')&&String(v).length<=160)fields[key]=redactWechatError(v);}
  for(const key of ['message','msg'])if(typeof value[key]==='string')walk(value[key],depth+1);
  if(typeof value.displayMsg?.zh==='string')walk(value.displayMsg.zh,depth+1);
  for(const key of ['error','cause','details','reason','upstream'])if(value[key]!==undefined)walk(value[key],depth+1);
 };
 walk(error);
 const status=fields.status??fields.statusCode??fields.httpStatus,requestId=fields.requestId??fields.request_id;
 const codes=fields.code??kind,body=[`【${task}异常】`,`阶段：${stage} · 类型：${codes}`,status!==undefined?`HTTP：${status}`:'',requestId?`请求编号：${requestId}`:'',...Array.from(new Set(messages)).slice(0,3).map((x,i)=>(i?'关联原因：':'原因：')+x)];
 if(!messages.length)body.push(({blocked:'原因：任务被权限或审批阻止。',aborted:'原因：任务已中断或取消。','max-tokens':'原因：模型达到输出上限，结果可能不完整。'})[kind]??'未提供可安全回传的详细原因，请查看本机 DSH 记录。');
 const joined=body.filter(Boolean).join('\n');
 return (joined+(/11128|unapproved channel|渠道验证|通道验证/i.test(joined)?'\n建议：检查供应商允许的接入渠道；反复重发通常无效。':kind==='blocked'?'\n建议：任务被权限或审批阻止，请在 DSH 核对；不会自动放宽权限。':'')).slice(0,1800);
}
export function wechatGuidance(){return '这是微信通道的原生 DSH 主会话。先 workspace_team catalog 确认协作开关；关闭时单模型直接完成，不尝试绕过。开启后按任务需要用 dispatch 批量分工（默认两个并行，具体以用户设置为准），明确职责、验收、依赖和独占范围；用 timeline 批量查看，未结束时用 wait 等待而不是轮询，并 review 核验，不把接收或结束说成通过验收。消息默认存入收件箱；需要原生唤醒直接父/子时可 message(wake=true)，不循环唤醒。使用原生工具与 skill 按需加载；不复制整段历史。微信不增加权限，仍遵守工作区与安全审查；需要桌面审批时明确说明。';}
export function validateInbound(content,limits){
 if(typeof content==='string'){if(!content.trim()||content.length>64000||content.includes('\0'))throw Error('微信文字为空或超出限制');return content;}
 if(!Array.isArray(content)||!content.length||content.length>64)throw Error('微信消息分段无效');let chars=0,images=0,bytes=0;
 const checked=content.map(b=>{if(!b||typeof b!=='object')throw Error('微信消息块无效');if(b.type==='text'){if(Object.keys(b).some(k=>!['type','text'].includes(k))||typeof b.text!=='string'||b.text.includes('\0')||(chars+=b.text.length)>64000)throw Error('微信文字超出限制');return {type:'text',text:b.text};}if(b.type!=='image'||Object.keys(b).some(k=>!['type','mediaType','data'].includes(k))||typeof b.data!=='string'||!limits||!['maxImagesPerMessage','maxImageBytes','maxMessageImageBytes'].every(k=>Number.isSafeInteger(limits[k])&&limits[k]>0)||++images>limits.maxImagesPerMessage)throw Error('不支持的附件或图片过多');if(b.data.length>Math.ceil(limits.maxImageBytes/3)*4+4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.data))throw Error('图片编码无效');const raw=Buffer.from(b.data,'base64');if(!raw.length||raw.length>limits.maxImageBytes||(bytes+=raw.length)>limits.maxMessageImageBytes)throw Error('图片大小超出限制');const format=raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':raw[0]===255&&raw[1]===216&&raw[2]===255?'image/jpeg':raw.subarray(0,6).toString().match(/^GIF8[79]a$/)?'image/gif':raw.subarray(0,4).toString()==='RIFF'&&raw.subarray(8,12).toString()==='WEBP'?'image/webp':null;if(format!==b.mediaType)throw Error('图片类型与文件头不一致');return {type:'image',mediaType:b.mediaType,data:b.data};});if(!images&&!checked.some(b=>b.type==='text'&&b.text.trim()))throw Error('微信消息没有有效文字或图片');return checked;
}
export class WechatBridge {
 constructor(data,ctx,{loadModules}={}){this.data=data;this.ctx=ctx;this.config={version:1,enabled:false,cwd:'',accountId:'',userId:'',allowedCwds:[],shareMemory:false,sessions:{}};this.manager=null;this.epoch=0;this.sessionQueue=Promise.resolve();this.pendingInputs=0;this.closed=false;this.loading=null;this.loadModules=loadModules??(async()=>{const [{ClawbotManager},{createSessionControllerDshClient},qr]=await Promise.all([import('dsh-plugin-clawbot/manager'),import('dsh-plugin-clawbot/dsh'),import('qrcode')]);return {ClawbotManager,createSessionControllerDshClient,qr:qr.default??qr};});}
 async load(){try{const c=JSON.parse(await readFile(path.join(this.data,'wechat.json'),'utf8'));if(c.version!==1||typeof c.enabled!=='boolean'||['cwd','accountId','userId'].some(k=>typeof c[k]!=='string'))throw Error('微信通道配置损坏');if(c.allowedCwds!==undefined&&(!Array.isArray(c.allowedCwds)||c.allowedCwds.length>16||c.allowedCwds.some(x=>typeof x!=='string'||!path.isAbsolute(x))))throw Error('工作区白名单损坏');if(c.shareMemory!==undefined&&typeof c.shareMemory!=='boolean')throw Error('记忆设置损坏');if(c.sessions!==undefined&&(!c.sessions||typeof c.sessions!=='object'||Array.isArray(c.sessions)||Object.entries(c.sessions).some(([id,cwd])=>!id||typeof cwd!=='string')))throw Error('会话映射损坏');this.config={...this.config,...c,allowedCwds:c.allowedCwds??(c.cwd?[c.cwd]:[])};}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(config){await mkdir(this.data,{recursive:true});const p=path.join(this.data,'wechat.json'),tmp=p+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(config,null,2));await rename(tmp,p);this.config=config;}
 owns(id){return typeof id==='string'&&Object.hasOwn(this.config.sessions,id);}
 async checkCwd(cwd){if(typeof cwd!=='string'||!path.isAbsolute(cwd)||cwd.length>1200||path.parse(cwd).root===cwd)throw Error('请选择具体工作区');const st=await lstat(cwd);if(!st.isDirectory()||st.isSymbolicLink())throw Error('工作区不能是链接');const actual=await realpath(cwd);if(!this.config.allowedCwds.includes(actual))throw Error('微信没有访问该工作区的权限');return actual;}
 async configure(payload){const {cwd,enabled,shareMemory=this.config.shareMemory}=payload;let allowedCwds=Object.hasOwn(payload,'allowedCwds')?payload.allowedCwds:(this.config.allowedCwds.length?this.config.allowedCwds:[cwd]);if(typeof enabled!=='boolean'||typeof shareMemory!=='boolean'||!Array.isArray(allowedCwds)||allowedCwds.length>16)throw Error('无效通道设置');if(!allowedCwds.length)throw Error('请明确选择至少一个微信工作区；停用通道请使用停用按钮');const resolved=[];for(const folder of allowedCwds){if(typeof folder!=='string'||!path.isAbsolute(folder)||folder.length>1200||path.parse(folder).root===folder)throw Error('请选择具体工作区');const st=await lstat(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('工作区不能是链接');resolved.push(await realpath(folder));}if(typeof cwd!=='string'||!path.isAbsolute(cwd))throw Error('请选择微信默认工作区');const actual=await realpath(cwd);if(!resolved.includes(actual))throw Error('默认工作区必须在允许列表中');await this.stop();await this.save({...this.config,cwd:actual,enabled,allowedCwds:[...new Set(resolved)],shareMemory});if(enabled&&this.config.accountId&&this.config.userId)await this.start();return this.status();}
 async createSerial(fn){const task=this.sessionQueue.then(fn);this.sessionQueue=task.catch(()=>{});return task;}
 relayState(id){this.relayStates??=new Map();let state=this.relayStates.get(id);if(!state){state={text:'',children:new Map(),toolErrors:[],terminal:false};this.relayStates.set(id,state);while(this.relayStates.size>64)this.relayStates.delete(this.relayStates.keys().next().value);}return state;}
 rootFor(id){
  const visited=new Set(),same=(a,b)=>{const normalize=x=>process.platform==='win32'?path.resolve(x).toLowerCase():path.resolve(x);return normalize(a)===normalize(b);};
  try{let current=id;for(let depth=0;current&&depth<12;depth++){
   if(visited.has(current))return null;visited.add(current);const session=this.ctx.get('sessions')?.get(current);
   if(this.owns(current)){const cwd=this.config.sessions[current];if(!this.config.allowedCwds.includes(cwd))return null;const actual=session&&(this.ctx.get('workingDirectory')?.get(session)??session.header?.cwd);if(actual&&!same(actual,cwd))return null;
    for(const childId of visited){if(childId===current)continue;const child=this.ctx.get('sessions')?.get(childId),childCwd=child&&(this.ctx.get('workingDirectory')?.get(child)??child.header?.cwd);if(!childCwd||!same(childCwd,cwd))return null;}return current;
   }
   if(session?.header?.origin!=='subagent')return null;current=session.header.parentSession;
  }}catch{}return null;
 }
 async notifyOwner(text,epoch=this.epoch){
  const m=this.manager;if(this.closed||epoch!==this.epoch||!this.config.enabled||!this.config.userId||!m?.weixin?.sendText)return false;
  const account=m.resolveAccount?.();if(account?.userId!==this.config.userId||account?.accountId!==this.config.accountId)return false;
  try{await m.weixin.sendText(this.config.userId,text,m.contextTokens?.[this.config.userId]);return true;}catch{this.deliveryFailed=true;return false;}
 }
 projectFrame(frame,handler,epoch){
  if(this.closed||epoch!==this.epoch||!this.config.enabled||frame?.type!=='session/event')return;
  const root=this.rootFor(frame.sessionId),event=frame.event;if(!root||!event)return;
  const state=this.relayState(root),emit=text=>handler({type:'session/event',sessionId:root,event:{type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text}]}}}});
  const failure=reason=>reason&&!['completed','stop'].includes(reason.kind);
  if(root!==frame.sessionId){
   let child=state.children.get(frame.sessionId);if(!child){if(state.children.size>=16)return;child={number:state.children.size+1,status:'running',end:null};state.children.set(frame.sessionId,child);}
   if(event.type==='turn/start'){child.status='running';child.end=null;}
   if(event.type==='turn/end'){
    const key=String(event.seq??'')+':'+String(event.data?.turn??'')+':'+String(event.data?.reason?.kind??'');if(child.end===key)return;child.end=key;
    child.status=failure(event.data?.reason)?'failed':'completed';child.error=child.status==='failed'?wechatErrorReport(event.data?.reason,{stage:'子智能体执行',task:'子任务 '+child.number,kind:event.data?.reason?.kind}):null;
    if(state.terminal&&!this.manager?.watchers?.has(root))void this.notifyOwner(`【协作进展】会话 ${root.slice(-8)}\n`+(child.error??`子任务 ${child.number} 已结束；具体结果由主智能体核对汇总。`),epoch);
   }
   return;
  }
  if(event.type==='turn/start'){state.text='';state.toolErrors=[];state.terminal=false;state.children=new Map([...state.children].filter(([,c])=>c.status==='running'));}
  if(event.type==='assistant/message'){const parts=event.data?.message?.content??event.data?.content;const text=Array.isArray(parts)?parts.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n'):'';if(text)state.text=text;}
  if(event.type==='tool/error'||event.type==='tool/result'&&(event.data?.isError===true||event.data?.error)){
   state.toolErrors.push(wechatErrorReport(event.data?.error??event.data?.result?.error??{message:'工具执行失败；原生结果未提供结构化错误。'},{stage:'工具执行'}));state.toolErrors=state.toolErrors.slice(-2);
  }
  if(event.type==='turn/end'){
   const notes=[];if(failure(event.data?.reason))notes.push(wechatErrorReport(event.data.reason,{kind:event.data.reason.kind,stage:'模型回合'}));
   for(const child of state.children.values())if(child.error)notes.push(child.error.slice(0,650));
   if(state.children.size){const rows=[...state.children.values()];notes.push(`协作：${rows.length} 个子任务，${rows.filter(c=>c.status==='running').length} 个进行中，${rows.filter(c=>c.status==='completed').length} 个已结束，${rows.filter(c=>c.status==='failed').length} 个失败。`);}
   if(state.toolErrors.length)notes.push('本轮工具错误记录（后续可能已恢复）：\n'+state.toolErrors.join('\n'));
   if(notes.length)emit((state.text?state.text+'\n\n':'')+notes.join('\n\n').slice(0,3600));state.terminal=true;
  }
  handler(frame);
 }
 modelPreference(route,write=false){return write?this.createSerial(()=>this.modelPreferenceOperation(route,true)):this.modelPreferenceOperation(route,false);}
 async modelPreferenceOperation(route,write=false){
 const file=path.join(this.data,'wechat-model.json');let saved=null;try{const value=JSON.parse(await readFile(file,'utf8'));if(value.version!==1||!value.route||typeof value.route.provider!=='string'||typeof value.route.model!=='string')throw Error('微信模型配置损坏');saved=value.route;}catch(e){if(e.code!=='ENOENT')throw Error('微信模型配置读取失败，原文件保留');}
 const activeId=this.manager?.state?.loadSessionMap?.()?.[this.config.userId]?.sessionId,sessionId=activeId&&this.owns(activeId)&&this.config.allowedCwds.includes(this.config.sessions[activeId])?activeId:null;
 if(write){if(this.closed)throw Error('微信桥已关闭');if(!route||Object.keys(route).some(k=>!['provider','model','reasoningEffort'].includes(k))||[route.provider,route.model].some(x=>typeof x!=='string'||!x||x.length>200))throw Error('请选择有效模型');const epoch=this.epoch,catalog=await this.ctx.get('sessionController')?.modelCatalog();const model=catalog?.groups?.find(p=>p.id===route.provider)?.models?.find(m=>m.id===route.model);if(!model)throw Error('模型不可用或已停用，请刷新列表');let reasoning=model.reasoning;if(route.reasoningEffort!==undefined&&!reasoning){let timer;try{reasoning=(await Promise.race([Promise.resolve().then(()=>this.ctx.get('llm')?.resolveModelInfo(route.provider,route.model)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('思考强度读取超时，请重试')),1500);})]))?.reasoning;}finally{clearTimeout(timer);}}if(route.reasoningEffort!==undefined&&(typeof route.reasoningEffort!=='string'||!reasoning?.efforts?.some(e=>e.id===route.reasoningEffort)))throw Error('此模型不支持所选思考强度');if(epoch!==this.epoch||this.closed)throw Error('微信连接已改变，请重试');if(this.manager?.watchers?.size)throw Error('微信有任务运行，请等回复结束后切换模型');if(sessionId){await this.checkCwd(this.config.sessions[sessionId]);if(epoch!==this.epoch)throw Error('微信连接已改变，请重试');await this.ctx.get('sessionController').selectModel({sessionId,...route});}const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({version:1,route}));await rename(temp,file);saved=route;}
 const current=sessionId?this.ctx.get('sessions')?.get(sessionId)?.requestHeader?.()?.config:null;return {route:saved,current:current?.provider&&current?.model?{provider:current.provider,model:current.model}:null,sessionId,applied:write&&!!sessionId};
 }
 async dialogCommand(manager,msg){
  if(this.closed||!this.config.enabled||msg.message_type===2||msg.group_id||msg.from_user_id!==this.config.userId||manager!==this.manager||!manager.resolveAccount())return false;
  const parts=msg.item_list??[];if(!parts.length||parts.some(x=>x.type!==1||typeof x.text_item?.text!=='string'))return false;const text=parts.map(x=>x.text_item.text).join('\n').trim(),match=/^\/(help|sessions|switch|archive|restore|delete|confirm|models)(?:\s+(\S+))?$/i.exec(text);if(!match)return false;
  const id=msg.message_id??msg.seq;if(id===undefined)return false;this.commandSeen??=new Set();if(this.commandSeen.has(id))return true;this.commandSeen.add(id);if(this.commandSeen.size>512)this.commandSeen.delete(this.commandSeen.values().next().value);
  if(msg.context_token)manager.contextTokens[this.config.userId]=msg.context_token;
  const epoch=this.epoch,active=()=>{if(epoch!==this.epoch||this.closed||!this.config.enabled||manager!==this.manager)throw Error('微信连接已变更');};const reply=body=>this.notifyOwner(body,epoch),action=match[1].toLowerCase(),arg=match[2];
  if(action==='models'){msg.item_list=[{type:1,text_item:{text:'/model'+(arg?' '+arg:'')}}];return false;}
  try{
   if(action==='help'){await reply('/model 查看模型；/model 序号或provider/model 切换（也更新DSH默认）\n/sessions 列出微信对话；/switch 会话ID 切换\n/archive 会话ID 归档；/restore 会话ID 恢复\n/delete 会话ID 移出微信列表（二次确认，DSH归档记录保留）\n/new 新会话；/reset 另起会话，旧记录保留');return true;}
   const file=path.join(this.data,'wechat-dialogs.json');let state;try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.hidden))throw Error('对话状态损坏');}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,hidden:[]};}
   const registry=this.ctx.get('workspaceRegistry'),archived=new Set(registry?.archivedSessionIds??[]);
   if(action==='sessions'){const rows=Object.entries(this.config.sessions).filter(([id,cwd])=>this.config.allowedCwds.includes(cwd)&&!state.hidden.includes(id));await reply((rows.slice(0,20).map(([id])=>id+(archived.has(id)?' [归档]':'')).join('\n')||'暂无微信对话')+'\n使用完整会话ID操作；最多显示前20条。归档记录仍可恢复。');return true;}
   if(manager.watchers?.size)throw Error('当前有任务运行，请等回复结束后管理对话');
   let target=arg;if(action==='confirm'){const pending=this.pendingDelete;this.pendingDelete=null;if(!pending||pending.code!==arg||Date.now()>pending.until)throw Error('确认码已失效，请重新 /delete');target=pending.id;}
   if(!target||!this.owns(target))throw Error('请选择本微信通道的会话ID');await this.checkCwd(this.config.sessions[target]);active();
   if(action==='delete'){this.pendingDelete={id:target,code:randomUUID().slice(0,8),until:Date.now()+60000};await reply('将归档并从微信列表移除此会话；DSH记录仍保留，不是物理删除。60秒内发送 /confirm '+this.pendingDelete.code);return true;}
   if(action==='switch'){if(archived.has(target)||state.hidden.includes(target))throw Error('请先 /restore 恢复此会话');manager.state.saveSessionMapEntry(this.config.userId,target,{cwd:this.config.sessions[target]});await reply('已切换对话：'+target);return true;}
   if(!registry?.archiveSession||!registry?.unarchiveSession)throw Error('当前宿主不支持安全归档接口，请在DSH管理');
   if(action==='restore'){await registry.unarchiveSession(target);state.hidden=state.hidden.filter(x=>x!==target);}else {await registry.archiveSession(target);if(action==='confirm'&&!state.hidden.includes(target))state.hidden.push(target);for(const [peer,row]of Object.entries(manager.state.loadSessionMap()))if(row.sessionId===target)manager.state.removeSessionMapEntry(peer);}
   const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(state));await rename(temp,file);await reply(action==='restore'?'已恢复对话。':action==='confirm'?'已从微信列表移除，DSH归档记录保留；可用 /restore 会话ID 恢复。':'已归档；下次消息会另起对话。');return true;
  }catch(error){await reply(wechatErrorReport(error,{stage:'管理微信对话'}));return true;}
 }
 wrapCommands(manager){const original=manager.weixinFactory;if(typeof original!=='function')return;manager.weixinFactory=(...args)=>{const client=original.apply(manager,args),get=client.getUpdates.bind(client);client.getUpdates=async(...args)=>{const result=await get(...args);if(result.ret&&result.ret!==0||result.errcode&&result.errcode!==0)return result;const msgs=[];for(const msg of result.msgs??[]){if(!await this.dialogCommand(manager,msg))msgs.push(msg);}return {...result,msgs};};return client;};}
 secureClient(base){
  const epoch=this.epoch,active=()=>{if(this.closed||epoch!==this.epoch||!this.config.enabled)throw Error('微信连接已变更，请重试');};
  const safe=async(stage,fn,notify=false)=>{try{return await fn();}catch(error){const message=wechatErrorReport(error,{stage});if(notify)await this.notifyOwner(message,epoch);throw Error(message);}};
  const validate=async id=>{active();if(!this.config.enabled)throw Error('微信通道已停用');if(!this.owns(id))throw Error('此会话不属于微信通道，请在微信使用 /new');const cwd=await this.checkCwd(this.config.sessions[id]);const actual=this.ctx.get('sessions')?.get(id);const actualCwd=actual?(this.ctx.get('workingDirectory')?.get(actual)??actual.header?.cwd):undefined;if(this.ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(id))throw Error('此会话已归档，请先恢复或 /new');if(actualCwd&&await realpath(actualCwd)!==cwd)throw Error('微信会话目录已改变');active();return cwd;};
  return {...base,call:()=>{throw Error('微信不提供通用宿主调用');},createSession:async args=>safe('创建会话',()=>this.createSerial(async()=>{active();if(!this.config.enabled)throw Error('微信通道已停用');if(this.ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(args?.sessionId))args={...args,sessionId:'clawbot-'+randomUUID()};const cwd=await this.checkCwd(args?.cwd??this.config.cwd);const existing=await base.listSessions();if(args?.sessionId&&(existing.items??[]).some(x=>x.sessionId===args.sessionId)&&!this.owns(args.sessionId))throw Error('不能接管已有桌面对话');if(Object.keys(this.config.sessions).length>=512&&!this.owns(args?.sessionId))throw Error('微信会话映射已达到上限');if(args?.sessionId&&this.owns(args.sessionId))await validate(args.sessionId);else if(args?.sessionId&&this.ctx.get('sessions')?.get(args.sessionId))throw Error('不能接管已有桌面对话');active();const session=await base.createSession({...args,cwd});active();if(typeof session.sessionId!=='string')throw Error('会话创建失败');await this.save({...this.config,sessions:{...this.config.sessions,[session.sessionId]:cwd}});const preference=await this.modelPreference();if(preference.route){if(preference.route.reasoningEffort!==undefined)await this.ctx.get('sessionController').selectModel({sessionId:session.sessionId,...preference.route});else await base.selectModel(session.sessionId,preference.route.provider,preference.route.model);active();}return session;}),true),prompt:async(id,content)=>safe('提交消息',async()=>{await validate(id);const checked=validateInbound(content,this.ctx.get('attachments')?.imageLimits);await validate(id);this.pendingInputs++;try{const result=await base.prompt(id,checked);this.lastInput={at:new Date().toISOString(),parts:Array.isArray(checked)?checked.length:1,images:Array.isArray(checked)?checked.filter(b=>b.type==='image').length:0,textChars:typeof checked==='string'?checked.length:checked.reduce((n,b)=>n+(b.type==='text'?b.text.length:0),0)};return result;}finally{this.pendingInputs--;}}),cancel:async id=>safe('取消任务',async()=>{await validate(id);return base.cancel(id);}),listSessions:async()=>safe('读取会话',async()=>{active();const listed=await base.listSessions();active();return {...listed,items:(listed.items??[]).filter(x=>this.owns(x.sessionId)&&this.config.allowedCwds.includes(this.config.sessions[x.sessionId]))};}),modelCatalog:async(...args)=>safe('读取模型目录',()=>base.modelCatalog(...args)),selectModel:async(id,...rest)=>safe('切换模型',async()=>{await validate(id);return base.selectModel(id,...rest);}),getSessionModel:async id=>safe('读取当前模型',async()=>{await validate(id);return base.getSessionModel(id);}),openMux:(handler,...rest)=>safe('接收事件',()=>{active();return base.openMux(frame=>this.projectFrame(frame,handler,epoch),...rest);},true)};
 }
 async ensure(){const epoch=this.epoch;if(this.closed)throw Error('微信通道已停用');if(this.manager)return this.manager;if(this.loading)return this.loading;this.loading=(async()=>{if(!this.config.enabled||!this.config.cwd)throw Error('请先指定工作目录并启用微信通道');const controller=this.ctx.get('sessionController');if(!controller)throw Error('当前 DSH 缺少原生会话控制接口，未连接');const {ClawbotManager,createSessionControllerDshClient,qr}=await this.loadModules();if(this.closed||epoch!==this.epoch||!this.config.enabled)throw Error('微信通道已停止');this.qr=qr;const cfg={dsh:{cwd:this.config.cwd},weixin:{baseUrl:'https://ilinkai.weixin.qq.com',accountId:this.config.accountId,allowFrom:[this.config.userId||'__binding_required__']},bridge:{stateDir:path.join(this.data,'wechat-state'),typing:true,replyTimeoutMs:600000,pollTimeoutMs:35000,logLevel:'error'}};const manager=new ClawbotManager(cfg,{dsh:this.secureClient(createSessionControllerDshClient(controller)),log:()=>{},eventBus:handler=>this.ctx.on('session/event',(session,event)=>handler({type:'session/event',sessionId:session.id,event}),{global:true}),imageLimits:this.ctx.get('attachments')?.imageLimits});const resolve=manager.resolveAccount.bind(manager);manager.resolveAccount=()=>{const found=resolve();return found&&this.config.accountId&&found.accountId===this.config.accountId&&found.userId===this.config.userId?found:undefined;};this.manager=manager;this.wrapCommands(manager);return manager;})();try{return await this.loading;}finally{this.loading=null;}}
 async start(){const m=await this.ensure();if(!this.config.accountId||!this.config.userId)return;await m.start();}
 status(){const state=this.manager?.getStatus();return {enabled:this.config.enabled,cwd:this.config.cwd,allowedCwds:[...this.config.allowedCwds],shareMemory:this.config.shareMemory,bound:!!this.config.accountId&&!!this.config.userId,phase:state?.phase??'offline',paused:state?.paused??true,connected:state?.phase==='running'&&state?.paused===false&&!state?.lastError&&!!this.config.userId,ownerOnly:true,pendingInputs:this.pendingInputs,lastInput:this.lastInput??null,login:state?.login?.active??false,lastPollAt:state?.lastPollAt??null,error:state?.lastError?'微信通道暂不可用，请重新扫码或检查网络':''};}
 async login(){if(this.polling)try{await this.polling;}catch{}const m=await this.ensure();m.wxCfg.allowFrom=['__binding_required__'];const result=await m.startLogin(true);if(this.closed||m!==this.manager||!this.config.enabled)throw Error('微信连接已变更，请重新扫码');if(!result.ok)throw Error('无法创建微信二维码，请检查网络后重试');const url=m.getStatus().login.qrcodeUrl;if(typeof url!=='string'||url.length>4000)throw Error('微信未返回有效的绑定二维码');return {...this.status(),qr:await this.qr.toDataURL(url,{width:280,margin:2,errorCorrectionLevel:'M'}),expiresAt:m.getStatus().login.expiresAt};}
 async poll(verifyCode){
  if(verifyCode!==undefined){if(typeof verifyCode!=='string'||!/^[-A-Za-z0-9]{4,32}$/.test(verifyCode))throw Error('请输入微信显示的有效配对码');this.pendingCode=verifyCode;}
  if(this.polling){await this.polling;if(verifyCode!==undefined)return this.poll();return this.status();}
  this.polling=(async()=>{const m=await this.ensure(),code=this.pendingCode;this.pendingCode=undefined;const r=await m.pollLogin(code,{timeoutMs:10000});if(this.closed||m!==this.manager||!this.config.enabled)throw Error('微信通道已停止');
   if(r.ok&&r.status==='confirmed'){const {accountId,userId}=m.getStatus().account??{};if(!accountId||!userId){await this.stop();throw Error('微信未返回账号本人标识，通道保持关闭');}await this.save({...this.config,accountId,userId});m.wxCfg.allowFrom=[userId];}
   if(r.status==='already-connected'){if(!this.config.accountId||!this.config.userId||!m.resolveAccount())throw Error('微信已有其他绑定，无法确认本插件拥有该认证；请在微信解除旧绑定后重新扫码');await m.resume();m.wxCfg.allowFrom=[this.config.userId];}
   const refreshed=r.status==='expired'&&m.getStatus().login.active?{qr:await this.qr.toDataURL(m.getStatus().login.qrcodeUrl,{width:280,margin:2,errorCorrectionLevel:'M'})}:{};
   return {...this.status(),...refreshed,loginStatus:r.status??null,ok:r.ok!==false};})();try{return await this.polling;}finally{this.polling=null;}
 }
 async stop(){this.epoch++;this.pendingCode=undefined;this.relayStates?.clear();if(this.loading)try{await this.loading;}catch{}const manager=this.manager;this.manager=null;if(manager){manager.cancelLogin();manager.wxCfg.allowFrom=['__disabled__'];await manager.stop();}}
 async dispose(){this.closed=true;await this.stop();}
}
