// The Host contributes this before the application bundle, including desktop IPC boot.
// No network calls, fake percentages, authentication claims, or timed presentation.
export const BOOT_CSS=`
#dsh-ui-loading{position:fixed;inset:0;z-index:2147483000;display:grid;grid-template-rows:auto 1fr auto;padding:clamp(24px,5vw,64px);box-sizing:border-box;background:#fcfcfc;color:#232326;font-family:system-ui,sans-serif;transition:opacity .24s ease;overflow:hidden}
#dsh-ui-loading[data-exit]{opacity:0;pointer-events:none}
#dsh-ui-loading header,#dsh-ui-loading footer{display:flex;justify-content:space-between;gap:20px;font:10px/1.7 ui-monospace,monospace;letter-spacing:.12em;color:#77747c}
#dsh-ui-loading header b{display:block;color:#232326;font:600 15px/1.1 system-ui;letter-spacing:-.04em}
#dsh-ui-loading main{display:grid;place-content:center;text-align:center;gap:24px;position:relative}
#dsh-ui-loading svg{width:180px;height:180px;margin:auto;overflow:visible}
#dsh-ui-loading .orbit{transform-origin:100px 100px;animation:dsh-loading-orbit 2.8s linear infinite}
#dsh-ui-loading h1{font-size:18px;font-weight:400;letter-spacing:.2em;margin:0}
#dsh-ui-loading p{font:9px ui-monospace,monospace;letter-spacing:.25em;color:#89848f;margin:0}
#dsh-ui-loading button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:6px}
#dsh-ui-loading button:focus-visible{outline:1px solid #b3a6c5}
#dsh-ui-loading:after{content:'';position:absolute;inset:20px;border:1px solid #e9e9ec;pointer-events:none;clip-path:polygon(0 0,36px 0,36px 1px,1px 1px,1px 36px,0 36px,0 0,100% 100%,calc(100% - 36px) 100%,calc(100% - 36px) calc(100% - 1px),calc(100% - 1px) calc(100% - 1px),calc(100% - 1px) calc(100% - 36px),100% calc(100% - 36px),100% 100%)}
@keyframes dsh-loading-orbit{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){#dsh-ui-loading{background:#151516;color:#e5e4e8}#dsh-ui-loading header b{color:#e5e4e8}#dsh-ui-loading:after{border-color:#333238}}
@media(prefers-reduced-motion:reduce){#dsh-ui-loading{transition:none}#dsh-ui-loading .orbit{animation:none}}
`;
export const BOOT_HTML=`<section id="dsh-ui-loading" role="status" aria-label="应用正在加载"><header><div><b>DEEPSEEK</b><b>HARNESS</b></div><span>INITIALIZING / LOCAL</span></header><main><svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><circle cx="100" cy="100" r="78" stroke="currentColor" opacity=".12"/><g class="orbit"><path d="M100 22a78 78 0 0 1 78 78" stroke="currentColor" stroke-width="2"/><path d="m178 95 5 5-5 5-5-5z" fill="#b3a6c5"/></g><path d="m100 72 24 28-24 28-24-28z M100 82v36 M86 100h28" stroke="currentColor" stroke-width="1.2"/></svg><h1>正在加载工作区</h1><p>LOADING WORKSPACE</p></main><footer><span>DSH CORE / INTERFACE</span><button type="button" id="dsh-ui-loading-dismiss">隐藏加载画面 · ESC</button></footer></section>`;
export const BOOT_SCRIPT=`(()=>{
 const node=document.getElementById('dsh-ui-loading');if(!node)return;
 let done=false,timer;const finish=()=>{if(done)return;done=true;clearTimeout(timer);window.removeEventListener('keydown',key);window.removeEventListener('dsh-ui-ready',finish);node.setAttribute('data-exit','');setTimeout(()=>node.remove(),250);};
 const key=e=>{if(e.key==='Escape')finish();};window.addEventListener('keydown',key);window.addEventListener('dsh-ui-ready',finish,{once:true});document.getElementById('dsh-ui-loading-dismiss').onclick=finish;
 // A broken/disabled client must never trap the user behind a loading layer.
 timer=setTimeout(finish,20000);
})()`;
export function wireBoot(ctx,enabled){ctx.on('webserver/index-inject',rows=>{if(!enabled())return;rows.push({kind:'style',text:BOOT_CSS},{kind:'html',placement:'body',html:BOOT_HTML},{kind:'script',placement:'body',text:BOOT_SCRIPT});},{global:true});}
