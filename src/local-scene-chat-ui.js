import {el} from './util.js';
import {LocalSceneConversation,nativeLocalModel} from './local-scene-chat.js';

export function openLocalSceneChat(app){
 if(document.querySelector('.local-chat-overlay'))return ()=>{};
 const session=app.localScene ||= new LocalSceneConversation(app);
 const runtime=session.runtime||nativeLocalModel,previous=document.activeElement,appRoot=document.getElementById('app'),inert=appRoot?.inert;
 if(appRoot)appRoot.inert=true;
 let closed=false,models=[],inFlight=null;
 const log=el('div',{class:'local-chat-log',role:'log','aria-live':'polite'}),status=el('p',{class:'local-chat-status',role:'status',text:'正在检查模型文件夹…'});
 const select=el('select',{'aria-label':'本地模型',dataset:{localModelSelect:'1'}}),cpu=el('input',{type:'checkbox',dataset:{localModelCpu:'1'}});
 const folder=el('code',{class:'local-model-path'});
 const prompt=el('textarea',{class:'local-chat-input',rows:2,maxlength:2000,placeholder:'描述场景，或继续说“把刚才的房子向右移5米”…','aria-label':'场景对话',dataset:{localChatInput:'1'}});
 const send=el('button',{class:'fbtn pri',type:'button',text:'发送',dataset:{localChatSend:'1'},disabled:true});
 const stop=el('button',{class:'fbtn',type:'button',text:'停止',hidden:true,dataset:{localChatStop:'1'},onclick:async()=>{try{await session.cancel();status.textContent='已停止本次生成。';}catch(e){status.textContent=e.message;}}});
 const close=async()=>{if(session.busy){try{await session.cancel();await inFlight?.catch(()=>{});}catch(e){status.textContent=e.message;return;}}closed=true;observer.disconnect();window.removeEventListener("resize",layout);mask.remove();if(appRoot)appRoot.inert=inert;previous?.isConnected&&previous.focus();};
 const render=()=>{log.replaceChildren();if(!session.messages.length)log.append(el('p',{class:'local-chat-welcome',text:'模型在本机理解你的要求，直接搭建或修改场景。支持地形生成/局部调整、河道/水面、道路和现有素材增改；不生成新的3D素材。每次修改都可撤销。'}));for(const m of session.messages)log.append(el('div',{class:'local-chat-message '+m.role},[el('small',{text:m.role==='user'?'你':'场景助手'}),el('p',{text:m.text})]));log.scrollTop=log.scrollHeight;};
 async function refresh(){
  if(session.busy)return;
  try{const info=await runtime.status();if(closed)return;models=info.models;folder.textContent=info.folder;select.replaceChildren(...models.map(m=>el('option',{value:m.name,text:m.name})));let saved;try{saved=localStorage.getItem('previz.localModel.selected');}catch{}if(models.some(m=>m.name===saved))select.value=saved;
   status.textContent=!info.enginePresent?'缺少推理引擎，请安装完整版本。':!models.length?'尚未找到 GGUF 模型。点击“打开模型文件夹”，放入模型后刷新。':`已找到 ${models.length} 个模型，发送时自动加载。首次加载可能需要几分钟。`;
   send.disabled=!models.length||!info.enginePresent||session.busy;
  }catch(e){status.textContent=String(e.message||e).replace(/蓝图/g,'模型结果').replace(/候选/g,'修改').replace(/工作包/g,'场景资料');send.disabled=true;}
 }
 send.onclick=async()=>{
  if(session.busy||!prompt.value.trim())return;
  const text=prompt.value;prompt.value='';send.disabled=true;stop.hidden=false;select.disabled=cpu.disabled=true;
  try{try{localStorage.setItem('previz.localModel.selected',select.value);}catch{}
   const pending=inFlight=session.send(text,{model:select.value,cpuOnly:cpu.checked,confirm:message=>Promise.resolve(window.confirm(message)),progress:message=>{status.textContent=message;stop.disabled=session.committing===true;render();}});render();
   const result=await pending;status.textContent=result.changed?'场景已更新，可继续对话修改或撤销。':result.text;
  }catch(e){status.textContent=String(e.message||e).replace(/蓝图/g,'模型结果').replace(/候选/g,'修改').replace(/工作包/g,'场景资料');}
  finally{if(!closed){render();send.disabled=!models.length;stop.hidden=true;stop.disabled=false;select.disabled=cpu.disabled=false;prompt.focus();}}
 };
 prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send.click();}});
 const settings=el('details',{class:'local-chat-settings'},[el('summary',{text:'本地模型设置'}),folder,el('p',{text:'推荐 RTX 4070 Ti 12GB：Qwen2.5-7B-Instruct Q4_K_M GGUF。只下载模型文件，无需另开服务或填写端口。分片模型需所有分片完整放在一起。'}),el('label',{},[cpu,'使用 CPU（显存不足或驱动问题时）'])]);
 const panel=el('section',{class:'local-chat-panel',role:'dialog','aria-modal':'true','aria-label':'一句话生成与对话修改'},[
  el('header',{},[el('b',{text:'一句话生成 · 本地 AI'}),el('button',{class:'fbtn',type:'button',text:'关闭',onclick:close})]),
  el('div',{class:'local-chat-models'},[select,el('button',{class:'fbtn',type:'button',text:'打开模型文件夹',dataset:{localModelFolder:'1'},onclick:async()=>{try{await runtime.openFolder();}catch(e){status.textContent=String(e.message||e).replace(/蓝图/g,'模型结果').replace(/候选/g,'修改').replace(/工作包/g,'场景资料');}}}),el('button',{class:'fbtn',type:'button',text:'刷新',dataset:{localModelRefresh:'1'},onclick:refresh})]),settings,log,status,prompt,
  el('footer',{},[el('button',{class:'fbtn',type:'button',text:'撤销上次修改',dataset:{localChatUndo:'1'},onclick:()=>{if(session.busy)return;app.undo();session.recentIds=session.recentIds.filter(id=>app.objects.some(o=>o.id===id));session.messages.push({role:'assistant',text:'已撤销上一步。'});render();}}),stop,send]),
 ]);
 const layout=()=>{const r=app.stage.canvas.getBoundingClientRect(),w=Math.max(280,Math.min(620,r.width-24)),h=Math.max(300,r.height-24);panel.style.position='fixed';panel.style.width=w+'px';panel.style.maxHeight=Math.min(innerHeight-32,h)+'px';panel.style.left=Math.max(w/2+16,Math.min(innerWidth-w/2-16,r.left+r.width/2))+'px';panel.style.top=Math.min(innerHeight/2,Math.max(h/2+16,r.top+r.height/2))+'px';panel.style.transform='translate(-50%,-50%)';};
 const observer=new ResizeObserver(layout);observer.observe(app.stage.canvas);window.addEventListener('resize',layout);
 const mask=el('div',{class:'local-chat-overlay'},[panel]);document.body.append(mask);layout();
 mask.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...panel.querySelectorAll('button,input,select,textarea,summary')].filter(n=>!n.disabled&&n.getClientRects().length),i=nodes.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus();}}});
 render();refresh();prompt.focus();return close;
}
