import { DESKTOP_BUILD } from './desktop-runtime.js';
import { el } from './util.js';

const STORAGE_KEY = 'previz.onboarding.v1';
export function installOnboarding(app, { switchPage, openTools }) {
  let root, panel, spotlight, index = -1, previous, snapshot, observer;
  const seen = () => { try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; } };
  const remember = result => { try { localStorage.setItem(STORAGE_KEY, result); } catch { /* Private/storage-disabled mode still works. */ } };
  const page = id => switchPage(id);
  const steps = [
    { title: '先搭场景', target: '.viewport-create', setup: () => page('scene'), text: DESKTOP_BUILD ? '将 GGUF 模型放到安装目录的 models 文件夹，在「一句话生成」用中文描述场景。程序会自动启动随包本地引擎，直接搭建；继续对话即可修改，普通增改不用蓝图或候选预览。大范围删除会确认，每轮可撤销。首次加载可能需要几分钟。' : '点击「一句话生成」，用中文描述场景。默认界面很简洁，配方和模板都收在「更多选项」。生成会替换当前场景，可撤销；本导览不会替你生成或覆盖工程。' },
    { title: '自己的模型，放进自己的分组', target: '#library-scene', setup: () => { page('scene'); if (document.getElementById('library-scene').style.display === 'none') document.getElementById('lib-toggle').click(); }, text: '展开模型库，点击「导入至分组」或「新建分组」。支持 GLB / GLTF / FBX / OBJ；贴图、BIN、MTL 需要一起选择。入库不自动放进场景，之后可点击或拖放。用户模型可移动分组和删除，内置模型移除后可恢复。' },
    { title: '右键是你的操作中心', target: '.viewport-operations', setup: () => page('scene'), text: '在视口短按右键，按物体、机位、空白显示不同饼菜单。右键拖动仍然平移视角。W / E / R 切换移动、旋转、缩放，F 聚焦，Ctrl+Z 撤销；也可以点击这个「操作 · 右键」入口。' },
    { title: '建立机位与运镜', target: '#cam-add-btn', setup: () => page('camera'), text: '先摆好视口，再点击「＋」新建机位，或按 C。从右侧选择运镜预设、调整路径和关键帧。取景预览只检查画面，不会导出视频。已有机位和路径不会因本导览而改变。' },
    { title: '把多个镜头剪成一段', target: '#bottom', setup: () => page('direct'), text: '在 Direct 时间轴使用「＋当前机位」或「顺序拼接」。拖动镜头片段调整顺序、拖两端修剪，也能在播放头处分割。镜头轨道不堆叠所有关键帧；需要时再打开关键帧或曲线。' },
    { title: '准备给 AI 的参考资料', target: '#generate-content', setup: () => page('generate'), text: 'Generate 用于整理提示词与 3D 参考资料。本页不直接生成图片或视频，可先导出参考包供其他工具使用；桌面本地场景搭建请使用「一句话生成」。这里不会替你发起付费生成。' },
    { title: '导出画面与视频', target: '#export-content', setup: () => page('export'), text: 'Export 中设置画幅、分辨率、时长与格式，再导出 PNG 或视频。建议先用小尺寸短片验证镜头切换，再输出完整版本。桌面版保存时请选择磁盘位置，等待写入成功提示。' },
    { title: '别忘了保存完整工程', target: '.viewport-tools-panel', setup: () => { page('scene'); openTools(); }, text: '从「操作 · 右键 → 工具 / 工程 → 场景」保存或打开 .previz 完整工程包，里面会带上已放入场景的用户模型与贴图。主题、吸附、画幅、精度也在这里；本地模型库分组不会随工程包同步。这里也能重新打开「新手指引」。' },
    { title: '可以开始创作了', text: '推荐顺序：搭场景 → 定机位 → 排镜头 → 保存工程 → 导出参考。点击「开始创作」后会返回导览前的页面与视角，不生成示例、不添加模型、不改变你的工程。以后可在「工具 / 工程 → 新手指引」重新查看。' },
  ];

  function blocked() {
    return app.state.playing || app.state.preview || app.stage.dragging || app.stage.exporting || app.stage.exportOwner || app.exporter?.running || app.reference?.busy || app.aiScene?.busy || app.behaviors?.busy || app.sceneRecipeBusy || app.terrain?.workflow?.busy || app.terrain?.workflow?.drawing || app.terrain?.workflow?.erosionPreview || app.state.terrainTool || app.state.dofPickMode || app.roadBrush?.active || app.vegetationBrush?.active || app.roadPlanning?.picking;
  }
  function saveView() {
    const v = app.stage.view;
    snapshot = { page: document.getElementById('app').dataset.page, library: document.getElementById('library-scene').style.display, scroll: document.getElementById('library-scene').scrollTop, pos: v.position.clone(), quat: v.quaternion.clone(), up: v.up.clone(), target: app.stage.orbit.target.clone() };
  }
  function position() {
    if (!root) return;
    const target = index >= 0 ? document.querySelector(steps[index].target || '[data-no-tour-target]') : null;
    const r = target?.getBoundingClientRect();
    const visible = r && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    const width = Math.min(390, innerWidth - 24);
    panel.style.width = width + 'px';
    const h = panel.getBoundingClientRect().height;
    let x = (innerWidth - width) / 2, y = (innerHeight - h) / 2;
    spotlight.hidden = !visible;
    root.classList.toggle('tour-targeted',!!visible);
    if (visible) {
      const l = Math.max(6, r.left - 5), t = Math.max(6, r.top - 5);
      const right = Math.min(innerWidth - 6, r.right + 5), bottom = Math.min(innerHeight - 6, r.bottom + 5);
      Object.assign(spotlight.style, { left: l + 'px', top: t + 'px', width: Math.max(0,right-l) + 'px', height: Math.max(0,bottom-t) + 'px' });
      x = r.left + r.width / 2 - width / 2;
      if (bottom + 14 + h <= innerHeight - 12) y = bottom + 14;
      else if (t - 14 - h >= 12) y = t - 14 - h;
      else if (right + 14 + width <= innerWidth - 12) { x = right + 14; y = t; }
      else if (l - 14 - width >= 12) { x = l - 14 - width; y = t; }
    }
    panel.style.left = Math.max(12, Math.min(x, innerWidth-width-12)) + 'px';
    panel.style.top = Math.max(12, Math.min(y, innerHeight-h-12)) + 'px';
  }
  function close(result = 'skipped') {
    if (!root) return;
    observer?.disconnect();window.removeEventListener('resize',position);window.removeEventListener('keydown',onKey,true);
    root.remove();root = null;remember(result);app.closeViewportTools?.();
    if (snapshot) {
      page(snapshot.page);
      const lib = document.getElementById('library-scene');
      if (lib.style.display !== snapshot.library) document.getElementById('lib-toggle').click();
      lib.scrollTop = snapshot.scroll;
      app.stage.orbit.target.copy(snapshot.target);app.stage.view.position.copy(snapshot.pos);app.stage.view.up.copy(snapshot.up);app.stage.orbit.update();app.stage.view.quaternion.copy(snapshot.quat);
    }
    if(previous?.isConnected && previous.getClientRects().length)previous.focus({preventScroll:true});else app.stage.canvas.focus({preventScroll:true});
  }
  function render() {
    observer?.disconnect();app.closeViewportTools?.();
    const step = index < 0 ? null : steps[index];
    step?.setup?.();
    panel.replaceChildren();
    panel.append(el('div',{class:'tour-eyebrow',text:step?`快速上手 · ${index+1} / ${steps.length}`:'欢迎使用 PREVIZ LAB'}),
      el('h2',{id:'tour-title',text:step?.title || '从一个场景，到一段镜头'}),
      el('p',{id:'tour-description',text:step?.text || '用几分钟认识模型库、右键操作、机位、剪辑与工程保存。指引只介绍界面，不创建场景、不修改已有工程。可以随时跳过。'}));
    const footer=el('footer');
    const skip=el('button',{type:'button',class:'tour-skip',text:step?'跳过指引':'暂时跳过',onclick:()=>close('skipped')});footer.append(skip);
    if(index>0)footer.append(el('button',{type:'button',class:'fbtn',text:'上一步',onclick:()=>{index--;render();}}));
    const next=el('button',{type:'button',class:'fbtn pri',dataset:{tourNext:'1'},text:index<0?'开始导览':index===steps.length-1?'开始创作':'下一步',onclick:()=>{if(index===steps.length-1)close('completed');else{index++;render();}}});footer.append(next);panel.append(footer);
    if(index<0)panel.append(el('small',{text:'以后可从「工具 / 工程 → 新手指引」重新打开。'}));
    requestAnimationFrame(()=>{if(root){position();next.focus({preventScroll:true});}});
    const anchor=step?.target&&document.querySelector(step.target);
    observer=new ResizeObserver(position);observer.observe(panel);if(anchor)observer.observe(anchor);
    position();
  }
  function onKey(e) {
    if(!root)return;
    e.stopImmediatePropagation();
    if(e.key==='Escape'){e.preventDefault();close('skipped');}
    if(e.key==='Tab'){
      const nodes=[...panel.querySelectorAll('button')],i=nodes.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus();}
      else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus();}
    }
  }
  function start() {
    if(root)return;
    if(blocked()){app.notify('请先停止播放、预览、笔刷或导出，再打开新手指引','warn');return;}
    if(document.querySelector('.local-chat-overlay,.tg-mask,.library-mask,.ai-scene-mask,dialog[open],#modal.on')){app.notify('请先关闭当前对话框，再打开新手指引','warn');return;}
    app.radialMenu?.close(false);app.closeViewportTools?.();
    previous=document.activeElement;saveView();index=-1;
    spotlight=el('div',{class:'tour-spotlight',hidden:true,'aria-hidden':'true'});
    panel=el('section',{class:'tour-card',role:'dialog','aria-modal':'true','aria-labelledby':'tour-title','aria-describedby':'tour-description'});
    root=el('div',{class:'tour-layer'},[spotlight,panel]);document.body.append(root);
    window.addEventListener('resize',position);window.addEventListener('keydown',onKey,true);render();
  }
  return { start, close, get isOpen(){return !!root;}, maybeStart(){if(!seen()&&!navigator.webdriver&&!app.benchmarkMode)start();} };
}
