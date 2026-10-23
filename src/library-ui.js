import { LIB } from './assets.js';
import { el, clear } from './util.js';
import { LibraryThumbnails } from './library-thumbnails.js';

const fallback = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m24 7 16 9v17l-16 9-16-9V16zM8 16l16 9 16-9M24 25v17M16 12l16 9"/></svg>';

function dialog(app, title) {
  const previous = document.activeElement;
  const body=el('div',{class:'library-dialog-body'}),foot=el('footer'),status=el('p',{class:'library-status',role:'status','aria-live':'polite'});
  const panel=el('section',{class:'library-dialog',role:'dialog','aria-modal':'true','aria-label':title},[
    el('header',{},[el('b',{text:title})]),body,status,foot,
  ]);
  const mask=el('div',{class:'library-mask'},[panel]);
  let working=false;
  const close=()=>{if(working)return;mask.remove();if(previous?.isConnected)previous.focus();else app.stage.canvas.focus();};
  const cancel=el('button',{class:'fbtn',type:'button',text:'取消',onclick:close});foot.append(cancel);
  mask.addEventListener('pointerdown',e=>{if(e.target===mask)close();});
  mask.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const nodes=[...panel.querySelectorAll('button,input,select')].filter(n=>!n.disabled&&n.getClientRects().length),i=nodes.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus();}
      else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus();}
    }
  });
  document.body.append(mask);cancel.focus();
  return {body,foot,status,close,busy(on){working=on;cancel.disabled=on;body.querySelectorAll('input,select,button').forEach(n=>n.disabled=on);}};
}

