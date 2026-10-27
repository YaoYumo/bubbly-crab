import { el } from './util.js';
export function roadConnectorControls(app) {
  const tool = app.roadConnector, root = el('div', { class: 'road-connector-controls' });
  const buttons = [];
  root.append(el('div', { class: 'fnote', text: '自动连接：标记 A → 标记 B → 生成。选整条路会自动寻找端头与近侧接点；选连接点可直接点击路面或蓝点，不用逐点画曲线。' }));
  for (const slot of [0, 1]) {
    const row = el('div', { class: 'btnrow' });
    for (const [mode, label] of [['road', '道路'], ['point', '连接点']]) {
      const button = el('button', { class: 'fbtn alt', type: 'button', text: `标记${label} ${slot ? 'B' : 'A'}`, dataset: { roadConnectPick: `${slot}-${mode}` }, onclick: () => tool.setPicking(slot, mode) });
      buttons.push({ button, slot, mode }); row.append(button);
    }
    root.append(row);
  }
  const status = el('div', { class: 'fnote', role: 'status', 'aria-live': 'polite', dataset: { roadConnectStatus: '1' } });
  const generate = el('button', { class: 'fbtn', type: 'button', text: '自动生成连接', dataset: { roadConnectGenerate: '1' }, onclick: () => {
    try { const road = tool.generate(); app.notify(`已生成「${road.name}」，Ctrl+Z 可撤销。`); } catch (e) { app.notify(e.message, 'warn'); }
  } });
  root.append(status, el('div', { class: 'btnrow' }, [generate, el('button', { class: 'fbtn alt', type: 'button', text: '清除标记', dataset: { roadConnectClear: '1' }, onclick: () => tool.reset() })]),
    el('div', { class: 'fnote', text: '连接路沿用 A 的车道分项；高速接入使用固定单车道紧凑匝道，只接近侧、不跨中央带。自动计算弯道和高度过渡并检查道路／物体净空，找不到合适路线时不改原场景。生成后仍可编辑分项与路径；不会随目标道路移动自动重算。' }));
  const render = () => {
    status.textContent = tool.status;
    generate.disabled = !tool.marks.every(Boolean);
    for (const { button, slot, mode } of buttons) {
      const on = tool.picking?.slot === slot && tool.picking?.mode === mode;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    }
  };
  render(); const off = app.bus.on('road-connector', () => { if (!root.isConnected) { off(); return; } render(); });
  return root;
}
