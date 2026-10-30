import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';
import {isAbsolute,join,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const EMPTY={api:'http://127.0.0.1:9880',reference:'',transcript:'',skin:''};
export class LocalMedia {
 constructor(dataDir){this.dataDir=dataDir;this.config={...EMPTY};this.services=null;this.pending=false;this.controller=null;this.closed=false;}
 async load(){try{const c=JSON.parse(await readFile(join(this.dataDir,'connections.json'),'utf8'));for(const k of Object.keys(EMPTY))if(typeof c[k]==='string')this.config[k]=c[k];}catch{} }
 capabilities(){return {voice:!!this.config.reference,pet:!!this.config.skin};}
 async configure(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!Object.hasOwn(EMPTY,k)))throw new Error('无效接入配置');
  for(const [k,v]of Object.entries(payload))if(typeof v!=='string'||v.length>(k==='transcript'?4000:1200)||v.includes('\0'))throw new Error('无效配置字段');
  const next={...this.config,...payload};next.api=next.api.replace(/\/$/,'');
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(next.api))throw new Error('本地语音接口须为 http://127.0.0.1:端口');
  const files=[['reference',new Set(['.wav','.mp3','.flac','.ogg']),64_000_000],['skin',new Set(['.png','.webp','.jpg','.jpeg']),5_000_000]];
  for(const [key,extensions,limit]of files){if(!next[key])continue;if(!isAbsolute(next[key])||!extensions.has(extname(next[key]).toLowerCase()))throw new Error(key==='skin'?'形象须为本机 PNG/WebP/JPG 文件的绝对路径':'参考音频须为本机 WAV/MP3/FLAC/OGG 文件的绝对路径');const s=await stat(next[key]);if(!s.isFile()||s.size>limit)throw new Error('素材不是文件或文件过大');}
  await mkdir(this.dataDir,{recursive:true});const p=join(this.dataDir,'connections.json');await writeFile(p+'.tmp',JSON.stringify(next,null,2));await rename(p+'.tmp',p);this.config=next;return {...next};
 }
 async asset(){if(!this.config.skin)return null;const b=await readFile(this.config.skin);if(b.length>5_000_000)throw new Error('形象文件过大');const mime={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[extname(this.config.skin).toLowerCase()];if(!mime)throw new Error('不支持的形象格式');return {image:`data:${mime};base64,`+b.toString('base64')};}
 async ensureService(){
  if(!this.services){const file=join(this.dataDir,'local-services.mjs');try{await stat(file);this.services=(await import(pathToFileURL(file).href)).createServices(this.dataDir);}catch(e){if(e.code!=='ENOENT')throw e;}}
  await this.services?.start();
 }
 async speak(text,offset=0){
  if(this.closed)throw new Error('插件已停用');if(!this.config.reference)throw new Error('请先接入本地语音');if(this.pending)throw new Error('语音正在合成，请稍后');
  this.pending=true;const controller=new AbortController();this.controller=controller;
  try{
   const cfg={...this.config};if(!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(cfg.api))throw new Error('无效本机语音地址');
   await this.ensureService();const deadline=Date.now()+(this.services?120000:5000);let ready=false;
   while(Date.now()<deadline){controller.signal.throwIfAborted();try{const r=await fetch(cfg.api+'/openapi.json',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(1000)])});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}
   if(!ready)throw new Error('本地语音服务未就绪，请先启动 GPT-SoVITS 服务');controller.signal.throwIfAborted();
   const part=text.slice(offset,offset+160);let end=Math.max(part.lastIndexOf('。'),part.lastIndexOf('！'),part.lastIndexOf('？'),part.lastIndexOf('\n'));if(end<35)end=part.length-1;
   const raw=part.slice(0,end+1),clean=raw.replace(/```[\s\S]*?```/g,'').replace(/[#*_`>]/g,'').trim(),nextOffset=offset+raw.length<text.length?offset+raw.length:null;
   if(!clean)return {wav:'',nextOffset};
   const r=await fetch(cfg.api+'/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean,text_lang:'zh',ref_audio_path:cfg.reference,prompt_text:cfg.transcript,prompt_lang:'zh',media_type:'wav',streaming_mode:false,speed_factor:1}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
   if(!r.ok)throw new Error('本机语音合成失败（'+r.status+'），请检查服务日志');const wav=Buffer.from(await r.arrayBuffer());
   if(wav.length<1000||wav.subarray(0,4).toString()!=='RIFF'||wav.subarray(8,12).toString()!=='WAVE')throw new Error('语音服务未返回有效 WAV');return {wav:wav.toString('base64'),nextOffset};
  }finally{this.pending=false;if(this.controller===controller)this.controller=null;}
 }
 async stop(){this.controller?.abort();await this.services?.stop();}
 async dispose(){this.closed=true;await this.stop();}
}
