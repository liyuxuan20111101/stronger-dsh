// Injected before the application bundle. No fake progress or minimum wait.
export const BOOT_CSS=`
#dsh-ui-loading{--boot-bg:#f6f6f7;--boot-ink:#29292e;--boot-muted:#686773;--boot-line:#e0dfe5;--boot-dot:#e7e6eb;position:fixed;inset:0;z-index:2147483000;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:20px;padding:clamp(24px,5vw,60px);box-sizing:border-box;background:var(--boot-bg);color:var(--boot-ink);font-family:ui-monospace,Consolas,"Microsoft YaHei UI",monospace;transition:opacity .2s ease-out;overflow:auto;isolation:isolate}
#dsh-ui-loading:before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:radial-gradient(var(--boot-dot) .6px,transparent .8px);background-size:24px 24px}
#dsh-ui-loading[data-exit]{opacity:0;pointer-events:none}
#dsh-ui-loading header,#dsh-ui-loading footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px 24px;font:11px/1.7 ui-monospace,monospace;letter-spacing:.08em;color:var(--boot-muted)}
#dsh-ui-loading header b{display:block;color:var(--boot-ink);font:500 13px/1.45 ui-monospace,monospace;letter-spacing:.14em}
#dsh-ui-loading main{display:grid;place-content:center;text-align:center;gap:14px;padding:20px 0;min-width:0}
#dsh-ui-loading svg{width:clamp(112px,21vh,152px);height:clamp(112px,21vh,152px);margin:0 auto 8px;overflow:visible}
#dsh-ui-loading .orbit{transform-origin:100px 100px;animation:dsh-loading-orbit 7s linear infinite}
#dsh-ui-loading[data-paused] .orbit{animation-play-state:paused}
#dsh-ui-loading h1{font-size:clamp(16px,2.4vw,19px);line-height:1.7;font-weight:400;letter-spacing:.12em;margin:0}
#dsh-ui-loading p{font:11px/1.8 ui-monospace,monospace;letter-spacing:.14em;color:var(--boot-muted);margin:0}
#dsh-ui-loading button{border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;letter-spacing:0;cursor:pointer;padding:8px 0;min-height:36px;transition:color .15s ease}
#dsh-ui-loading button:hover{color:var(--boot-ink)}
#dsh-ui-loading button:focus-visible{outline:1px solid #a898bd;outline-offset:5px}
#dsh-ui-loading:after{content:'';position:absolute;inset:16px;border:1px solid var(--boot-line);pointer-events:none;clip-path:polygon(0 0,28px 0,28px 1px,1px 1px,1px 28px,0 28px,0 0,100% 100%,calc(100% - 28px) 100%,calc(100% - 28px) calc(100% - 1px),calc(100% - 1px) calc(100% - 1px),calc(100% - 1px) calc(100% - 28px),100% calc(100% - 28px),100% 100%)}
@keyframes dsh-loading-orbit{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){#dsh-ui-loading{--boot-bg:#19191c;--boot-ink:#dedde4;--boot-muted:#a3a0ae;--boot-line:#34333b;--boot-dot:#25252b}}
@media(max-width:480px){#dsh-ui-loading header>span{display:none}#dsh-ui-loading footer{align-items:flex-start;flex-direction:column;gap:4px}#dsh-ui-loading p{letter-spacing:.1em}}
@media(max-height:420px){#dsh-ui-loading{gap:8px;padding:20px 28px}#dsh-ui-loading main{padding:0;gap:6px}#dsh-ui-loading svg{width:72px;height:72px;margin:0 auto}}
@media(prefers-reduced-motion:reduce){#dsh-ui-loading,#dsh-ui-loading button{transition:none}#dsh-ui-loading .orbit{animation:none}}
`;
export const BOOT_HTML=`<section id="dsh-ui-loading" role="status" aria-label="应用正在加载"><header><div><b>DEEPSEEK</b><b>HARNESS</b></div><span>INITIALIZING / LOCAL</span></header><main><svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><circle cx="100" cy="100" r="78" stroke="currentColor" opacity=".1"/><g class="orbit"><path d="M100 22a78 78 0 0 1 78 78" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".6"/><path d="m178 96 4 4-4 4-4-4z" fill="#b3a6c5"/></g><g transform="translate(54 54) scale(1.44)"><path d="M32 5 12 28 25 58 32 38 47 23Z" fill="currentColor"/><path d="M35 10 52 30 36 57 33 40 44 25Z" fill="#b7a8ca"/><path d="M32 5 29 29 12 28Z" fill="currentColor" opacity=".42"/><path d="M29 29 32 38 25 58" stroke="var(--boot-bg)" stroke-width="2"/></g></svg><h1>正在加载工作区</h1><p>LOADING / WORKSPACE</p></main><footer><span>DSH CORE / INTERFACE</span><button type="button" id="dsh-ui-loading-dismiss">[ 隐藏加载画面 · ESC ]</button></footer></section>`;
export const BOOT_SCRIPT=`(()=>{
 const node=document.getElementById('dsh-ui-loading');if(!node)return;
 const button=document.getElementById('dsh-ui-loading-dismiss');let done=false,timer;
 const visibility=()=>node.toggleAttribute('data-paused',document.hidden);
 const finish=()=>{
  if(done)return;done=true;clearTimeout(timer);
  window.removeEventListener('keydown',key);window.removeEventListener('dsh-ui-ready',finish);
  document.removeEventListener('visibilitychange',visibility);if(button)button.onclick=null;
  node.setAttribute('data-exit','');
  if(document.hidden||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)node.remove();
  else setTimeout(()=>node.remove(),220);
 };
 const key=e=>{if(e.key==='Escape')finish();};
 window.addEventListener('keydown',key);window.addEventListener('dsh-ui-ready',finish,{once:true});
 document.addEventListener('visibilitychange',visibility);visibility();if(button)button.onclick=finish;
 // A broken/disabled client must never trap the user behind a loading layer.
 timer=setTimeout(finish,20000);
})()`;
export function wireBoot(ctx,enabled){ctx.on('webserver/index-inject',rows=>{if(!enabled())return;rows.push({kind:'style',text:BOOT_CSS},{kind:'html',placement:'body',html:BOOT_HTML},{kind:'script',placement:'body',text:BOOT_SCRIPT});},{global:true});}
