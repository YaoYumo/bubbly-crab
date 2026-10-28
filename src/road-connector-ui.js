import { el } from './util.js';
export function roadConnectorControls(app) {
  const tool = app.roadConnector, root = el('div', { class: 'road-connector-controls' });
  const buttons = [];
  root.append(el('div', { class: 'fnote', text: '自动连接：标记 A → 标记 B → 生成。选整条路会沿道路寻找短而顺的接点；选连接点可直接点击路面或蓝点，不用逐点画曲线。' }));
  for (const slot of [0, 1]) {
    const row = el('div', { class: 'btnrow' });
    for (const [mode, label] of [['road', '道路'], ['point', '连接点']]) {
      const button = el('button', { class: 'fbtn alt', type: 'button', text: `标记${label} ${slot ? 'B' : 'A'}`, dataset: { roadConnectPick: `${slot}-${mode}` }, onclick: () => tool.setPicking(slot, mode) });
      buttons.push({ button, slot, mode }); row.append(button);
    }
    root.append(row);
  }
  const mode=el('select',{class:'finput',dataset:{roadConnectMode:'1'},'aria-label':'道路连接方式',onchange:()=>{tool.routeMode=mode.value;tool.changed();}});
  for(const [value,label]of [['auto','自动：短连接优先，必要时尝试螺旋'],['short','仅短连接（不绕圈）'],['spiral','尝试螺旋匝道（需占地与净空）']])mode.append(el('option',{value,text:label}));
  root.append(mode);
  const status = el('div', { class: 'fnote', role: 'status', 'aria-live': 'polite', dataset: { roadConnectStatus: '1' } });
  const generate = el('button', { class: 'fbtn', type: 'button', text: '自动生成连接', dataset: { roadConnectGenerate: '1' }, onclick: () => {
    try { const road = tool.generate(); app.notify(`已生成「${road.name}」，Ctrl+Z 可撤销。`); } catch (e) { app.notify(e.message, 'warn'); }
  } });
  const regenerate=el('button',{class:'fbtn wide',type:'button',text:'重新生成这条连接',dataset:{roadConnectRegenerate:'1'},title:'按当前连接方式重算选中的自动连接，保留接点站位、道路 ID 与机位目标；可一步撤销。',onclick:()=>{
    try{tool.regenerate(app.selObj);app.notify('已按当前连接方式重算，可一步撤销。');}catch(e){app.notify(e.message,'warn');}
  }});
  root.append(regenerate);
  root.append(status, el('div', { class: 'btnrow' }, [generate, el('button', { class: 'fbtn alt', type: 'button', text: '清除标记', dataset: { roadConnectClear: '1' }, onclick: () => tool.reset() })]),
    el('div', { class: 'fnote', text: '连接路沿用 A 的车道分项；高速接入使用固定单车道紧凑匝道，只接近侧、不跨中央带。匝道两端使用紧凑汇入口，不套普通斑马线 T 口；短连接不绕大圈；近距离高差不足以放坡时，自动尝试有明确半径和层间净空的螺旋。空间不足时提示换接点，不改原场景。生成后仍可编辑分项与路径；不会随目标道路移动自动重算。' }));
  const render = () => {
    mode.value=tool.routeMode;
    status.textContent = tool.status;
    regenerate.style.display=app.selObj?._roadData?.connection?.generated?'':'none';regenerate.disabled=!tool.usable(app.selObj);
    generate.disabled = !tool.marks.every(Boolean);
    for (const { button, slot, mode } of buttons) {
      const on = tool.picking?.slot === slot && tool.picking?.mode === mode;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    }
  };
  render(); const off = app.bus.on('road-connector', () => { if (!root.isConnected) { off(); return; } render(); });
  return root;
}
