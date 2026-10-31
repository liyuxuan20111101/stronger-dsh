function privateContent(s){return /(?:[A-Z]:[\\/]+Users[\\/]+|BEGIN PRIVATE KEY|sk-[A-Za-z0-9_-]{20,})/i.test(s);}
import {readdir,lstat,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const FILES=['lib/computer.js','lib/model-catalog.js','lib/model-access.js','lib/boot.js','lib/intelligence.js','lib/bots.js','lib/thinking.js','lib/assurance.js','lib/wechat.js','lib/workbench.js','lib/workspace.js','lib/guard.js','lib/index.js','lib/media.js','lib/client.js','lib/check-public.js','package.json','cordis.patch.yml','README.md','LICENSE'];
export async function checkArchive(file,root=fileURLToPath(new URL('..',import.meta.url))){
 const tar=gunzipSync(await readFile(file),{maxOutputLength:1_000_000});const seen=new Set();let cursor=0;
 while(cursor+512<=tar.length){const header=tar.subarray(cursor,cursor+512);if(header.every(b=>b===0))break;const name=header.subarray(0,100).toString().split('\0')[0];const relative=name.replace(/^package\//,'');const size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim(),8);const type=header[156];
  if(!name.startsWith('package/')||!FILES.includes(relative)||seen.has(relative)||![0,48].includes(type)||!Number.isSafeInteger(size)||size<0||cursor+512+size>tar.length)throw new Error('Unexpected archive entry: '+name);
  const content=tar.subarray(cursor+512,cursor+512+size),source=await readFile(path.join(root,relative));if(createHash('sha256').update(content).digest('hex')!==createHash('sha256').update(source).digest('hex'))throw new Error('Archive differs from public source: '+relative);seen.add(relative);cursor+=512+Math.ceil(size/512)*512;
 }
 if(seen.size!==FILES.length)throw new Error('Incomplete public archive');return seen.size;
}
export async function checkPublic(root=fileURLToPath(new URL('..',import.meta.url))){
 let count=0;const allowed=new Set(['lib/computer.js','lib/model-catalog.js','lib/model-access.js','lib/boot.js','lib/intelligence.js','lib/bots.js','lib/thinking.js','lib/assurance.js','lib/wechat.js','lib/workbench.js','lib/workspace.js','lib/guard.js','lib/index.js','lib/media.js','lib/client.js','lib/check-public.js','package.json','cordis.patch.yml','README.md','LICENSE']);
 async function walk(dir){for(const name of await readdir(dir)){if(name==='.gitignore'||name==='node_modules'||name==='test'||name==='.market'||name==='.github'||name==='.git'||name==='package-lock.json')continue;const p=path.join(dir,name),s=await lstat(p),r=path.relative(root,p).replaceAll('\\','/');if(s.isSymbolicLink())throw new Error('Linked file forbidden');if(s.isDirectory()){await walk(p);continue;}if(!allowed.has(r))throw new Error('Unexpected distributable: '+r);const b=await readFile(p);if(r!=='lib/check-public.js'&&privateContent(b.toString()))throw new Error('Private configuration or resource in '+r);count++;}}
 await walk(root);return count;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){if(process.argv[2]==='--archive')console.log('PUBLIC_ARCHIVE_OK',await checkArchive(process.argv[3]));else console.log('PUBLIC_UI_PACKAGE_OK',await checkPublic());}
