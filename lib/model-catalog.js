// Model names load independently; do not resolve every model's capabilities up front.
export function createModelCatalog(ctx,{timeout=1600,cacheMs=15000}={}){
 let generation=0,disposed=false,inflight=null;const pending=new Map(),groups=new Map();
 const bounded=(operation,ms=timeout)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('模型目录暂不可用')),ms);Promise.resolve(operation).then(resolve,reject).finally(()=>clearTimeout(timer));});
 const reasoning=value=>Array.isArray(value?.efforts)?{efforts:value.efforts.filter(e=>typeof e.id==='string').map(e=>({id:e.id,name:e.name??e.id,...e.description?{description:e.description}:{}})),...typeof value.defaultEffort==='string'?{defaultEffort:value.defaultEffort}:{}}:undefined;
 async function group(provider,selection){
  const key=provider.id+'\0'+(selection?.provider===provider.id?selection.model:''),cached=groups.get(key);if(cached&&Date.now()-cached.at<cacheMs)return {group:cached.value};
  if(pending.has(key))return pending.get(key);const epoch=generation;
  const work=(async()=>{try{
   const models=await bounded(ctx.get('llm').listModels(provider.id));if(!Array.isArray(models)||models.length>5000)throw Error('目录格式无效');
   const entries=models.filter(m=>typeof m.id==='string').map(m=>({id:m.id,name:m.name??m.id,...m.description?{description:m.description}:{},...reasoning(m.reasoning)?{reasoning:reasoning(m.reasoning)}:{}}));
   const selected=entries.find(m=>selection?.provider===provider.id&&selection.model===m.id);
   if(selected&&!selected.reasoning)try{const info=await bounded(Promise.resolve().then(()=>ctx.get('llm').resolveModelInfo(provider.id,selected.id)),Math.min(timeout,700));const value=reasoning(info.reasoning);if(value)selected.reasoning=value;}catch{}
   const value={id:provider.id,name:provider.name,models:entries};if(!disposed&&epoch===generation)groups.set(key,{at:Date.now(),value});return {group:value};
  }catch{return {failure:{id:provider.id,name:provider.name,message:'该供应商目录暂不可用，可刷新重试。'}};}})();
  pending.set(key,work);void work.finally(()=>{if(pending.get(key)===work)pending.delete(key);});return work;
 }
 return {load(){if(disposed)return Promise.reject(Error('模型目录已关闭'));if(inflight)return inflight;let selection,providers;try{selection=ctx.get('agentDefaultModel').currentSelection();providers=ctx.get('llm').listProviders();if(!Array.isArray(providers))throw Error();}catch{return Promise.reject(Error('模型目录暂不可用'));}const operation=Promise.all(providers.map(p=>group(p,selection))).then(rows=>{const values=rows.flatMap(r=>r.group?.models.length?[r.group]:[]);return {default:{...selection},groups:values,routableProviders:values.map(g=>g.id),failures:rows.flatMap(r=>r.failure?[r.failure]:[])};});inflight=operation;void operation.finally(()=>{if(inflight===operation)inflight=null;});return operation;},invalidate(){generation++;inflight=null;pending.clear();groups.clear();},dispose(){disposed=true;generation++;pending.clear();groups.clear();}};
}

export function wireModelCatalog(ctx,options={}){
 ctx.inject(['sessionController','llm','agentDefaultModel'],scope=>{
  const service=scope.get('sessionController'),original=service.modelCatalog;if(typeof original!=='function')return;
  const catalog=createModelCatalog(scope,options),nativeTimeout=options.nativeTimeout??250,waiting=new Map();let active=true,nativePending=null,cache=null,generation=0;
  const replacement=function(...args){
   if(!active)return original.apply(this,args);const selection=scope.get('agentDefaultModel').currentSelection(),key=JSON.stringify(selection);if(cache&&cache.key===key&&Date.now()-cache.at<15000)return Promise.resolve(cache.value);
   const epoch=generation;if(!nativePending){const work=Promise.resolve().then(()=>original.apply(this,args));nativePending=work;void work.then(value=>{if(active&&epoch===generation&&value?.groups?.length&&!value.failures?.length)cache={key,at:Date.now(),value};},()=>{}).finally(()=>{if(nativePending===work)nativePending=null;});}
   const native=nativePending;return new Promise((resolve,reject)=>{let settled=false,fallbackStarted=false;const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);waiting.delete(timer);fn(value);};const fallback=()=>{if(settled||fallbackStarted)return;fallbackStarted=true;Promise.resolve().then(()=>catalog.load()).then(value=>{if(active&&epoch===generation&&value.groups.length&&!value.failures.length)cache={key,at:Date.now(),value};finish(resolve,value);},e=>finish(reject,e));};const timer=setTimeout(fallback,nativeTimeout);waiting.set(timer,e=>finish(reject,e));native.then(value=>finish(resolve,value),fallback);});
  };
  scope.effect(()=>{service.modelCatalog=replacement;return()=>{active=false;for(const cancel of waiting.values())cancel(Error('模型目录已关闭'));waiting.clear();if(service.modelCatalog===replacement)service.modelCatalog=original;catalog.dispose();};});
  for(const event of ['llm/adapters-updated','settings/document-updated','credentials/record-updated','credentials/reference-updated'])scope.on(event,()=>{generation++;cache=null;nativePending=null;catalog.invalidate();},{global:true});
 });
}
