// Camera edit track. All authoring goes through CameraEdit (undo + persistence).
import { el, clear, clamp, fmt, timecode } from './util.js';

export function buildTimeline(app, host) {
  const edit = app.cameraEdit;
  let selected = null, gesture = null, showKeys = false, zoom = 1;
  const wrap = el('div', { class: 'tl', 'aria-label': '镜头剪辑时间轴' });
  const attempt = fn => { try { return fn(); } catch (e) { app.notify(e.message || String(e), 'warn'); redraw(); return null; } };
  const button = (text, title, fn, name) => el('button', { class: 'pbtn sm cut-btn', type: 'button', text, title, 'data-cut-action': name, onclick: () => attempt(fn) });
  const playBtn = button('▶', '播放/暂停（空格）', () => toggle());
  const stopBtn = button('⏮', '暂停并回到起点', () => { app.state.playing = false; seekTime(0); });
  const loopBtn = button('↻', '循环播放', () => { app.state.loop = !app.state.loop; redraw(); });
  const spd = el('select', { class: 'nsl', 'aria-label': '播放速度' });
  for (const s of [.25,.5,1,2]) spd.append(el('option', { value:s, text:s+'×' }));
  spd.value = app.state.speed;
  spd.onchange = () => { app.state.speed = +spd.value; };
  const tc = el('span', { class:'tc' });
  const dur = el('input', { class:'nml', type:'number', min:.5, max:120, step:.5, 'aria-label':'工程总时长' });
  dur.onchange = () => { attempt(() => edit.duration(+dur.value)); dur.value = app.state.duration; };
  const fps = el('select', { class:'nsl', 'aria-label':'帧率' });
  for (const f of [24,25,30,50,60]) fps.append(el('option', {value:f,text:f+'fps'}));
  fps.onchange = () => attempt(() => { edit.checkIdle(); app.beginOp('更改帧率'); app.state.fps = +fps.value; app.bus.emit('fps'); redraw(); });
  const curveBtn = button('曲线', '关键帧曲线（V）；机位关键帧仍在机位编辑器中调整', () => { app.curve?.toggle(); curveBtn.classList.toggle('on', !!app.curve?.isOpen); if(app.curve?.isOpen)app.curve.draw(); });
  const keysBtn = button('关键帧', '按需展开独立关键帧行，仅显示所选物体；单机位模式可显示当前机位。不叠在镜头片段上。', () => {
    showKeys = !showKeys; keyRow.hidden = !showKeys; content.classList.toggle('has-keys', showKeys);
    keysBtn.classList.toggle('on', showKeys); keysBtn.setAttribute('aria-pressed', String(showKeys)); drawTicks();
  }, 'keys');
  keysBtn.setAttribute('aria-pressed','false');
  const zoomOut = button('−', '缩小时间轴', () => setZoom(zoom / 2), 'zoom-out');
  const zoomFit = button('适配', '整段剪辑适配窗口', () => setZoom(1), 'zoom-fit');
  const zoomIn = button('+', '放大时间轴，便于操作短镜头；可横向滚动', () => setZoom(zoom * 2), 'zoom-in');
  const zoomLabel = el('span', {class:'cut-zoom-label',text:'100%'});
  wrap.append(el('div',{class:'tl-main'},[
    el('div',{class:'tl-l'},[playBtn,stopBtn,loopBtn,spd,tc]),
    el('div',{class:'tl-r'},[zoomOut,zoomLabel,zoomIn,zoomFit,keysBtn,curveBtn,el('label',{class:'mni',text:'总时长'}),dur,fps]),
  ]));
  const track = el('div', {class:'track', 'data-cut-track':'video', title:'点击空位定位；拖入机位；拖片段移动，拖两端裁剪。空隙保持上一镜头末态。'});
  const ticks = el('div',{class:'tticks'}), clips = el('div',{class:'tclips'}), fill = el('div',{class:'tfill'}), head = el('div',{class:'thead'});
  const empty = el('span',{class:'cut-empty',text:'添加当前机位，或「顺序拼接」全部机位；也可将左侧机位拖入此轨'});
  track.append(fill,clips,empty,head);
  const rulerTicks = el('div',{class:'cut-ruler-ticks'}), rulerHead = el('div',{class:'cut-ruler-head'});
  const ruler = el('div',{class:'cut-ruler', 'data-cut-ruler':'1', title:'拖动标尺定位播放头；即使镜头铺满轨道也可定位切点'},[rulerTicks,rulerHead]);
  const keyHint = el('span',{class:'cut-empty'}), keyHead = el('div',{class:'thead'});
  const keyTrack = el('div',{class:'track cut-key-track'},[ticks,keyHint,keyHead]);
  const keyRow = el('div',{class:'track-row cut-key-row',hidden:true},[el('div',{class:'track-label',text:'关键帧'}),keyTrack]);
  const content = el('div',{class:'cut-content'},[
    el('div',{class:'track-row cut-ruler-row'},[el('div',{class:'track-label',text:'时间'}),ruler]),
    el('div',{class:'track-row cut-video-row'},[el('div',{class:'track-label',text:'镜头'}),track]),keyRow,
  ]);
  const viewport = el('div',{class:'cut-viewport'},[content]);
  wrap.append(viewport);
  const enabled = button('剪辑预览', '开启：预览/视频导出按本轨硬切；关闭：仍用当前单机位。空隙保持前镜头出点，首段前保持首镜头入点。', () => { edit.setEnabled(!edit.enabled); previewEdit(); }, 'enable');
  const append = button('+ 当前机位', '将当前编辑机位追加到轨道末尾，按1×源时间播放；必要时延长总时长', () => { selected = edit.append(app.activeShot?.id); previewEdit(); seekTime(edit.clips.find(c=>c.id===selected).start); drawClips(); }, 'append');
  const assemble = button('顺序拼接', '替换轨道，按机位列表顺序拼接完整机位；同步修改工程总时长（最多120秒），可撤销', () => { if(edit.clips.length && !confirm('替换现有剪辑，并按所有机位时长重新设置工程总时长？可用撤销恢复。'))return; edit.assemble(); selected=edit.clips[0]?.id; previewEdit(); seekTime(0); drawClips(); }, 'assemble');
  const split = button('分割', '在播放头处分割选中片段，左右至少一帧；源时间连续', () => edit.split(selected,app.state.time), 'split');
  const remove = button('删片段', '只删除选中片段，不删除机位；空隙不自动吸合', () => { edit.remove(selected); selected=null; drawClips(); }, 'remove');
  const label = el('span',{class:'cut-selection',text:'未选片段'});
  const field = (name,title) => el('input',{class:'nml cut-field',type:'number',min:0,max:120,step:.001,'aria-label':title,'data-cut-field':name});
  const start = field('start','片段起点（秒）'), end = field('end','片段终点（秒）'), source = field('sourceIn','源机位入点（秒）');
  for (const [node,key] of [[start,'start'],[end,'end'],[source,'sourceIn']]) node.onchange = () => { attempt(() => edit.update(selected,{[key]:+node.value})); syncFields(true); };
  const tools = el('div',{class:'cut-tools'},[enabled,append,assemble,split,remove,label,el('label',{text:'起'}),start,el('label',{text:'止'}),end,el('label',{text:'源入'}),source,el('span',{class:'cut-help',text:'秒 · 1× · 硬切',title:'无转场/音轨；源运动超过机位时长后保持末态。编辑模式每帧独立采样，避免跨镜头历史滤波污染。'})]);
  wrap.append(tools); host.append(wrap);

  function setZoom(value) {
    gesture?.cancel();
    const old = zoom; zoom = clamp(value,1,8);
    // Keep the visible timeline location when zooming; Fit always returns to start.
    const at = viewport.scrollLeft / Math.max(1, content.clientWidth);
    content.style.width = zoom * 100 + '%';
    viewport.scrollLeft = zoom === 1 ? 0 : at * content.clientWidth;
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    zoomOut.disabled = zoom === 1; zoomIn.disabled = zoom === 8;
    if(old !== zoom)drawRuler();
  }
  let rulerKey = '';
  function drawRuler() {
    const width = ruler.clientWidth, duration = app.state.duration;
    const key = `${width}/${duration}/${app.state.fps}`;
    if(key === rulerKey)return; rulerKey = key;
    clear(rulerTicks);
    const want = duration * 80 / Math.max(1,width);
    const step = [1/app.state.fps,.1,.2,.5,1,2,5,10,15,30,60,120].find(s=>s>=want) || 120;
    const times=[];
    for(let i=0;i*step<duration-1e-7 && i<500;i++)times.push(i*step);
    if(!times.length || (duration-times.at(-1))/duration*width>40)times.push(duration);
    for(const t of times)rulerTicks.append(el('span',{class:'cut-ruler-tick'+(t===0?' first':t===duration?' last':''),style:`left:${t/duration*100}%`,text:Number(t.toFixed(3))+'s',title:timecode(t,app.state.fps)}));
  }
  new ResizeObserver(drawRuler).observe(ruler);
  zoomOut.disabled = true;
  function previewEdit() { if(edit.enabled && edit.clips.length && app.activeShot && !app.state.preview) app.setPreview(true); }
  function seekTime(time) {
    app.state.time = clamp(time,0,app.state.duration);
    if(app.state.preview) app.stage.previewControls.interacted = false;
    app.bus.emit('time');
  }
  function toggle() {
    return attempt(() => {
      if (app.stage.exportOwner || app.stage.exporting || app.exporter?.running || app.reference?.busy || app.behaviors?.busy || app.terrain?.workflow?.busy || app.terrain?.workflow?.erosionPreview) throw Error('请先完成导出、后台任务或地形预览');
      app.state.playing = !app.state.playing;
      if (app.state.playing) {
        if(app.state.time>=app.state.duration)app.state.time=0;
        if(app.activeShot && !app.state.preview) {
          app._viewSave ||= { p:app.stage.view.position.toArray(), q:app.stage.view.quaternion.toArray(), f:app.stage.view.fov, t:app.stage.orbit.target.toArray() };
          app.setPreview(true);
        }
        app.stage.previewControls.interacted=false;
      }
      redraw();
    });
  }
  const snap = value => Math.round(value * app.state.fps) / app.state.fps;
  let scrubbing = false;
  const seekX = x => { const r=track.getBoundingClientRect(); seekTime(clamp((x-r.left)/r.width,0,1)*app.state.duration); };
  for(const target of [ruler,track,keyTrack]) {
    target.addEventListener('pointerdown',e=>{
      if(e.button!==0 || e.target.closest('.tclip,.tk'))return;
      if(app.stage.exportOwner || app.stage.exporting)return;
      scrubbing=true; target.setPointerCapture(e.pointerId); seekX(e.clientX);
    });
    target.addEventListener('pointermove',e=>{if(scrubbing)seekX(e.clientX);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])target.addEventListener(type,()=>{scrubbing=false;});
  }
  track.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';track.classList.add('dragover');});
  track.addEventListener('dragleave',()=>track.classList.remove('dragover'));
  track.addEventListener('drop',e=>{
    e.preventDefault();track.classList.remove('dragover');
    attempt(()=>{
      const stable=e.dataTransfer.getData('application/x-previz-shot');
      const legacy=e.dataTransfer.getData('text/shot');
      const shot=app.shots.find(s=>s.id===stable) || (legacy!==''?app.shots[Number(legacy)]:null);
      if(!shot)return;
      const r=track.getBoundingClientRect();
      selected=edit.append(shot.id,snap(clamp((e.clientX-r.left)/r.width,0,1)*app.state.duration));previewEdit();seekTime(edit.clips.find(c=>c.id===selected).start);drawClips();
    });
  });
  function drag(e,c,node) {
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();selected=c.id; syncFields();
    node.focus(); for(const n of clips.children)n.classList.toggle('selected',n.dataset.clipId===selected);
    if(attempt(()=>{edit.checkIdle();return true;})!==true)return;
    const r=track.getBoundingClientRect(), side=e.target.dataset.side, from=e.clientX;
    let patch=null, moved=false;
    gesture={node,cancel:()=>done({type:'cancel'})};
    const move=ev=>{
      if(!moved && Math.abs(ev.clientX-from)<4)return;
      moved=true; node.classList.add('dragging');
      let delta=snap((ev.clientX-from)/r.width*app.state.duration);
      if(side==='l'){
        delta=clamp(delta,Math.max(-c.start,-c.sourceIn),c.end-c.start-1/app.state.fps);
        patch={start:c.start+delta,sourceIn:c.sourceIn+delta};
      }else if(side==='r')patch={end:clamp(c.end+delta,c.start+1/app.state.fps,app.state.duration)};
      else{const s=clamp(c.start+delta,0,app.state.duration-(c.end-c.start));patch={start:s,end:s+c.end-c.start};}
      const draft={...c,...patch}; node.style.left=draft.start/app.state.duration*100+'%';node.style.width=(draft.end-draft.start)/app.state.duration*100+'%';
    };
    const done=ev=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',done);window.removeEventListener('blur',done);
      gesture=null;
      if(ev.type==='pointerup' && patch)attempt(()=>edit.update(c.id,patch));
      else if(ev.type==='pointerup' && !side)seekX(ev.clientX);
      drawClips();
    };
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',done);window.addEventListener('pointercancel',done);window.addEventListener('blur',done);
  }
  // Focused timeline Delete removes the clip, not the camera selected in the inspector.
  wrap.addEventListener('keydown',e=>{
    if(e.target.closest('input,select,textarea') || !selected || !['Delete','Backspace'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();attempt(()=>edit.remove(selected));selected=null;drawClips();
  });
  function syncFields(force = false) {
    const c=edit.clips.find(c=>c.id===selected), shot=app.shots.find(s=>s.id===c?.shotId);
    label.textContent=c ? shot?.name || '片段' : '未选片段';
    for(const [node,key] of [[start,'start'],[end,'end'],[source,'sourceIn']]){node.disabled=!c;if(force || document.activeElement!==node)node.value=c?+c[key].toFixed(4):'';}
    split.disabled=remove.disabled=!c;
  }
  function drawClips() {
    if(gesture)return;
    if(!edit.clips.some(c=>c.id===selected))selected=null;
    const focused = clips.contains(document.activeElement) ? document.activeElement.closest('.tclip')?.dataset.clipId : null;
    clear(clips);
    for(const c of edit.clips){
      const shot=app.shots.find(s=>s.id===c.shotId);
      const n=el('div',{class:'tclip'+(c.id===selected?' selected':''),tabindex:0,role:'button','aria-label':`${shot?.name || '镜头'} ${fmt(c.start,2)}至${fmt(c.end,2)}秒`,'data-clip-id':c.id,title:`${shot?.name} · ${fmt(c.start,3)}–${fmt(c.end,3)}s · 源入 ${fmt(c.sourceIn,3)}s；双击定位入点`,style:`left:${c.start/app.state.duration*100}%;width:${(c.end-c.start)/app.state.duration*100}%;background-color:${shot?.colorHex || '#4A90D9'}`},[
        el('div',{class:'cut-clip-content'},[el('span',{class:'tclip-nm',text:shot?.name || '镜头'}),el('span',{class:'cut-clip-time',text:`${fmt(c.start,2)}–${fmt(c.end,2)}s · ${fmt(c.end-c.start,2)}s`})]),el('div',{class:'tclip-trim tclip-trim-l',dataset:{side:'l'}}),el('div',{class:'tclip-trim tclip-trim-r',dataset:{side:'r'}}),
      ]);
      n.onpointerdown=e=>drag(e,c,n);
      n.onfocus=()=>{selected=c.id;syncFields();for(const x of clips.children)x.classList.toggle('selected',x===n);};
      n.ondblclick=()=>{seekTime(c.start);};
      clips.append(n);
    }
    if(focused) [...clips.children].find(n=>n.dataset.clipId===focused)?.focus();
    syncFields();redraw();drawTicks();
  }
  function redraw() {
    if(document.activeElement!==dur)dur.value=app.state.duration;
    fps.value=app.state.fps;
    const u=app.timeline.u;
    fill.style.width=u*100+'%';
    for(const h of [head,rulerHead,keyHead])h.style.left=u*100+'%';
    drawRuler();
    tc.textContent=`${timecode(app.state.time,app.state.fps)} / ${fmt(app.state.duration,1)}s`;
    playBtn.textContent=app.state.playing?'❚❚':'▶';loopBtn.classList.toggle('on',app.state.loop);
    enabled.classList.toggle('on',edit.enabled); enabled.setAttribute('aria-pressed',String(edit.enabled));
    const current=edit.sample()?.clip.id;
    for(const n of clips.children)n.classList.toggle('is-current',edit.enabled && n.dataset.clipId===current);
    empty.hidden=!!edit.clips.length;
    track.classList.toggle('cut-disabled',!edit.enabled);
  }
  function drawTicks() {
    clear(ticks);
    if(!showKeys)return;
    const so=app.selObj, s=app.activeShot;
    const objectKeys=so?.motion?.active ? so.motion.keys || [] : [];
    if(so) {
      keyHint.textContent = objectKeys.length ? '' : '所选物体没有走位关键帧';
      for(const k of objectKeys)ticks.append(el('i',{class:'tk o',style:`left:${(k.t||0)*100}%`,title:`${so.name} · ${fmt((k.t||0)*app.state.duration,2)}s`,onclick:e=>{e.stopPropagation();seekTime((k.t||0)*app.state.duration);}}));
    } else if(s && !edit.enabled) {
      keyHint.textContent = s.keys.length ? '' : '当前机位没有关键帧';
      for(const [i,k] of s.keys.entries())ticks.append(el('i',{class:'tk'+(i===s.selKey?' on':''),style:`left:${k.t*100}%`,title:`${s.name} · K${i+1}`,onclick:e=>{e.stopPropagation();app.selectKey(s,i);seekTime(k.t*app.state.duration);}}));
    } else keyHint.textContent = '仅显示所选物体的走位关键帧；查看机位关键帧请先关闭剪辑预览';
  }
  app.bus.on('time',()=>{redraw();drawTicks();});
  app.bus.on('tick',redraw);app.bus.on('playstate',redraw);
  for(const event of ['camera-edit','shot-change','shots'])app.bus.on(event,()=>{gesture?.cancel();drawClips();});
  for(const event of ['select','objects'])app.bus.on(event,drawTicks);
  app.bus.on('preview',redraw);
  drawClips();
  return {redraw,drawTicks,toggle};
}
