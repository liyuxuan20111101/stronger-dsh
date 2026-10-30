import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160&&!/[\x00-\x1f]/.test(x);
export class ModelAccess{
 constructor(data){this.file=path.join(data,'model-access.json');this.ready=false;this.state={version:1,providers:[],models:[]};this.queue=Promise.resolve();}
 async load(){await mkdir(path.dirname(this.file),{recursive:true});try{const s=JSON.parse(await readFile(this.file,'utf8'));if(!s||Object.keys(s).some(k=>!['version','providers','models'].includes(k))||s.version!==1||!Array.isArray(s.providers)||!Array.isArray(s.models)||s.providers.length>200||s.models.length>2000||s.providers.some(x=>!id(x))||s.models.some(x=>!x||Object.keys(x).some(k=>!['provider','model'].includes(k))||!id(x.provider)||!id(x.model)))throw Error('模型调用开关数据损坏');this.state=s;}catch(e){if(e.code!=='ENOENT')throw e;}this.ready=true;}
 view(){return structuredClone(this.state);}
 allowed(provider,model){return this.ready&&!this.state.providers.includes(provider)&&!this.state.models.some(x=>x.provider===provider&&x.model===model);}
 set({provider,model,enabled}){const job=this.queue.then(async()=>{if(!this.ready)throw Error('模型调用开关尚未就绪');if(!id(provider)||model!==undefined&&!id(model)||typeof enabled!=='boolean')throw Error('无效模型开关');const next=this.view();if(model===undefined){next.providers=next.providers.filter(x=>x!==provider);if(!enabled)next.providers.push(provider);}else{next.models=next.models.filter(x=>x.provider!==provider||x.model!==model);if(!enabled)next.models.push({provider,model});}if(next.providers.length>200||next.models.length>2000)throw Error('模型开关数量超出上限');const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(next,null,2));await rename(tmp,this.file);this.state=next;return this.view();});this.queue=job.catch(()=>{});return job;}
}
export function wireModelAccess(ctx,access){
 ctx.on('llm/stream',(options,next)=>(async function*(){if(!access.allowed(options.provider,options.model))throw Error('该供应商或模型已在界面增强的调用开关中停用；请在“模型与供应商”重新开启或切换模型。');yield* next();})(),{global:true});
 ctx.effect(()=>()=>access.queue);
}
