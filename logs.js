
let rows=[];
async function sw(msg){const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw new Error(r?.error||"failed");return r.value;}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
async function load(){
 rows=await sw({type:"GET_RUNS",limit:1000});
 const providers={}; for(const r of rows){providers[r.provider]=(providers[r.provider]||0)+1;}
 document.querySelector("#stats").innerHTML=`<p><strong>${rows.length}</strong> runs · ${Object.entries(providers).map(([k,v])=>`${k}: ${v}`).join(" · ")}</p>`;
 document.querySelector("#runs").innerHTML=rows.map(r=>`<details class="card"><summary><strong>${esc(r.task)}</strong> · ${esc(r.provider)} · ${esc(r.model)} · ${r.cacheHit?"cache":`${r.durationMs}ms`} · ${esc(r.createdAt)} ${r.error?"· ERROR":""}</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details>`).join("");
}
document.querySelector("#refreshBtn").onclick=load;
document.querySelector("#downloadBtn").onclick=()=>{
 const b=new Blob([JSON.stringify(rows,null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="nano-seo-lab-runs.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
};
document.querySelector("#clearBtn").onclick=async()=>{await sw({type:"CLEAR_LOGS"});await load();};
load();