export function buildModelLibrary(app, host, {categories=[]}={}) {
  const library=app.modelLibrary;
  const thumbs=new LibraryThumbnails(app);
  const state={cat:'all',q:''};
  const grid=el('div',{class:'grid library-grid'}),chips=el('select',{class:'library-group-filter','aria-label':'模型分组',onchange:e=>{state.cat=e.target.value;render();grid.scrollTop=0;}}),count=el('div',{class:'libcount'});
  const search=el('input',{class:'search',type:'search',placeholder:'搜索模型或分组…','aria-label':'搜索模型库',oninput:e=>{state.q=e.target.value;render();}});
  const importBtn=el('button',{class:'fbtn',type:'button',text:'导入至分组',dataset:{libraryImport:'1'},onclick:openImport});
  const groupBtn=el('button',{class:'fbtn',type:'button',text:'新建分组',dataset:{libraryNewGroup:'1'},onclick:()=>openGroup()});
  const restoreBtn=el('button',{class:'fbtn',type:'button',dataset:{libraryRestore:'1'},onclick:async()=>{
    try{await library.restoreBuiltins();app.notify('已恢复从库中移除的内置模型');}catch(e){app.notify(e.message,'err');}
  }});
  const storageNote=el('div',{class:'library-storage-note'});
  host.append(el('div',{class:'libbar'},[search,el('div',{class:'library-toolbar'},[importBtn,groupBtn,restoreBtn]),storageNote,chips,count]),grid);
  function filters(){
    const result=categories.map(c=>({...c})),covered=new Set(result.flatMap(c=>c.libIds));
    for(const g of library.groups())if(!covered.has(g.id))result.push({id:g.id,label:g.cat,libIds:[g.id]});
    return result;
  }
  function rows(){
    const result=[];
    for(const g of LIB)for(const it of g.items){
      const key=`${g.id}:${it.type}:${it.name}`;
      if(library.visible(key))result.push({key,name:it.name,groupId:g.id,description:it.description,source:it});
    }
    // Keep all original definitions and keys intact, including hidden entries.
    return [...library.meta.models,...result];
  }
  function selectedGroup(){
    return library.groups().find(g=>g.id===state.cat)?.id||'my_models';
  }
  function showGroup(id){state.cat=filters().find(c=>c.libIds.includes(id))?.id||id;state.q='';search.value='';render();}
  function openGroup(after){
    const d=dialog(app,'新建模型分组');
    const input=el('input',{class:'search',type:'text',maxlength:80,placeholder:'例如：我的古建 / 项目道具','aria-label':'分组名称'});
    d.body.append(el('label',{},['分组名称',input]));
    const create=el('button',{class:'fbtn pri',type:'button',text:'创建分组',onclick:async()=>{
      create.disabled=true;d.busy(true);
      try{const id=await library.createGroup(input.value);d.busy(false);d.close();showGroup(id);after?.(id);}
      catch(e){d.status.textContent=e.message;d.busy(false);create.disabled=false;}
    }});d.foot.append(create);input.focus();
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();create.click();}});
  }
  function openImport(){
    const d=dialog(app,'导入用户模型至分组');
    const group=el('select',{'aria-label':'导入目标分组',class:'library-import-group'});
    for(const g of library.groups())group.append(el('option',{value:g.id,text:g.cat}));group.value=selectedGroup();
    let files=[];
    const selection=el('div',{class:'library-file-list',text:'尚未选择文件'});
    const onFiles=e=>{files=Array.from(e.target.files);selection.textContent=files.map(f=>f.webkitRelativePath||f.name).join('、')||'尚未选择文件';submit.disabled=!files.length;d.status.textContent='';};
    const input=el('input',{type:'file',multiple:true,hidden:true,class:'library-file-input',accept:'.glb,.gltf,.fbx,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.gif,.bmp',onchange:onFiles});
    const folder=el('input',{type:'file',multiple:true,webkitdirectory:true,hidden:true,class:'library-folder-input',onchange:onFiles});
    d.body.append(el('label',{},['目标分组',group]),
      el('div',{class:'library-file-buttons'},[
        el('button',{class:'fbtn',type:'button',text:'选择模型文件',onclick:()=>input.click()}),
        el('button',{class:'fbtn',type:'button',text:'选择文件夹（含贴图）',onclick:()=>folder.click()}),
      ]),input,folder,selection,
      el('p',{text:'支持 GLB / GLTF / FBX / OBJ。外部贴图、BIN、MTL 请一并选择，或选择整个文件夹。保持原始材质；只入库，不直接放入场景。'}),
      el('p',{class:'library-storage-note',text:'保存在当前应用的本地存储中，不上传文件。已放入场景的用户模型可随 .previz 工程包携带；模型库分组不随工程包同步。'}));
    const submit=el('button',{class:'fbtn pri',type:'button',text:'导入到分组',disabled:true,dataset:{libraryImportConfirm:'1'},onclick:async()=>{
      submit.disabled=true;group.disabled=true;d.busy(true);
      try{
        const result=await library.import(files,group.value,message=>d.status.textContent=message);
        d.busy(false);d.close();showGroup(group.value);
        app.notify(`已入库 ${result.count} 个模型${result.errors.length?'，失败 '+result.errors.length+' 个（请检查提示后重试）':''}`,result.errors.length?'warn':'info');
      }catch(e){d.status.textContent='导入失败：'+e.message;d.busy(false);submit.disabled=false;group.disabled=false;}
    }});d.foot.append(submit);group.focus();
  }
  function remove(item){
    const d=dialog(app,item.assetId?'删除用户模型':'从库中移除内置模型');
    d.body.append(el('p',{text:`「${item.name}」`}),el('p',{text:item.assetId?'删除本地模型库条目及不再被其他条目使用的库资源。已放置的场景物体、撤销记录和已保存的工程包不会删除。':'只从当前本地模型库隐藏，不删除源资产、不影响场景和工程，可点击「恢复内置」找回。'}));
    const confirm=el('button',{class:'fbtn library-danger',type:'button',text:item.assetId?'确认删除':'确认移除',dataset:{libraryDeleteConfirm:'1'},onclick:async()=>{
      confirm.disabled=true;d.busy(true);
      try{await library.remove(item.key);d.busy(false);d.close();app.notify('已从模型库移除 '+item.name);}
      catch(e){d.status.textContent=e.message;d.busy(false);confirm.disabled=false;}
    }});d.foot.append(confirm);
  }
  function card(item){
    const place=()=>{
      if(item.assetId)app.addAsset(item.key,app.stage.orbit.target.clone());
      else {app.addAsset(item.key,app.stage.orbit.target.clone());app.notify('已放置 '+item.name);}
    };
    const thumbnail=el('div',{class:'ico library-thumbnail',html:fallback,dataset:{thumbnail:'pending'}});
    thumbs.watch(thumbnail,item);
    const placeButton=el('button',{class:'library-place',type:'button',title:`${item.name}｜点击放置，或拖入视口${item.description?'｜'+item.description:''}`,'aria-label':'放置 '+item.name,onclick:e=>{e.stopPropagation();place();}},[
      thumbnail,el('span',{class:'nm',text:item.name}),item.assetId?el('span',{class:'library-kind',text:`用户 · ${item.format}`}):null,
    ]);
    const controls=el('div',{class:'library-card-actions',dataset:{libraryControl:'1'}});
    controls.append(el('button',{class:'library-remove',type:'button',text:item.assetId?'删除':'移除',title:item.assetId?'从分组删除用户模型':'从库中移除（可恢复）','aria-label':(item.assetId?'删除 ':'移除 ')+item.name,onclick:e=>{e.stopPropagation();remove(item);}}));
    if(item.assetId){
      const move=el('select',{class:'library-move','aria-label':'移动 '+item.name+' 至分组',onchange:async e=>{
        e.stopPropagation();const id=e.target.value;e.target.disabled=true;
        try{await library.move(item.key,id);app.notify('已移动到 '+library.groups().find(g=>g.id===id)?.cat);}
        catch(error){app.notify(error.message,'err');render();}
      }});
      for(const g of library.groups())move.append(el('option',{value:g.id,text:g.cat}));move.value=item.groupId;controls.prepend(move);
    }
    return el('article',{class:'card library-card',draggable:true,'data-asset-key':item.key,onclick:e=>{if(e.target===e.currentTarget)place();},ondragstart:e=>{
      if(e.target.closest('[data-library-control]')){e.preventDefault();return;}
      e.dataTransfer.setData('text/asset',item.key);e.dataTransfer.effectAllowed='copy';
    }},[placeButton,controls]);
  }
  function render(){
    thumbs.reset();clear(grid);clear(chips);
    const all=rows(),q=state.q.trim().toLowerCase(),cats=filters();
    const mk=(id,text)=>el('option',{value:id,text});
    chips.append(mk('all',`全部 ${all.length}`));
    for(const c of cats)chips.append(mk(c.id,`${c.label} ${all.filter(it=>c.libIds.includes(it.groupId)).length}`));
    chips.value=state.cat;
    const allowed=state.cat==='all'?null:cats.find(c=>c.id===state.cat)?.libIds||[state.cat];
    let shown=0;
    for(const g of library.groups()){
      if(allowed&&!allowed.includes(g.id))continue;
      const list=all.filter(it=>it.groupId===g.id&&(!q||`${it.name} ${it.key} ${g.cat}`.toLowerCase().includes(q)));
      if(!list.length)continue;
      grid.append(el('div',{class:'libhead'},[el('b',{text:g.cat}),el('i',{text:String(list.length)})]));
      for(const item of list)grid.append(card(item));shown+=list.length;
    }
    if(!shown)grid.append(el('div',{class:'empty',text:q?'没有匹配的模型':'分组为空，点击「导入至分组」添加模型'}));
    count.textContent=`${shown} / ${all.length} 个模型`;
    restoreBtn.hidden=!library.meta.hidden.length;restoreBtn.textContent=`恢复内置 (${library.meta.hidden.length})`;
    importBtn.disabled=groupBtn.disabled=restoreBtn.disabled=library.busy||!!library.error;
    storageNote.textContent=library.error?'本地模型库存储不可用：'+library.error.message:library.busy?'正在处理模型库…':'';
  }
  app.bus.on('library-changed',render);
  const view={state,render,showAll(){state.cat='all';state.q='';search.value='';render();}};
  app.lib=view;render();return view;
}
