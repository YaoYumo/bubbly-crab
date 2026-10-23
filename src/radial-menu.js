import {el} from './util.js';

export function radialPlacement(rect,x,y) {
  const size=Math.max(1,Math.min(320,rect.width-16,rect.height-16));
  return {size,left:Math.max(rect.left+8,Math.min(x-size/2,rect.left+rect.width-size-8)),top:Math.max(rect.top+8,Math.min(y-size/2,rect.top+rect.height-size-8))};
}
const paths={move:'M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3',rotate:'M16 7a7 7 0 1 0 1 6M16 2v5h-5',scale:'M3 8V3h5M12 17h5v-5M3 3l5 5M17 17l-5-5',focus:'M7 2H2v5M13 2h5v5M18 13v5h-5M7 18H2v-5M7 10h6M10 7v6',copy:'M7 7h10v11H7zM3 13V2h10',delete:'M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7M12 8v7',undo:'M7 4L2 9l5 5M2 9h9a6 6 0 0 1 6 6',redo:'M13 4l5 5-5 5M18 9h-9a6 6 0 0 0-6 6',more:'M4 10h.1M10 10h.1M16 10h.1',add:'M10 3v14M3 10h14',camera:'M2 6h11v10H2zM13 9l5-3v10l-5-3',generate:'M10 1l2.5 6.5L19 10l-6.5 2.5L10 19l-2.5-6.5L1 10l6.5-2.5z',grid:'M2 2h16v16H2zM2 8h16M2 13h16M8 2v16M13 2v16',snap:'M3 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3z',preview:'M5 3l12 7-12 7z',key:'M10 2l8 8-8 8-8-8z'};
function icon(id){return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${paths[id]||paths.more}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function sector(index,count){const a=-Math.PI/2+(index-.5)*2*Math.PI/count+.004,b=a+2*Math.PI/count-.008,pts=[];for(let i=0;i<=12;i++){const t=a+(b-a)*i/12;pts.push(`${50+49*Math.cos(t)}% ${50+49*Math.sin(t)}%`);}for(let i=12;i>=0;i--){const t=a+(b-a)*i/12;pts.push(`${50+19*Math.cos(t)}% ${50+19*Math.sin(t)}%`);}return `polygon(${pts.join(',')})`;}

export function installRadialMenu(app,{actions}) {
  const canvas=app.stage.canvas,menu=el('div',{class:'radial-menu',role:'menu','aria-label':'视口右键操作',hidden:true});document.body.append(menu);
  // Windows/WebView2 can emit contextmenu after pointerup has opened/focused
  // the pie, retargeting it to the overlay instead of the canvas. Catch both
  // surfaces in capture phase; leave text fields and other UI menus untouched.
  document.addEventListener('contextmenu',e=>{
    const path=e.composedPath();
    if(path.includes(canvas)||path.includes(menu))e.preventDefault();
  },true);
  let down=null,previous=null,context=null,buttons=[];
  const blocked=()=>app.state.playing||app.stage.dragging||app.stage.exporting||app.stage.exportOwner||app.exporter?.running||app.reference?.busy||app.aiScene?.busy||app.behaviors?.busy||app.roadBrush?.active||app.vegetationBrush?.active||app.state.terrainTool||app.state.dofPickMode||app.sceneRecipeBusy||app.terrain?.workflow?.busy||app.terrain?.workflow?.erosionPreview||app.terrain?.workflow?.drawing||app.roadPlanning?.picking;
  function close(restore=true){if(menu.hidden)return;menu.hidden=true;menu.replaceChildren();if(restore&&previous?.isConnected)previous.focus({preventScroll:true});}
  function open(x,y,{pick=true,selection=false}={}){
    close(false);if(blocked())return;
    const r=canvas.getBoundingClientRect();if(r.width<32||r.height<32)return;
    app.stage.pointer.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);
    const hit=selection&&app.sel?app.sel:pick?app.stage.pick():null;
    context=hit?.kind==='obj'?{kind:'obj',so:hit.so}:hit?.kind==='shot'?{kind:'shot',shot:hit.shot}:{kind:'empty'};
    if(context.kind==='obj')app.select({kind:'obj',so:context.so});
    if(context.kind==='shot'){app.setActiveShot(context.shot);app.select({kind:'shot',shot:context.shot});}
    previous=document.activeElement;
    const {size,left,top}=radialPlacement(r,x,y),compact=size<240;
    menu.classList.toggle('compact',compact);menu.style.cssText=`left:${left}px;top:${top}px;width:${size}px;height:${size}px;--pie-size:${size}px`;
    const items=actions(context);buttons=items.map((action,i)=>{
      const angle=-Math.PI/2+i*2*Math.PI/items.length;
      const b=el('button',{class:'radial-item'+(action.danger?' danger':''),type:'button',role:'menuitem',disabled:!!action.disabled,'data-radial-action':action.id,'aria-label':action.label,title:action.hint||action.label,onclick:()=>{
        if(blocked())return close();
        if(context.kind==='obj'&&!app.objects.includes(context.so))return close();
        if(context.kind==='shot'&&!app.shots.includes(context.shot))return close();
        close();action.run();
      }},[el('span',{class:'radial-label',style:`left:${50+34*Math.cos(angle)}%;top:${50+34*Math.sin(angle)}%`},[el('span',{html:icon(action.icon||action.id)}),el('span',{text:action.label})])]);
      if(!compact)b.style.clipPath=sector(i,items.length);return b;
    });
    menu.append(...buttons,el('button',{class:'radial-center',type:'button','aria-label':'关闭右键菜单',onclick:()=>close()},[el('span',{text:context.so?.name||context.shot?.name||'视口操作'}),el('small',{text:'Esc 取消'})]));
    menu.hidden=false;buttons.find(b=>!b.disabled)?.focus({preventScroll:true});
  }
  canvas.addEventListener('pointerdown',e=>{if(e.button===2)down={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now(),moved:0};},true);
  window.addEventListener('pointermove',e=>{if(down&&e.pointerId===down.id)down.moved=Math.max(down.moved,Math.hypot(e.clientX-down.x,e.clientY-down.y));},true);
  window.addEventListener('pointerup',e=>{if(!down||e.pointerId!==down.id||e.button!==2)return;const d=down;down=null;const r=canvas.getBoundingClientRect();if(d.moved<=5&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<=5&&performance.now()-d.t<900&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)open(e.clientX,e.clientY);});
  window.addEventListener('pointercancel',()=>{down=null;});window.addEventListener('blur',()=>{down=null;close(false);});
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)){close(false);if(e.button===0&&e.target===canvas){e.preventDefault();e.stopPropagation();}}},true);
  window.addEventListener('keydown',e=>{
    if(menu.hidden){if((e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))&&e.target===canvas){e.preventDefault();e.stopImmediatePropagation();const r=canvas.getBoundingClientRect();open(r.left+r.width/2,r.top+r.height/2,{selection:true});}return;}
    e.stopImmediatePropagation();
    if(e.key==='Escape'){e.preventDefault();close();}
    else if(['Tab','ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();const active=buttons.filter(b=>!b.disabled),i=active.indexOf(document.activeElement),back=e.shiftKey||e.key==='ArrowLeft'||e.key==='ArrowUp';
      const next=e.key==='Home'?0:e.key==='End'?active.length-1:(i+(back?-1:1)+active.length)%active.length;active[next]?.focus();
    }else if(e.key==='Enter'||e.key===' '){e.preventDefault();document.activeElement?.click();}
  },true);
  canvas.tabIndex=0;canvas.addEventListener('wheel',()=>close(false),{passive:true});window.addEventListener('resize',()=>close(false));
  for(const event of ['page-change','select','objects'])app.bus.on(event,()=>close(false));
  return {open,close,get isOpen(){return !menu.hidden;}};
}
