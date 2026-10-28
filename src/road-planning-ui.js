import { el } from './util.js';
import { PARCEL_ZONES } from './road-planning.js';

export function roadPlanningControls(app) {
  const plan=app.roadPlanning;
  const root=el('div',{class:'road-planning-controls'});
  const row=(label,control)=>el('div',{class:'row'},[el('label',{class:'lab',text:label}),el('div',{class:'ctl'},[control])]);
  const grid=el('button',{class:'fbtn alt',type:'button',id:'road-grid-toggle',onclick:()=>{
    app.state.grid=!app.state.grid;app.stage.setGridVisible(app.state.grid);app.markDirty?.();
  }});
  const snap=el('button',{class:'fbtn alt',type:'button',id:'road-snap-toggle',onclick:()=>plan.setSnap(!app.state.roadSnap)});
  const size=el('select',{class:'nsl',id:'road-grid-size',onchange:e=>plan.setGridSize(e.target.value)});
  for(const v of [1,2,5,10,20])size.appendChild(el('option',{value:v,text:`${v} m`}));
  root.append(row('地面网格',grid),row('笔刷捕捉',snap),row('网格间距',size),
    el('div',{class:'fnote',text:'显示与捕捉独立开关，默认关闭。开启捕捉后落点、拖动及预览对齐网格；按住 Shift 落点可锁定 X/Z 轴画直角（尖角需关闭平滑倒角）。'}));
  const detect=el('button',{class:'fbtn',type:'button',id:'road-parcels-detect',text:'识别封闭区域',onclick:()=>{
    try{plan.detect();}catch(e){app.notify(e.message,'warn');}
  }});
  const pick=el('button',{class:'fbtn alt',type:'button',id:'road-parcels-pick',onclick:()=>plan.setPicking(!plan.picking)});
  const status=el('div',{class:'fnote',id:'road-parcels-status',role:'status','aria-live':'polite'});
  const regions=el('select',{class:'nsl',id:'road-parcel-select',onchange:e=>plan.select(e.target.value)});
  const zone=el('select',{class:'nsl',id:'road-parcel-zone'});
  for(const [id,z]of Object.entries(PARCEL_ZONES))zone.appendChild(el('option',{value:id,text:z.label}));
  const spacing=el('select',{class:'nsl',id:'road-parcel-spacing'});
  for(const [v,l]of [[14,'密集 · 14m'],[20,'适中 · 20m'],[30,'疏朗 · 30m']])spacing.appendChild(el('option',{value:v,text:l,selected:v===20}));
  const fill=el('button',{class:'fbtn',id:'road-parcel-fill',type:'button',text:'填充选中区域',onclick:()=>{
    try{const n=plan.fillSelected(zone.value,spacing.value);app.notify(`已填充 ${n} 个对象，可一步撤销。`);}catch(e){app.notify(e.message,'warn');}
  }});
  const remove=el('button',{class:'fbtn alt',id:'road-parcel-clear',type:'button',text:'清除本区填充',onclick:()=>{
    const n=plan.clearSelected();app.notify(n?`已清除 ${n} 个生成对象。`:'本区没有可清除的生成对象（锁定对象保留）。');
  }});
  root.append(el('div',{class:'btnrow'},[detect,pick]),status,row('封闭区域',regions),row('区域功能',zone),row('建筑间距',spacing),
    el('div',{class:'btnrow'},[fill,remove]),el('div',{class:'fnote',text:'点击高亮地块或从列表选择，Esc 退出选区。只填充真正闭合的地块，退让道路 2m；整栋建筑须在区域内且不与现有物体重叠。再次填充仅替换本区自动生成内容，保留手动物体和锁定对象。单次最多 40 个。道路修改后请重新识别。'}));
  let lastSelection;
  const render=()=>{
    grid.textContent=`显示网格：${app.state.grid?'开':'关'}`;grid.classList.toggle('on',!!app.state.grid);grid.setAttribute('aria-pressed',String(!!app.state.grid));
    snap.textContent=`捕捉网格：${app.state.roadSnap?'开':'关'}`;snap.classList.toggle('on',!!app.state.roadSnap);snap.setAttribute('aria-pressed',String(!!app.state.roadSnap));
    size.value=String(plan.gridSize());status.textContent=plan.status;
    regions.replaceChildren(el('option',{value:'',text:'请选择区域'}));
    plan.parcels.forEach((p,i)=>regions.appendChild(el('option',{value:p.id,text:`区域 ${i+1} · ${Math.round(p.area)} m²${app.state.parcelZones?.[p.id]?' · '+PARCEL_ZONES[app.state.parcelZones[p.id]]?.label:''}`})));
    regions.value=plan.selectedId||'';
    if(lastSelection!==plan.selectedId){zone.value=app.state.parcelZones?.[plan.selectedId]||'residential';lastSelection=plan.selectedId;}
    pick.textContent=`视口选区：${plan.picking?'开':'关'}`;pick.classList.toggle('on',plan.picking);pick.disabled=!plan.parcels.length;
    fill.disabled=remove.disabled=!plan.selected;
  };
  render();
  const off=app.bus.on('road-planning',()=>{
    if(!root.isConnected){off();return;}
    render();
  });
  return root;
}
