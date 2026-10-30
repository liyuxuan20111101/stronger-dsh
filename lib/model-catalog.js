// Keep the native catalog contract, while isolating slow provider discovery.
// No configuration, credentials or model-selection state is written here.
export function createModelCatalog(ctx,{timeout=8000}={}){
 const pending=new Map();let inflight=null,disposed=false;
 const bounded=operation=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('模型目录读取超时，请重试或检查供应商连接。')),timeout);operation.then(resolve,reject).finally(()=>clearTimeout(timer));});
 const providerGroup=provider=>{
  let operation=pending.get(provider.id);
  if(!operation){
   const discovery=(async()=>{
    const models=await ctx.get('llm').listModels(provider.id);
    const entries=await Promise.all(models.map(async model=>{
     const resolved=await ctx.get('llm').resolveModelInfo(provider.id,model.id);
     return {id:model.id,name:model.name,...model.description===undefined?{}:{description:model.description},...resolved.reasoning===undefined?{}:{reasoning:{efforts:resolved.reasoning.efforts.map(e=>({id:e.id,name:e.name,...e.description===undefined?{}:{description:e.description}})),...resolved.reasoning.defaultEffort===undefined?{}:{defaultEffort:resolved.reasoning.defaultEffort}}}};
    }));
    return {id:provider.id,name:provider.name,models:entries};
   })();
   operation=bounded(discovery).then(group=>({group}),()=>({failure:{id:provider.id,name:provider.name,message:'模型目录暂不可用，请重试或检查供应商连接。'}}));
   pending.set(provider.id,operation);
   operation.finally(()=>{if(pending.get(provider.id)===operation)pending.delete(provider.id);}).catch(()=>{});
  }
  return operation;
 };
 return {
  load(){
   if(disposed)return Promise.reject(Error('模型目录已关闭'));
   if(inflight)return inflight;
   // Capture the provider set for this read. Refreshes never reuse completed data.
   const providers=ctx.get('llm').listProviders(),selection=ctx.get('agentDefaultModel').currentSelection();
   const operation=Promise.all(providers.map(providerGroup)).then(rows=>{const groups=rows.flatMap(r=>r.group?.models.length?[r.group]:[]);return {default:{...selection},groups,routableProviders:groups.map(g=>g.id),failures:rows.flatMap(r=>r.failure?[r.failure]:[])};});
   inflight=operation;operation.finally(()=>{if(inflight===operation)inflight=null;}).catch(()=>{});return operation;
  },
  invalidate(){inflight=null;pending.clear();},
  dispose(){disposed=true;pending.clear();}
 };
}
export function wireModelCatalog(ctx,options){
 ctx.inject(['sessionController','llm','agentDefaultModel'],scope=>{
  const service=scope.get('sessionController'),original=service.modelCatalog;
  if(typeof original!=='function')return;
  const catalog=createModelCatalog(scope,options),replacement=()=>catalog.load();
  scope.effect(()=>{service.modelCatalog=replacement;return ()=>{if(service.modelCatalog===replacement)service.modelCatalog=original;catalog.dispose();};});
  for(const event of ['llm/adapters-updated','settings/document-updated','credentials/record-updated','credentials/reference-updated'])scope.on(event,()=>catalog.invalidate());
 });
}
